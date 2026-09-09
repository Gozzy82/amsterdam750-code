import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteStatus } from "../../lib/invite-status.js";

const mocks = vi.hoisted(() => ({
  fromConnectionString: vi.fn(),
  queueFromConnectionString: vi.fn(),
  queueGetClient: vi.fn(),
  queueCreateIfNotExists: vi.fn(),
  queueSendMessage: vi.fn(),
  http: vi.fn(),
  randomUUID: vi.fn(),
  requireAuthenticatedAdmin: vi.fn(),
  listEntities: vi.fn(),
  updateEntity: vi.fn(),
}));

vi.mock("@azure/data-tables", () => ({
  TableClient: {
    fromConnectionString: mocks.fromConnectionString,
  },
}));

vi.mock("@azure/storage-queue", () => ({
  QueueServiceClient: {
    fromConnectionString: mocks.queueFromConnectionString,
  },
}));

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class DefaultAzureCredential {},
}));

vi.mock("@azure/functions", () => ({
  app: {
    http: mocks.http,
  },
}));

vi.mock("crypto", () => ({
  randomUUID: mocks.randomUUID,
}));

vi.mock("../../lib/admin-auth.js", () => ({
  requireAuthenticatedAdmin: mocks.requireAuthenticatedAdmin,
}));

function asAsyncIterable(items) {
  return (async function* iter() {
    for (const item of items) {
      yield item;
    }
  })();
}

describe("enqueueInvites", () => {
  async function loadModule() {
    vi.resetModules();
    return import("./index.js");
  }

  beforeEach(() => {
    process.env.TABLE_CONNECTION_STRING = "UseDevelopmentStorage=true";
    process.env.TABLE_NAME = "PreRegistrations";
    process.env.AzureWebJobsStorage = "UseDevelopmentStorage=true";
    process.env.QUEUE_NAME = "invite-jobs";

    mocks.fromConnectionString.mockReset();
    mocks.queueFromConnectionString.mockReset();
    mocks.queueGetClient.mockReset();
    mocks.queueCreateIfNotExists.mockReset();
    mocks.queueSendMessage.mockReset();
    mocks.http.mockReset();
    mocks.randomUUID.mockReset();
    mocks.requireAuthenticatedAdmin.mockReset();
    mocks.listEntities.mockReset();
    mocks.updateEntity.mockReset();

    mocks.requireAuthenticatedAdmin.mockReturnValue({ ok: true });
    mocks.randomUUID
      .mockReturnValueOnce("uuid-1")
      .mockReturnValueOnce("uuid-2")
      .mockReturnValue("uuid-next");

    mocks.fromConnectionString.mockReturnValue({
      listEntities: mocks.listEntities,
      updateEntity: mocks.updateEntity,
    });
    mocks.queueGetClient.mockReturnValue({
      createIfNotExists: mocks.queueCreateIfNotExists,
      sendMessage: mocks.queueSendMessage,
    });
    mocks.queueFromConnectionString.mockReturnValue({
      getQueueClient: mocks.queueGetClient,
    });
    mocks.queueCreateIfNotExists.mockResolvedValue(undefined);
    mocks.queueSendMessage.mockResolvedValue(undefined);
  });

  it("claims eligible entities with their etag before queueing jobs", async () => {
    mocks.listEntities.mockReturnValue(asAsyncIterable([
      { partitionKey: "pre", rowKey: "USER_001", kind: "user", etag: "etag-1" },
    ]));
    mocks.updateEntity.mockResolvedValueOnce({ etag: "etag-2" });

    const { enqueueInvites } = await loadModule();
    const result = await enqueueInvites();

    expect(result).toEqual({ total: 1, skipped: 0, queued: 1, dryRun: false });
    expect(mocks.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: "pre",
        rowKey: "USER_001",
        inviteToken: "uuid-1",
        inviteStatus: InviteStatus.QUEUED,
        inviteError: "",
      }),
      "Merge",
      { etag: "etag-1" }
    );
    expect(mocks.queueSendMessage).toHaveBeenCalledWith(
      JSON.stringify({ partitionKey: "pre", rowKey: "USER_001", inviteToken: "uuid-1" }),
      { visibilityTimeout: 0 }
    );
  });

  it("skips entities that another concurrent sender already claimed", async () => {
    mocks.listEntities.mockReturnValue(asAsyncIterable([
      { partitionKey: "pre", rowKey: "USER_001", kind: "user", etag: "etag-1" },
      { partitionKey: "pre", rowKey: "USER_002", kind: "user", etag: "etag-2" },
    ]));
    mocks.updateEntity
      .mockRejectedValueOnce({ statusCode: 412 })
      .mockResolvedValueOnce({ etag: "etag-3" });

    const { enqueueInvites } = await loadModule();
    const result = await enqueueInvites();

    expect(result).toEqual({ total: 2, skipped: 1, queued: 1, dryRun: false });
    expect(mocks.queueSendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.queueSendMessage).toHaveBeenCalledWith(
      JSON.stringify({ partitionKey: "pre", rowKey: "USER_002", inviteToken: "uuid-2" }),
      { visibilityTimeout: 0 }
    );
  });

  it("treats sending entities as already in progress", async () => {
    mocks.listEntities.mockReturnValue(asAsyncIterable([
      { partitionKey: "pre", rowKey: "USER_001", kind: "user", etag: "etag-1", inviteStatus: InviteStatus.SENDING },
    ]));

    const { enqueueInvites } = await loadModule();
    const result = await enqueueInvites();

    expect(result).toEqual({ total: 1, skipped: 1, queued: 0, dryRun: false });
    expect(mocks.updateEntity).not.toHaveBeenCalled();
    expect(mocks.queueSendMessage).not.toHaveBeenCalled();
  });

  it("rolls the entity back to error with the claimed etag when queueing fails", async () => {
    const queueError = new Error("Queue unavailable");
    mocks.listEntities.mockReturnValue(asAsyncIterable([
      { partitionKey: "pre", rowKey: "USER_001", kind: "user", etag: "etag-1" },
    ]));
    mocks.updateEntity
      .mockResolvedValueOnce({ etag: "etag-2" })
      .mockResolvedValueOnce({ etag: "etag-3" });
    mocks.queueSendMessage.mockRejectedValue(queueError);

    const { enqueueInvites } = await loadModule();

    await expect(enqueueInvites()).rejects.toThrow("Queue unavailable");
    expect(mocks.updateEntity).toHaveBeenNthCalledWith(
      2,
      {
        partitionKey: "pre",
        rowKey: "USER_001",
        inviteStatus: InviteStatus.ERROR,
        inviteError: "Queue unavailable",
      },
      "Merge",
      { etag: "etag-2" }
    );
  });
});
