import { app } from "@azure/functions";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import { EmailClient } from "@azure/communication-email";
import { SecretClient } from "@azure/keyvault-secrets";
import { decryptPiiString, envelopeFromString } from "@gozzy82/amsterdam750-shared/keyvault";
import { InviteStatus } from "../../lib/invite-status.js";

let _emailConnCache;
async function getEmailConnectionString() {
  if (_emailConnCache) return _emailConnCache;
  const kvUrl = process.env.KV_URL;
  if (!kvUrl) throw new Error("KV_URL ontbreekt");
  const secretName = process.env.COMMUNICATIONS_SECRET_NAME || "communications-connection-string";
  const client = new SecretClient(kvUrl, new DefaultAzureCredential());
  const secret = await client.getSecret(secretName);
  _emailConnCache = secret.value;
  return _emailConnCache;
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailHtml(firstName, inviteUrl) {
  const safeFirstName = escapeHtml(firstName);
  const escapedUrl = escapeHtml(inviteUrl);
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="UTF-8"><title>Uitnodiging Amsterdam 750</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h1 style="color:#c00">Amsterdam 750 jaar</h1>
  <p>Beste ${safeFirstName},</p>
  <p>
    Je staat vooraan in de rij! Klik op de knop hieronder om je officieel te registreren
    voor het Amsterdam 750-jaar evenement en je plek zeker te stellen.
  </p>
  <p style="text-align:center;margin:30px 0">
    <a href="${escapedUrl}"
       style="background:#c00;color:#fff;padding:14px 28px;border-radius:4px;text-decoration:none;font-size:16px;font-weight:bold">
      Registreer nu
    </a>
  </p>
  <p>Of kopieer deze link in je browser:<br>
    <a href="${escapedUrl}">${escapedUrl}</a>
  </p>
  <hr style="margin-top:40px">
  <p style="font-size:12px;color:#666">
    Je ontvangt dit bericht omdat je je hebt aangemeld voor de pre-registratie van Amsterdam 750.
    Als je dit niet herkent, kun je dit bericht negeren.
  </p>
</body>
</html>`;
}

function isPreconditionFailed(error) {
  return error?.statusCode === 412 || error?.status === 412;
}

async function inviteWorkerHandler(jobMessage, context) {
  const { partitionKey, rowKey, inviteToken } = jobMessage;
  context.log("invite-worker ontvangen:", { partitionKey, rowKey });

  const conn = process.env.TABLE_CONNECTION_STRING;
  const tableName = process.env.TABLE_NAME || "PreRegistrations";
  const table = makeTableClient(conn, tableName);

  const entity = await table.getEntity(partitionKey, rowKey);

  if (entity.inviteStatus === InviteStatus.SENT) {
    context.log("invite-worker: al verstuurd, sla over:", rowKey);
    return;
  }

  if (entity.inviteStatus === InviteStatus.SENDING) {
    context.log("invite-worker: al in verwerking, sla over:", rowKey);
    return;
  }

  let claimedEtag;
  try {
    const claimResponse = await table.updateEntity(
      {
        partitionKey,
        rowKey,
        inviteStatus: InviteStatus.SENDING,
        inviteProcessingStartedAt: new Date().toISOString(),
        inviteError: "",
      },
      "Merge",
      { etag: entity.etag }
    );
    claimedEtag = claimResponse.etag;
  } catch (error) {
    if (isPreconditionFailed(error)) {
      context.log("invite-worker: entity al gewijzigd door andere worker, sla over:", rowKey);
      return;
    }
    throw error;
  }

  let email;
  let emailClient;
  let emailMessage;
  try {
    const envelope = envelopeFromString(entity.pii);
    const plaintext = await decryptPiiString({ envelope, aad: rowKey });
    const { firstName, lastName, email: recipientEmail } = JSON.parse(plaintext);
    if (!recipientEmail) throw new Error("Ontvanger e-mail ontbreekt in PII payload");
    email = recipientEmail;

    const inviteBaseUrl = process.env.INVITE_BASE_URL;
    if (!inviteBaseUrl) throw new Error("INVITE_BASE_URL ontbreekt");
    const inviteUrl = inviteBaseUrl + inviteToken;

    const emailConn = await getEmailConnectionString();
    const from = process.env.EMAIL_FROM?.trim();
    if (!from) throw new Error("EMAIL_FROM ontbreekt (gebruik een gekoppeld ACS sender-domein)");

    emailClient = new EmailClient(emailConn);
    emailMessage = {
      senderAddress: from,
      recipients: {
        to: [{ address: email, displayName: `${firstName} ${lastName}` }],
      },
      content: {
        subject: "Je uitnodiging voor Amsterdam 750",
        html: buildEmailHtml(firstName, inviteUrl),
        plainText: `Beste ${firstName},\n\nRegistreer je voor Amsterdam 750 via:\n${inviteUrl}\n`,
      },
    };
  } catch (error) {
    await table.updateEntity(
      {
        partitionKey,
        rowKey,
        inviteStatus: InviteStatus.QUEUED,
        inviteError: error.message,
      },
      "Merge",
      claimedEtag ? { etag: claimedEtag } : undefined
    );
    throw error;
  }

  // beginSend returns a poller; awaiting pollUntilDone() throws on ACS error
  // so the queue message is re-queued by the runtime for retry
  try {
    const poller = await emailClient.beginSend(emailMessage);
    await poller.pollUntilDone();
  } catch (error) {
    await table.updateEntity(
      {
        partitionKey,
        rowKey,
        inviteStatus: InviteStatus.QUEUED,
        inviteError: error.message,
      },
      "Merge",
      claimedEtag ? { etag: claimedEtag } : undefined
    );
    throw error;
  }

  const sentAt = new Date().toISOString();
  await table.updateEntity(
    {
      partitionKey,
      rowKey,
      inviteStatus: InviteStatus.SENT,
      inviteSentAt: sentAt,
      inviteError: "",
    },
    "Merge",
    claimedEtag ? { etag: claimedEtag } : undefined
  );

  context.log("invite-worker: e-mail verstuurd naar", email);
}

app.storageQueue("invite-worker", {
  queueName: "%QUEUE_NAME%",
  connection: "AzureWebJobsStorage",
  handler: inviteWorkerHandler,
});
