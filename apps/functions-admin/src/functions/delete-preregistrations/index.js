import { app } from "@azure/functions";
import { resetStatsCache } from "../stats/index.js";
import { reinitializePreRegistrationTables } from "./lib/reinitialize.js";
import { logAdminAuditEvent, requireAuthenticatedAdmin } from "../../lib/admin-auth.js";

const RESET_STATS_COUNTERS = {
  registrations: 0,
  challenge_shown: 0,
  challenge_failed: 0,
  challenge_passed: 0,
  blocked_honeypot: 0,
};

function jsonResponse(status, payload) {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export async function deleteAllPreRegistrations(options = {}) {
  const log = options?.log;
  const conn = process.env.TABLE_CONNECTION_STRING;
  const tableName = process.env.TABLE_NAME || "PreRegistrations";
  const phoneLockTableName = process.env.PHONE_LOCK_TABLE_NAME || "PhoneLocks";
  const statsTableName = process.env.STATS_TABLE_NAME || "Stats";
  await reinitializePreRegistrationTables({
    conn,
    tableName,
    phoneLockTableName,
    statsTableName,
    resetCounters: RESET_STATS_COUNTERS,
    log,
  });
  resetStatsCache();

  return {
    reinitializedTables: [tableName, phoneLockTableName, statsTableName],
    tableName,
    phoneLockTableName,
    statsTableName,
  };
}

async function deletePreRegistrationsHandler(request, context) {
  const auth = requireAuthenticatedAdmin(request, context, {
    action: "delete-preregistrations",
    auditOnFailure: true,
  });
  if (!auth.ok) {
    return auth.response;
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Alleen POST is toegestaan." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "Body moet geldige JSON zijn." });
  }

  if (body?.confirm !== true) {
    return jsonResponse(400, { ok: false, error: "Stuur {\"confirm\": true} om te verwijderen." });
  }

  try {
    const result = await deleteAllPreRegistrations({ log: context.log });
    context.log("delete-preregistrations:", result);
    logAdminAuditEvent(context, "delete-preregistrations", {
      outcome: "succeeded",
      principal: auth.principal,
      details: result,
    });
    return jsonResponse(200, { ok: true, ...result });
  } catch (e) {
    context.log("delete-preregistrations fout:", e.message, e.stack);
    logAdminAuditEvent(context, "delete-preregistrations", {
      outcome: "failed",
      principal: auth.principal,
      reason: e.message,
    });
    return jsonResponse(500, { ok: false, error: e.message });
  }
}

app.http("delete-preregistrations", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "delete-preregistrations",
  handler: deletePreRegistrationsHandler,
});
