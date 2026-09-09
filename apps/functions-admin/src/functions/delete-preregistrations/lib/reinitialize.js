import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

const TABLE_RECREATE_MAX_ATTEMPTS = 20;
const TABLE_RECREATE_RETRY_DELAY_MS = 300;

export function makeTableClient(conn, tableName) {
  if (!conn) throw new Error("TABLE_CONNECTION_STRING ontbreekt");
  if (conn === "UseDevelopmentStorage=true" || conn.includes("DefaultEndpointsProtocol")) {
    return TableClient.fromConnectionString(conn, tableName);
  }
  const accountUrl = process.env.TABLE_ACCOUNT_URL;
  if (!accountUrl) throw new Error("TABLE_ACCOUNT_URL ontbreekt voor AAD-mode");
  return new TableClient(accountUrl, tableName, new DefaultAzureCredential());
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error) {
  return String(error?.code || error?.details?.errorCode || "").toLowerCase();
}

function isTableAlreadyExistsError(error) {
  return error?.statusCode === 409 && getErrorCode(error) === "tablealreadyexists";
}

function isTableBeingDeletedError(error) {
  return (
    error?.statusCode === 409 &&
    (getErrorCode(error) === "tablebeingdeleted" || /table.*being.*deleted/i.test(String(error?.message || "")))
  );
}

async function createTableWithRetry(table, tableName, log) {
  for (let attempt = 1; attempt <= TABLE_RECREATE_MAX_ATTEMPTS; attempt++) {
    try {
      await table.createTable();
      if (attempt > 1 && typeof log === "function") {
        log("delete-preregistrations: tabel aangemaakt na retries", { tableName, attempt });
      }
      return;
    } catch (error) {
      if (isTableAlreadyExistsError(error)) {
        return;
      }
      if (isTableBeingDeletedError(error) && attempt < TABLE_RECREATE_MAX_ATTEMPTS) {
        if (typeof log === "function") {
          log("delete-preregistrations: tabel nog in verwijdering, retry", {
            tableName,
            attempt,
            maxAttempts: TABLE_RECREATE_MAX_ATTEMPTS,
            retryDelayMs: TABLE_RECREATE_RETRY_DELAY_MS,
            code: error?.code || error?.details?.errorCode || null,
          });
        }
        await wait(TABLE_RECREATE_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Kon tabel '${tableName}' niet opnieuw aanmaken.`);
}

async function reinitializeTable(table, log) {
  try {
    await table.deleteTable();
  } catch (e) {
    if (e.statusCode !== 404) throw e;
  }

  await createTableWithRetry(table, table.tableName || "onbekend", log);
}

async function reinitializeStatsTable(table, resetCounters, log) {
  await reinitializeTable(table, log);
  await table.upsertEntity(
    {
      partitionKey: "global",
      rowKey: "counters",
      ...resetCounters,
      lastUpdated: new Date().toISOString(),
    },
    "Replace"
  );
}

export async function reinitializePreRegistrationTables({
  conn,
  tableName,
  phoneLockTableName,
  statsTableName,
  resetCounters,
  log,
}) {
  const table = makeTableClient(conn, tableName);
  const phoneLockTable = makeTableClient(conn, phoneLockTableName);
  const statsTable = makeTableClient(conn, statsTableName);

  await Promise.all([
    reinitializeTable(table, log),
    reinitializeTable(phoneLockTable, log),
    reinitializeStatsTable(statsTable, resetCounters, log),
  ]);
}
