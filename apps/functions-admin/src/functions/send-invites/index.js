import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import { QueueServiceClient } from "@azure/storage-queue";
import { randomUUID } from "crypto";
import { requireAuthenticatedAdmin } from "../../lib/admin-auth.js";
import { InviteStatus } from "../../lib/invite-status.js";

const EMAILS_PER_HOUR = 10;
const BATCH_DELAY_SECONDS = 3600;

function isPreconditionFailed(error) {
  return error?.statusCode === 412 || error?.status === 412;
}

function makeTableClient(conn, tableName) {
  if (!conn) throw new Error("TABLE_CONNECTION_STRING ontbreekt");
  if (conn === "UseDevelopmentStorage=true" || conn.includes("DefaultEndpointsProtocol")) {
    return TableClient.fromConnectionString(conn, tableName);
  }
  const accountUrl = process.env.TABLE_ACCOUNT_URL;
  if (!accountUrl) throw new Error("TABLE_ACCOUNT_URL ontbreekt voor AAD-mode");
  return new TableClient(accountUrl, tableName, new DefaultAzureCredential());
}

function makeQueueServiceClient(storageConn) {
  if (!storageConn) throw new Error("AzureWebJobsStorage ontbreekt");
  if (storageConn === "UseDevelopmentStorage=true" || storageConn.includes("DefaultEndpointsProtocol")) {
    return QueueServiceClient.fromConnectionString(storageConn);
  }
  // Falls back to TABLE_ACCOUNT_URL when queue and table share the same storage account
  const accountUrl = process.env.QUEUE_ACCOUNT_URL || process.env.TABLE_ACCOUNT_URL;
  if (!accountUrl) throw new Error("QUEUE_ACCOUNT_URL ontbreekt voor AAD-mode");
  return new QueueServiceClient(accountUrl, new DefaultAzureCredential());
}

/**
 * Pages through all user entities in PreRegistrations, generates an invite token per eligible
 * record, updates the entity to status 'queued', and enqueues a job message with a staggered
 * visibilityTimeout to respect the developer-tier limit of 10 emails per hour.
 *
 * @param {{ dryRun?: boolean }} [options]
 * @returns {Promise<{ total: number, skipped: number, queued: number, dryRun: boolean }>}
 */
export async function enqueueInvites({ dryRun = false } = {}) {
  const conn = process.env.TABLE_CONNECTION_STRING;
  const tableName = process.env.TABLE_NAME || "PreRegistrations";
  const storageConn = process.env.AzureWebJobsStorage;
  const queueName = process.env.QUEUE_NAME;
  if (!queueName) throw new Error("QUEUE_NAME ontbreekt");

  const table = makeTableClient(conn, tableName);
  const queueSvc = makeQueueServiceClient(storageConn);
  const queueClient = queueSvc.getQueueClient(queueName);

  if (!dryRun) {
    await queueClient.createIfNotExists();
  }

  let total = 0;
  let skipped = 0;
  let queued = 0;
  let jobIndex = 0;

  for await (const entity of table.listEntities({
    queryOptions: { filter: "kind eq 'user'" },
  })) {
    total++;

    if (
      entity.inviteStatus === InviteStatus.SENT ||
      entity.inviteStatus === InviteStatus.QUEUED ||
      entity.inviteStatus === InviteStatus.SENDING
    ) {
      skipped++;
      continue;
    }

    const inviteToken = randomUUID();
    const now = new Date().toISOString();
    // Stagger messages: batch 0-9 → visible immediately, batch 10-19 → +1 h, etc.
    const visibilityTimeout = Math.floor(jobIndex / EMAILS_PER_HOUR) * BATCH_DELAY_SECONDS;

    if (!dryRun) {
      let claimedEtag;
      try {
        const claimResponse = await table.updateEntity(
          {
            partitionKey: entity.partitionKey,
            rowKey: entity.rowKey,
            inviteToken,
            inviteStatus: InviteStatus.QUEUED,
            inviteQueuedAt: now,
            inviteError: "",
          },
          "Merge",
          { etag: entity.etag }
        );
        claimedEtag = claimResponse.etag;
      } catch (error) {
        if (isPreconditionFailed(error)) {
          skipped++;
          continue;
        }
        throw error;
      }

      try {
        await queueClient.sendMessage(
          JSON.stringify({ partitionKey: entity.partitionKey, rowKey: entity.rowKey, inviteToken }),
          { visibilityTimeout }
        );
      } catch (e) {
        // Roll back inviteStatus to allow retry in next run
        await table.updateEntity(
          {
            partitionKey: entity.partitionKey,
            rowKey: entity.rowKey,
            inviteStatus: InviteStatus.ERROR,
            inviteError: e.message,
          },
          "Merge",
          claimedEtag ? { etag: claimedEtag } : undefined
        );
        throw e;
      }
    }

    queued++;
    jobIndex++;
  }

  return { total, skipped, queued, dryRun };
}

async function sendInvitesHandler(request, context) {
  const auth = requireAuthenticatedAdmin(request, context, { action: "send-invites" });
  if (!auth.ok) {
    return auth.response;
  }

  try {
    let dryRun = false;
    try {
      if (request.method === "POST") {
        const body = await request.json();
        dryRun = !!body?.dryRun;
      }
    } catch {
      // lege body of geen JSON — dryRun blijft false
    }

    const result = await enqueueInvites({ dryRun });
    context.log("send-invites:", result);

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, ...result }),
    };
  } catch (e) {
    context.log("send-invites fout:", e.message, e.stack);
    return {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
}

app.http("send-invites", {
  methods: ["POST", "GET"],
  authLevel: "anonymous",
  route: "send-invites",
  handler: sendInvitesHandler,
});
