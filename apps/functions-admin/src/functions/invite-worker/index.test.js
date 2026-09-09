import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteStatus } from "../../lib/invite-status.js";

const mocks = vi.hoisted(() => ({
  fromConnectionString: vi.fn(),
  storageQueue: vi.fn(),
  getSecret: vi.fn(),
  decryptPiiString: vi.fn(),
  envelopeFromString: vi.fn(),
  beginSend: vi.fn(),
  pollUntilDone: vi.fn(),
  getEntity: vi.fn(),
  updateEntity: vi.fn(),
}));

vi.mock("@azure/data-tables", () => ({
  TableClient: {
    fromConnectionString: mocks.fromConnectionString,
  },
}));

vi.mock("@azure/functions", () => ({
  app: {
    storageQueue: mocks.storageQueue,
  },
}));

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class DefaultAzureCredential {},
}));

vi.mock("@azure/keyvault-secrets", () => ({
  SecretClient: class SecretClient {
    async getSecret(name) {
      return mocks.getSecret(name);
    }
  },
}));

vi.mock("@azure/communication-email", () => ({
  EmailClient: class EmailClient {
    async beginSend(message) {
      return mocks.beginSend(message);
    }
  },
}));

vi.mock("@gozzy82/amsterdam750-shared/keyvault", () => ({
  decryptPiiString: mocks.decryptPiiString,
  envelopeFromString: mocks.envelopeFromString,
}));

describe("inviteWorkerHandler", () => {
  const context = { log: vi.fn() };

  async function loadHandler() {
    vi.resetModules();
    await import("./index.js");
    return mocks.storageQueue.mock.calls[0][1].handler;
  }

  beforeEach(() => {
    process.env.TABLE_CONNECTION_STRING = "UseDevelopmentStorage=true";
    process.env.TABLE_NAME = "PreRegistrations";
    process.env.INVITE_BASE_URL = "https://example.test/register?token=";
    process.env.KV_URL = "https://kv.test";
    process.env.EMAIL_FROM = "noreply@example.test";

    context.log.mockReset();
    mocks.fromConnectionString.mockReset();
    mocks.storageQueue.mockReset();
    mocks.getSecret.mockReset();
    mocks.decryptPiiString.mockReset();
    mocks.envelopeFromString.mockReset();
    mocks.beginSend.mockReset();
    mocks.pollUntilDone.mockReset();
    mocks.getEntity.mockReset();
    mocks.updateEntity.mockReset();

    mocks.getSecret.mockResolvedValue({ value: "endpoint=https://example.communication.azure.com/;accesskey=fake" });
    mocks.envelopeFromString.mockReturnValue({ pii: true });
    mocks.decryptPiiString.mockResolvedValue(JSON.stringify({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
    }));
    mocks.beginSend.mockResolvedValue({ pollUntilDone: mocks.pollUntilDone });
    mocks.pollUntilDone.mockResolvedValue({ status: "Succeeded" });
    mocks.fromConnectionString.mockReturnValue({
      getEntity: mocks.getEntity,
      updateEntity: mocks.updateEntity,
    });
  });

  it("claims the entity with its etag before sending and marks it sent afterward", async () => {
    const registeredHandler = await loadHandler();

    mocks.getEntity.mockResolvedValue({
      partitionKey: "pre-test",
      rowKey: "USER_001",
      pii: "{\"pii\":true}",
      etag: "etag-1",
      inviteStatus: InviteStatus.QUEUED,
    });
    mocks.updateEntity
      .mockResolvedValueOnce({ etag: "etag-2" })
      .mockResolvedValueOnce({ etag: "etag-3" });

    await registeredHandler({ partitionKey: "pre-test", rowKey: "USER_001", inviteToken: "token-123" }, context);

    expect(mocks.updateEntity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        partitionKey: "pre-test",
        rowKey: "USER_001",
        inviteStatus: InviteStatus.SENDING,
        inviteError: "",
      }),
      "Merge",
      { etag: "etag-1" }
    );
    expect(mocks.beginSend).toHaveBeenCalledTimes(1);
    expect(mocks.beginSend).toHaveBeenCalledWith(expect.objectContaining({
      recipients: {
        to: [{ address: "ada@example.com", displayName: "Ada Lovelace" }],
      },
    }));
    expect(mocks.updateEntity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        partitionKey: "pre-test",
        rowKey: "USER_001",
        inviteStatus: InviteStatus.SENT,
        inviteError: "",
      }),
      "Merge",
      { etag: "etag-2" }
    );
  });

  it("skips the send when another worker already claimed the entity", async () => {
    const registeredHandler = await loadHandler();

    mocks.getEntity.mockResolvedValue({
      partitionKey: "pre-test",
      rowKey: "USER_001",
      pii: "{\"pii\":true}",
      etag: "etag-1",
      inviteStatus: InviteStatus.QUEUED,
    });
    mocks.updateEntity.mockRejectedValue({ statusCode: 412 });

    await registeredHandler({ partitionKey: "pre-test", rowKey: "USER_001", inviteToken: "token-123" }, context);

    expect(mocks.beginSend).not.toHaveBeenCalled();
    expect(context.log).toHaveBeenCalledWith(
      "invite-worker: entity al gewijzigd door andere worker, sla over:",
      "USER_001"
    );
  });

  it("skips immediately when the invite is already being processed", async () => {
    const registeredHandler = await loadHandler();

    mocks.getEntity.mockResolvedValue({
      partitionKey: "pre-test",
      rowKey: "USER_001",
      pii: "{\"pii\":true}",
      etag: "etag-1",
      inviteStatus: InviteStatus.SENDING,
    });

    await registeredHandler({ partitionKey: "pre-test", rowKey: "USER_001", inviteToken: "token-123" }, context);

    expect(mocks.updateEntity).not.toHaveBeenCalled();
    expect(mocks.beginSend).not.toHaveBeenCalled();
  });

  it("rolls back to queued when sending fails so the queue retry can try again", async () => {
    const registeredHandler = await loadHandler();

    const sendError = new Error("ACS temporary failure");
    mocks.getEntity.mockResolvedValue({
      partitionKey: "pre-test",
      rowKey: "USER_001",
      pii: "{\"pii\":true}",
      etag: "etag-1",
      inviteStatus: InviteStatus.QUEUED,
    });
    mocks.updateEntity
      .mockResolvedValueOnce({ etag: "etag-2" })
      .mockResolvedValueOnce({ etag: "etag-3" });
    mocks.pollUntilDone.mockRejectedValue(sendError);

    await expect(
      registeredHandler({ partitionKey: "pre-test", rowKey: "USER_001", inviteToken: "token-123" }, context)
    ).rejects.toThrow("ACS temporary failure");

    expect(mocks.updateEntity).toHaveBeenNthCalledWith(
      2,
      {
        partitionKey: "pre-test",
        rowKey: "USER_001",
        inviteStatus: InviteStatus.QUEUED,
        inviteError: "ACS temporary failure",
      },
      "Merge",
      { etag: "etag-2" }
    );
  });

  it("rolls back to queued when Key Vault decryption fails", async () => {
    const registeredHandler = await loadHandler();

    const keyVaultError = new Error("Key Vault authentication failed");
    mocks.getEntity.mockResolvedValue({
      partitionKey: "pre-test",
      rowKey: "USER_001",
      pii: "{\"pii\":true}",
      etag: "etag-1",
      inviteStatus: InviteStatus.QUEUED,
    });
    mocks.updateEntity
      .mockResolvedValueOnce({ etag: "etag-2" })
      .mockResolvedValueOnce({ etag: "etag-3" });
    mocks.decryptPiiString.mockRejectedValue(keyVaultError);

    await expect(
      registeredHandler({ partitionKey: "pre-test", rowKey: "USER_001", inviteToken: "token-123" }, context)
    ).rejects.toThrow("Key Vault authentication failed");

    expect(mocks.updateEntity).toHaveBeenNthCalledWith(
      2,
      {
        partitionKey: "pre-test",
        rowKey: "USER_001",
        inviteStatus: InviteStatus.QUEUED,
        inviteError: "Key Vault authentication failed",
      },
      "Merge",
      { etag: "etag-2" }
    );
    expect(mocks.beginSend).not.toHaveBeenCalled();
  });
});
