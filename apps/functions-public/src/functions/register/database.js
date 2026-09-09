import { TableClient } from "@azure/data-tables";

async function ensureTable(client) {
  try {
    await client.createTable();
  } catch (e) {
    if (e.statusCode !== 409) throw e;
  }
}

async function runWithTableEnsureOnNotFound(table, operation) {
  try {
    return await operation();
  } catch (e) {
    if (e.statusCode !== 404) throw e;
    await ensureTable(table);
    return operation();
  }
}

export async function getOtpTable(connectionString, tableName = "OtpCodes") {
  return TableClient.fromConnectionString(connectionString, tableName);
}

export async function getPreregTable(connectionString, tableName = "PreRegistrations") {
  return TableClient.fromConnectionString(connectionString, tableName);
}

export async function getPhoneLockTable(connectionString, tableName = "PhoneLocks") {
  return TableClient.fromConnectionString(connectionString, tableName);
}

export async function getUserEntity(preregTable, token) {
  for await (const entity of preregTable.listEntities({
    queryOptions: { filter: `inviteToken eq '${token}' and kind eq 'user'` },
  })) {
    return entity;
  }
  return null;
}

export async function getOtpEntity(otpTable, tokenHash) {
  try {
    return await otpTable.getEntity("otp", tokenHash);
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

export async function storeOtpCode(otpTable, tokenHash, code, maskedPhone, smsSentCount = 1, lastSmsSentAt = null) {
  const now = new Date().toISOString();
  await runWithTableEnsureOnNotFound(otpTable, () => otpTable.upsertEntity({
    partitionKey: "otp",
    rowKey: tokenHash,
    code,
    createdAt: now,
    attempts: 0,
    maskedPhone,
    smsSentCount,
    lastSmsSentAt: lastSmsSentAt || now,
  }, "Replace"));
}

export async function claimOtpAttempt(otpTable, tokenHash, maxAttempts) {
  // Claim the attempt before checking the submitted code. This ensures every
  // parallel request consumes one of the limited OTP verification attempts.
  for (let retry = 0; retry <= maxAttempts; retry += 1) {
    const otpEntity = await getOtpEntity(otpTable, tokenHash);
    if (!otpEntity?.code || !otpEntity?.createdAt) {
      return { status: "notFound" };
    }

    const attempts = otpEntity.attempts || 0;
    if (attempts >= maxAttempts) {
      return { status: "limitReached", otpEntity };
    }

    try {
      await runWithTableEnsureOnNotFound(otpTable, () => otpTable.updateEntity({
        partitionKey: "otp",
        rowKey: tokenHash,
        attempts: attempts + 1,
      }, "Merge", { ifMatch: otpEntity.etag }));
      return { status: "claimed", otpEntity, attempts: attempts + 1 };
    } catch (e) {
      if (e.statusCode !== 412) throw e;

      // Another request updated the entity after we read it. Read its new
      // attempt count and ETag on the next iteration, then claim our own attempt.
    }
  }

  // The loop is bounded so persistent contention cannot keep a request alive.
  throw new Error("OTP attempt could not be claimed due to concurrent updates");
}

export async function deleteOtpCode(otpTable, otpEntity) {
  await runWithTableEnsureOnNotFound(otpTable, () => otpTable.upsertEntity({
    partitionKey: otpEntity.partitionKey,
    rowKey: otpEntity.rowKey,
    maskedPhone: otpEntity.maskedPhone,
    smsSentCount: otpEntity.smsSentCount || 0,
    ...(otpEntity.lastSmsSentAt ? { lastSmsSentAt: otpEntity.lastSmsSentAt } : {}),
  }, "Replace"));
}

export async function getPhoneHashForUser(phoneLockTable, userRowKey) {
  for await (const entity of phoneLockTable.listEntities({
    queryOptions: { filter: `userRowKey eq '${userRowKey}'` },
  })) {
    return entity.rowKey || null;
  }
  return null;
}

export async function markUserAsVerified(preregTable, userEntity) {
  await preregTable.updateEntity({
    partitionKey: userEntity.partitionKey,
    rowKey: userEntity.rowKey,
    registrationStatus: "verified",
    phoneVerifiedAt: new Date().toISOString(),
  }, "Merge");
}
