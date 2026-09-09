import { createHash } from 'crypto';
import {
  STATS_COUNTER_SHARDS_DEFAULT,
  STATS_COUNTER_ROW_KEY,
  buildStatsCounterShardPartitionKey,
} from "@gozzy82/amsterdam750-shared/stats";

/**
 * Ensure an Azure Table Storage table exists. Creates it if not found; ignores 409 conflict.
 * @param {import('@azure/data-tables').TableClient} client
 */
export async function ensureTable(client) {
  try { await client.createTable(); } catch (e) { if (e.statusCode !== 409) throw e; }
}

function getErrorCode(error) {
  return String(error?.code || error?.details?.errorCode || "").toLowerCase();
}

export function isTableNotFoundError(error) {
  return (
    error?.statusCode === 404
    && (
      getErrorCode(error) === "tablenotfound"
      || /table specified does not exist/i.test(String(error?.message || ""))
    )
  );
}

export async function runWithTableEnsureOnNotFound(table, operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isTableNotFoundError(error)) throw error;
    await ensureTable(table);
    return operation();
  }
}

function parsePositiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getStatsCounterShardCount() {
  return parsePositiveInt(process.env.STATS_COUNTER_SHARDS, STATS_COUNTER_SHARDS_DEFAULT);
}

function getRandomShardIndex(shardCount) {
  return Math.floor(Math.random() * shardCount);
}

function isConcurrencyConflict(error) {
  const code = getErrorCode(error);
  return (
    error?.statusCode === 409
    || error?.statusCode === 412
    || code === "updateconditionnotsatisfied"
    || code === "conditionnotmet"
    || code === "preconditionfailed"
  );
}

function toNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function incrementStatsShardFields(statsClient, fieldsDelta, now = new Date()) {
  const shardCount = getStatsCounterShardCount();
  const shardIndex = getRandomShardIndex(shardCount);
  const partitionKey = buildStatsCounterShardPartitionKey(shardIndex);
  const rowKey = STATS_COUNTER_ROW_KEY;
  const timestamp = now.toISOString();
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const existing = await statsClient.getEntity(partitionKey, rowKey);
      const updated = { ...existing, partitionKey, rowKey, lastUpdated: timestamp };
      for (const [field, delta] of Object.entries(fieldsDelta)) {
        updated[field] = toNonNegativeNumber(existing[field]) + delta;
      }
      await statsClient.updateEntity(updated, "Replace", {
        etag: existing.etag,
        matchCondition: "IfNotModified",
      });
      return;
    } catch (error) {
      if (isTableNotFoundError(error)) {
        await ensureTable(statsClient);
        continue;
      }
      if (error?.statusCode === 404) {
        const firstEntity = { partitionKey, rowKey, lastUpdated: timestamp };
        for (const [field, delta] of Object.entries(fieldsDelta)) {
          firstEntity[field] = delta;
        }
        try {
          await statsClient.createEntity(firstEntity);
          return;
        } catch (createError) {
          if (isTableNotFoundError(createError)) {
            await ensureTable(statsClient);
            continue;
          }
          if (isConcurrencyConflict(createError)) {
            continue;
          }
          throw createError;
        }
      }
      if (isConcurrencyConflict(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Kon stats-counter shard niet veilig bijwerken na meerdere pogingen.");
}

/**
 * Atomically increment a named counter in the Stats table.
 * Creates the counters row if it doesn't exist yet.
 * @param {import('@azure/data-tables').TableClient} statsClient
 * @param {string} field - Counter name (e.g. 'registrations', 'challenge_shown')
 */
export async function incrCounter(statsClient, field) {
  await incrementStatsShardFields(statsClient, { [field]: 1 });
}

function getUtcDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10).replaceAll('-', '');
}

function getDailyRegistrationsField(now = new Date()) {
  return `registrations_${getUtcDateKey(now)}`;
}

/**
 * Increment registrations and today's daily registrations counter
 * on a single random shard entity.
 * @param {import('@azure/data-tables').TableClient} statsClient
 * @param {Date} [now]
 */
export async function incrRegistrationsWithDaily(statsClient, now = new Date()) {
  const dailyField = getDailyRegistrationsField(now);
  await incrementStatsShardFields(statsClient, { registrations: 1, [dailyField]: 1 }, now);
}

/**
 * Check whether a rate-limit key has exceeded its allowance in the current time window.
 * Increments the counter and returns whether the request should be blocked.
 * @param {import('@azure/data-tables').TableClient} rlClient
 * @param {string} key - Unique, non-PII key (e.g. 'em:<emailHash>')
 * @param {number} limit - Maximum allowed requests per window
 * @param {number} windowSeconds - Window duration in seconds
 * @returns {Promise<{blocked: boolean, resetIn?: number}>}
 */
export async function checkLimit(rlClient, key, limit, windowSeconds) {
  const now = Date.now();
  const windowStart = Math.floor(now / (windowSeconds * 1000));
  const partitionKey = `rl-${key}`;
  const rowKey = String(windowStart);
  try {
    const existing = await rlClient.getEntity(partitionKey, rowKey);
    const count = (existing.count || 0) + 1;
    await rlClient.upsertEntity({ partitionKey, rowKey, count }, "Merge");
    if (count > limit) {
      return { blocked: true, resetIn: windowSeconds - (Math.floor(now / 1000) % windowSeconds) };
    }
    return { blocked: false };
  } catch (err) {
    if (err.statusCode === 404) {
      try {
        await rlClient.upsertEntity({ partitionKey, rowKey, count: 1 }, "Merge");
      } catch (upsertError) {
        if (upsertError.statusCode !== 404) throw upsertError;
        await ensureTable(rlClient);
        await rlClient.upsertEntity({ partitionKey, rowKey, count: 1 }, "Merge");
      }
      return { blocked: false };
    }
    throw err;
  }
}

/**
 * Generate a time-descending row key so newer rows sort first in Table Storage queries.
 * Format: `<inverted-timestamp-base36>_<random-suffix>`
 * @returns {string}
 */
export function makeRowKeyDesc() {
  const rev = (Number.MAX_SAFE_INTEGER - Date.now()).toString(36);
  return `${rev}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Derive a stable partition key from a normalised email address.
 * Uses the first 8 hex chars of SHA-1 to distribute writes while keeping
 * all rows for the same email in one partition (enabling atomic transactions).
 * @param {string} normalizedEmail
 * @returns {string} e.g. 'pre-a1b2c3d4'
 */
export function computePartitionKey(normalizedEmail) {
  const h = createHash('sha1').update(String(normalizedEmail || '')).digest('hex').slice(0, 8);
  return `pre-${h}`;
}
