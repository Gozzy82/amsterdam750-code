import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import { STATS_COUNTER_ROW_KEY, STATS_COUNTER_SHARD_PREFIX } from "@gozzy82/amsterdam750-shared/stats";
import { requireAuthenticatedAdmin } from "../../lib/admin-auth.js";

const DAILY_WINDOW_DAYS = 30;
const DEFAULT_CACHE_TTL_MS = 15000;
let cachedPayload = null;
let cacheExpiresAt = 0;

function makeTableClient(conn, tableName) {
  if (conn === "UseDevelopmentStorage=true" || conn.includes("DefaultEndpointsProtocol")) {
    return TableClient.fromConnectionString(conn, tableName);
  }
  const accountUrl = process.env.TABLE_ACCOUNT_URL;
  if (!accountUrl) throw new Error("TABLE_ACCOUNT_URL ontbreekt voor AAD-mode");
  return new TableClient(accountUrl, tableName, new DefaultAzureCredential());
}

async function ensureTable(client) {
  try {
    await client.createTable();
  } catch (error) {
    if (error?.statusCode !== 409) throw error;
  }
}

function getErrorCode(error) {
  return String(error?.code || error?.details?.errorCode || "").toLowerCase();
}

function isTableNotFoundError(error) {
  return (
    error?.statusCode === 404
    && (
      getErrorCode(error) === "tablenotfound"
      || /table specified does not exist/i.test(String(error?.message || ""))
    )
  );
}

async function statsHandler(request, context) {
  const auth = requireAuthenticatedAdmin(request, context, { action: "stats" });
  if (!auth.ok) {
    return auth.response;
  }

  try {
    return await _statsHandler(request, context);
  } catch (e) {
    context.log("stats unhandled error: " + e.message + "\n" + e.stack);
    return {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message }),
    };
  }
}

function parsePositiveInt(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCounterValue(rawValue) {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function stripEntityMetadata(entity) {
  const { partitionKey, rowKey, timestamp, etag, ...rest } = entity || {};
  return rest;
}

function addCounterValues(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    const numeric = normalizeCounterValue(value);
    if (numeric === null) continue;
    target[key] = (target[key] || 0) + numeric;
  }
}

function isCounterShardEntity(entity) {
  return (
    entity?.rowKey === STATS_COUNTER_ROW_KEY
    && String(entity?.partitionKey || "").startsWith(STATS_COUNTER_SHARD_PREFIX)
  );
}

function buildLastDailyWindow(now, dailyCounts) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (DAILY_WINDOW_DAYS - 1));
  const days = [];

  for (let i = 0; i < DAILY_WINDOW_DAYS; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const key = date.toISOString().slice(0, 10);
    days.push({ date: key, count: dailyCounts[key] || 0 });
  }

  return days;
}

function sumDailyCounts(days) {
  return days.reduce((sum, day) => sum + day.count, 0);
}

function dailyFieldNameForDateKey(dateKey) {
  return `registrations_${String(dateKey).replaceAll("-", "")}`;
}

function legacyDailyFieldNameForDateKey(dateKey) {
  return `registrations_${dateKey}`;
}

function buildDailyCountsFromCounters(now, counters) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (DAILY_WINDOW_DAYS - 1));
  const dailyCounts = {};

  for (let i = 0; i < DAILY_WINDOW_DAYS; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const dateKey = date.toISOString().slice(0, 10);
    const fieldValue = normalizeCounterValue(
      counters[dailyFieldNameForDateKey(dateKey)]
      ?? counters[legacyDailyFieldNameForDateKey(dateKey)]
    );
    dailyCounts[dateKey] = fieldValue ?? 0;
  }

  return dailyCounts;
}

async function countAllRegistrations(dataTable) {
  const countRegistrations = async () => {
    let total = 0;
    for await (const _entity of dataTable.listEntities({
      queryOptions: {
        filter: "kind eq 'user'",
        select: ["kind"],
      },
    })) {
      total++;
    }
    return total;
  };

  try {
    return await countRegistrations();
  } catch (error) {
    if (!isTableNotFoundError(error)) throw error;
    await ensureTable(dataTable);
    return countRegistrations();
  }
}

async function readCounters(statsTable) {
  const counters = {};

  try {
    const legacyEntity = await statsTable.getEntity("global", STATS_COUNTER_ROW_KEY);
    addCounterValues(counters, stripEntityMetadata(legacyEntity));
  } catch (error) {
    if (isTableNotFoundError(error)) {
      await ensureTable(statsTable);
      return counters;
    }
    if (error?.statusCode !== 404) throw error;
  }

  try {
    for await (const entity of statsTable.listEntities({
      queryOptions: {
        filter: `RowKey eq '${STATS_COUNTER_ROW_KEY}'`,
      },
    })) {
      if (!isCounterShardEntity(entity)) continue;
      addCounterValues(counters, stripEntityMetadata(entity));
    }
  } catch (error) {
    if (!isTableNotFoundError(error)) throw error;
    await ensureTable(statsTable);
  }

  return counters;
}

export function resetStatsCache() {
  cachedPayload = null;
  cacheExpiresAt = 0;
}

export const resetStatsCacheForTests = resetStatsCache;

export async function _statsHandler(request, context) {
  const conn = process.env.TABLE_CONNECTION_STRING;
  if (!conn) {
    return {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "TABLE_CONNECTION_STRING ontbreekt." }),
    };
  }

  const tableName = process.env.TABLE_NAME || "PreRegistrations";
  const statsTableName = process.env.STATS_TABLE_NAME || "Stats";

  const nowMs = Date.now();
  const cacheTtlMs = parsePositiveInt(process.env.STATS_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
  if (cachedPayload && nowMs < cacheExpiresAt) {
    context.log("stats: cache hit");
    return {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify(cachedPayload),
    };
  }

  let statsTable;
  try {
    statsTable = makeTableClient(conn, statsTableName);
  } catch (e) {
    context.log("makeTableClient error: " + e.message);
    return {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message }),
    };
  }

  // --- Read aggregated counters (legacy + sharded entities, no PII) ---
  const counters = await readCounters(statsTable);

  // --- Build daily counts from pre-aggregated counters ---
  const now = new Date();
  const dailyCounts = buildDailyCountsFromCounters(now, counters);

  // --- Build last 30 days (fill zeros for missing days) ---
  const days = buildLastDailyWindow(now, dailyCounts);
  const recentWindowTotal = sumDailyCounts(days);

  const counterTotal = normalizeCounterValue(counters.registrations);
  let total = counterTotal;
  if (counterTotal === null || counterTotal < recentWindowTotal) {
    const dataTable = makeTableClient(conn, tableName);
    total = await countAllRegistrations(dataTable);
    context.log(
      counterTotal === null
        ? "stats: registrations counter missing, used full table scan for total"
        : "stats: registrations counter inconsistent with recent daily counts, used full table scan for total"
    );
  }

  const payload = { totalRegistrations: total, dailyCounts: days, counters };
  cachedPayload = payload;
  cacheExpiresAt = nowMs + cacheTtlMs;

  context.log("stats: total=" + total);

  return {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  };
}

app.http("stats", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "stats",
  handler: statsHandler,
});
