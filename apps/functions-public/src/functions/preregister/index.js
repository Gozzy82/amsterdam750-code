import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import appInsights from "applicationinsights";
import { createHash } from "crypto";
import { normalizeEmail, normalizePhone } from "@gozzy82/amsterdam750-shared";
import { encryptPiiString, envelopeToString, sha256Hex } from "@gozzy82/amsterdam750-shared/keyvault";
import {
  incrCounter,
  incrRegistrationsWithDaily,
  checkLimit,
  makeRowKeyDesc,
  computePartitionKey,
  runWithTableEnsureOnNotFound,
} from './lib/storage.js';
import { verifyTurnstile } from './lib/turnstile.js';

const SLOW_AWAIT_THRESHOLD_MS = 400;
const PHONE_LOCK_SHARDS_DEFAULT = 32;
const RATE_LIMITS_TABLE_DEFAULT = "PreregistrationRatelimits";

const aiConn = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
const isLocalFunctionHost =
  process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development"
  && !process.env.WEBSITE_INSTANCE_ID;

if (aiConn && isLocalFunctionHost && !appInsights.defaultClient) {
  appInsights.setup(aiConn)
    .setAutoDependencyCorrelation(true)
    .setAutoCollectRequests(false)
    .setAutoCollectPerformance(false)
    .setAutoCollectDependencies(false)
    .setAutoCollectConsole(true)
    .setUseDiskRetryCaching(true)
    .start();
}

/**
 * Build an HTML response with CORS headers.
 * @param {number} status - HTTP status code
 * @param {string} body - HTML body string
 * @param {Record<string, string>} [extraHeaders] - Additional response headers (e.g. HX-Reswap, Set-Cookie)
 * @returns {object} Azure Functions HTTP response object
 */
function htmlRes(status, body, extraHeaders = {}) {
  return {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Expose-Headers": "HX-Location, HX-Push-Url, HX-Redirect, HX-Refresh, HX-Replace-Url, HX-Reselect, HX-Reswap, HX-Retarget, HX-Trigger, HX-Trigger-After-Settle, HX-Trigger-After-Swap",
      ...extraHeaders,
    },
    body,
  };
}

/**
 * Parse a raw request body string into a plain object.
 * Tries JSON first, then falls back to URL-encoded form data.
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseBodyText(text) {
  const s = (text || '').trim();
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* empty */ }
  try {
    const params = new URLSearchParams(s);
    const obj = {};
    for (const [k, v] of params) obj[k] = v;
    if (Object.keys(obj).length) return obj;
  } catch { /* empty */ }
  return {};
}

function parsePositiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function computeShardIndex(value, shardCount) {
  const digest = createHash("sha1").update(String(value ?? "")).digest("hex");
  const parsed = Number.parseInt(digest.slice(0, 8), 16);
  return Number.isFinite(parsed) ? (parsed % shardCount) : 0;
}

function computePhoneLockPartitionKey(phoneHash) {
  const shardCount = parsePositiveInt(process.env.PHONE_LOCK_SHARDS, PHONE_LOCK_SHARDS_DEFAULT);
  const shardIndex = computeShardIndex(phoneHash, shardCount);
  return `phone-${String(shardIndex).padStart(2, "0")}`;
}

function isValidAzureTableName(name) {
  return /^[A-Za-z][A-Za-z0-9]{2,62}$/.test(String(name ?? ""));
}

function resolveRateLimitsTableName(context) {
  const configuredName = process.env.RATE_TABLE_NAME;
  if (!configuredName) return RATE_LIMITS_TABLE_DEFAULT;
  if (isValidAzureTableName(configuredName)) return configuredName;
  context?.log?.("preregister.invalidRateTableName", {
    configuredName,
    fallback: RATE_LIMITS_TABLE_DEFAULT,
  });
  return RATE_LIMITS_TABLE_DEFAULT;
}

async function awaitWithTiming(context, label, operation) {
  const startedAt = Date.now();
  let result;
  let error;
  try {
    result = await operation();
  } catch (err) {
    error = err;
  }
  const durationMs = Date.now() - startedAt;
  if (durationMs > SLOW_AWAIT_THRESHOLD_MS && typeof context?.log === "function") {
    const endedAt = startedAt + durationMs;
    context.log('preregister.await.start', { label, at: new Date(startedAt).toISOString() });
    context.log('preregister.await.end', { label, at: new Date(endedAt).toISOString(), durationMs });
  }
  if (error) throw error;
  return result;
}

/**
 * Azure Function handler for event pre-registration (POST /api/preregister).
 *
 * Flow:
 * 1. Verify the Turnstile token
 * 2. Validate required fields (firstName, lastName, phone, email, consent)
 * 3. Check honeypot field (`company`)
 * 4. Rate-limit by hashed email
 * 5. Reserve phone globally in PhoneLocks table (createEntity → 409 = duplicate)
 * 6. Atomically insert email-lock + user record in PreRegistrations
 * 7. On email conflict: roll back phone lock and return 409
 *
 * @param {import('@azure/functions').HttpRequest} request
 * @param {import('@azure/functions').InvocationContext} context
 * @returns {Promise<import('@azure/functions').HttpResponseInit>}
 */
async function preregisterHandler(request, context) {
  try {
    const rawText = await request.text();
    const body = parseBodyText(rawText);

    const { firstName, lastName, phone, email, consent, company, "cf-turnstile-response": cfToken } = body || {};

    const turnstileSecret = process.env.TURNSTILE_SECRET;
    if (!turnstileSecret) {
      context?.log?.("preregister.turnstileNotConfigured");
      return htmlRes(500, "<p class='error'>Server niet geconfigureerd (verificatie).</p>", { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
    }
    if (!cfToken) {
      return htmlRes(400, "<p class='error'>Verificatie ontbreekt. Ververs de pagina en probeer het opnieuw.</p>", { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
    }
    const turnstileOk = await awaitWithTiming(context, "verifyTurnstile", () => verifyTurnstile(cfToken, turnstileSecret));
    if (!turnstileOk) {
      const statsConnection = process.env.TABLE_CONNECTION_STRING;
      if (statsConnection) {
        const challengeStatsClient = TableClient.fromConnectionString(
          statsConnection,
          process.env.STATS_TABLE_NAME || "Stats",
        );
        await awaitWithTiming(context, "incrCounter.challenge_failed", () => incrCounter(challengeStatsClient, "challenge_failed"));
      }
      return htmlRes(400, "<p class='error'>Verificatie mislukt. Ververs de pagina en probeer het opnieuw.</p>", { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
    }

    const conn = process.env.TABLE_CONNECTION_STRING;
    if (!conn) {
      return htmlRes(500, "<p class='error'>Server niet geconfigureerd (storage).</p>", { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
    }

    const dataClient  = TableClient.fromConnectionString(conn, process.env.TABLE_NAME || "PreRegistrations");
    const rlClient    = TableClient.fromConnectionString(conn, resolveRateLimitsTableName(context));
    const statsClient = TableClient.fromConnectionString(conn, process.env.STATS_TABLE_NAME || "Stats");
    const phoneLockClient = TableClient.fromConnectionString(conn, process.env.PHONE_LOCK_TABLE_NAME || "PhoneLocks");

    const normalizedEmail = normalizeEmail(email || "").toLowerCase();
    const normalizedPhone = normalizePhone(phone || "");

    if (company) {
      await awaitWithTiming(context, "incrCounter.blocked_honeypot", () => incrCounter(statsClient, "blocked_honeypot"));
      return htmlRes(200, "<p class='error'>Er ging iets mis. Probeer later opnieuw.</p>", { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
    }
    
    if (!normalizedPhone && phone) {
      return htmlRes(400, "<p class='error'>Vul een geldig telefoonnummer in. (+31612345678)</p>", { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
    }

    if (!firstName || !lastName || !normalizedPhone || !normalizedEmail || !consent) {
      return htmlRes(400, "<p class='error'>Vul alle verplichte velden in.</p>", { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
    }

    // Rate limiting
    const rlEmailLimit  = Number(process.env.RL_EMAIL_LIMIT || 3);
    const rlWindow      = Number(process.env.RL_WINDOW_SECONDS || 600);

    const emRes = await awaitWithTiming(
      context,
      "checkLimit.email",
      () => checkLimit(rlClient, `em:${sha256Hex(normalizedEmail)}`, rlEmailLimit, rlWindow),
    );

    if (emRes.blocked) {
      const waitMinutes = Math.max(1, Math.ceil(rlWindow / 60));
      const waitDurationText = waitMinutes === 1 ? "1 minuut" : `${waitMinutes} minuten`;
      return htmlRes(429, `<p class='error'>Je hebt te vaak op Versturen geklikt. Wacht ${waitDurationText} en probeer het opnieuw.</p>`, { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
    }

    const now    = new Date().toISOString();
    const rowKey = makeRowKeyDesc();
    const userRk = `USER_${rowKey}`;
    const emailRk    = `EMAIL_${sha256Hex(normalizedEmail)}`;
    const phoneHash  = sha256Hex(normalizedPhone);
    const phoneLockPartitionKey = computePhoneLockPartitionKey(phoneHash);
    const partitionKey = computePartitionKey(normalizedEmail);
    const genericError = "<p class='error' role='alert'>Het is niet mogelijk om te registreren. Deze gegevens zijn mogelijk al eerder gebruikt.</p>";

    // Reserve phone in a deterministic shard (keeps uniqueness and avoids one hot partition)
    try {
      await awaitWithTiming(
        context,
        "phoneLockClient.createEntity",
        () => runWithTableEnsureOnNotFound(
          phoneLockClient,
          () => phoneLockClient.createEntity({ partitionKey: phoneLockPartitionKey, rowKey: phoneHash, userRowKey: userRk, createdAt: now })
        )
      );
    } catch (e) {
      if (e.statusCode === 409) {
        await awaitWithTiming(context, "incrCounter.blocked_phone", () => incrCounter(statsClient, "blocked_phone"));
        return htmlRes(409, genericError, { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
      }
      throw e;
    }

    try {
      const encPii = await awaitWithTiming(context, "encryptPiiString", () => encryptPiiString({
        plaintext: JSON.stringify({ firstName, lastName, email: normalizedEmail, phone: normalizedPhone }),
        aad: userRk,
      }));

      await awaitWithTiming(
        context,
        "dataClient.submitTransaction",
        () => runWithTableEnsureOnNotFound(
          dataClient,
          () => dataClient.submitTransaction([
            ["create", { partitionKey, rowKey: emailRk, kind: "uniq-email", userRowKey: userRk, createdAt: now }],
            ["create", { partitionKey, rowKey: userRk,  kind: "user", pii: envelopeToString(encPii), phoneHash, consent: !!consent, createdAt: now, source: "pre-registration" }],
          ])
        )
      );
    } catch (err) {
      try {
        await awaitWithTiming(
          context,
          "phoneLockClient.deleteEntity",
          () => phoneLockClient.deleteEntity(phoneLockPartitionKey, phoneHash)
        );
      } catch (rollbackError) {
        context?.log?.("preregister.phoneLockRollbackFailed", {
          message: rollbackError?.message,
          statusCode: rollbackError?.statusCode,
          code: rollbackError?.code,
        });
      }

      if (err.statusCode === 409) {
        await awaitWithTiming(context, "incrCounter.blocked_email", () => incrCounter(statsClient, "blocked_email"));
        return htmlRes(409, genericError, { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
      }
      throw err;
    }

    try {
      await awaitWithTiming(context, "incrCounter.registrations", () => incrRegistrationsWithDaily(statsClient));
    } catch (statsError) {
      context?.log?.("preregister.statsIncrementFailed", {
        message: statsError?.message,
        statusCode: statsError?.statusCode,
        code: statsError?.code,
      });
    }
    return htmlRes(200, "<p class='success'><strong>Bedankt!</strong> Je pre-registratie is ontvangen.</p>", {
      "HX-Reswap": "innerHTML",
      "HX-Retarget": "#preForm",
    });

  } catch (err) {
    try { context.log('preregister.error', err?.message); } catch { /* empty */ }
    return htmlRes(500, `<p class='error' role='alert'>Onverwachte fout, probeer later opnieuw.</p>`, { "HX-Reswap": "innerHTML", "HX-Retarget": "#serverError" });
  }
}

app.http('preregister', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'preregister',
  handler: preregisterHandler,
});