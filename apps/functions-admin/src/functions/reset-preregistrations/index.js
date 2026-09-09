import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import { logAdminAuditEvent, requireAuthenticatedAdmin } from "../../lib/admin-auth.js";

function makeTableClient(conn, tableName) {
  if (!conn) throw new Error("TABLE_CONNECTION_STRING ontbreekt");
  if (conn === "UseDevelopmentStorage=true" || conn.includes("DefaultEndpointsProtocol")) {
    return TableClient.fromConnectionString(conn, tableName);
  }
  const accountUrl = process.env.TABLE_ACCOUNT_URL;
  if (!accountUrl) throw new Error("TABLE_ACCOUNT_URL ontbreekt voor AAD-mode");
  return new TableClient(accountUrl, tableName, new DefaultAzureCredential());
}

export async function resetPreRegistrations() {
  const conn = process.env.TABLE_CONNECTION_STRING;
  const tableName = process.env.TABLE_NAME || "PreRegistrations";
  const table = makeTableClient(conn, tableName);

  const entities = [];
  for await (const entity of table.listEntities({
    queryOptions: { filter: "kind eq 'user'" },
  })) {
    entities.push({ partitionKey: entity.partitionKey, rowKey: entity.rowKey });
  }

  let reset = 0;
  for (const entity of entities) {
    await table.updateEntity(
    {
      partitionKey: entity.partitionKey,
      rowKey: entity.rowKey,
      inviteStatus: "pending",
      inviteQueuedAt: "",
      inviteSentAt: "",
      inviteError: "",
    },
      "Merge"
    );
    reset++;
  }

  return { reset, tableName };
}

async function resetPreRegistrationsHandler(request, context) {
  const auth = requireAuthenticatedAdmin(request, context, {
    action: "reset-preregistrations",
    auditOnFailure: true,
  });
  if (!auth.ok) {
    return auth.response;
  }

  if (request.method !== "POST") {
    return {
      status: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Alleen POST is toegestaan." }),
    };
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Body moet geldige JSON zijn." }),
    };
  }

  if (body?.confirm !== true) {
    return {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Stuur {\"confirm\": true} om te resetten." }),
    };
  }

  try {
    const result = await resetPreRegistrations();
    context.log("reset-preregistrations:", result);
    logAdminAuditEvent(context, "reset-preregistrations", {
      outcome: "succeeded",
      principal: auth.principal,
      details: result,
    });
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, ...result }),
    };
  } catch (e) {
    context.log("reset-preregistrations fout:", e.message, e.stack);
    logAdminAuditEvent(context, "reset-preregistrations", {
      outcome: "failed",
      principal: auth.principal,
      reason: e.message,
    });
    return {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
}

app.http("reset-preregistrations", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "reset-preregistrations",
  handler: resetPreRegistrationsHandler,
});
