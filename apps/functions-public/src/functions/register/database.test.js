import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fromConnectionString: vi.fn(),
}));

vi.mock("@azure/data-tables", () => ({
  TableClient: {
    fromConnectionString: mocks.fromConnectionString,
  },
}));

import {
  getPhoneHashForUser,
  getOtpTable,
  claimOtpAttempt,
  storeOtpCode,
} from "./database.js";

describe("register database helpers", () => {
  beforeEach(() => {
    mocks.fromConnectionString.mockReset();
  });

  it("getOtpTable returns client without createTable call", async () => {
    const client = {
      createTable: vi.fn(),
    };
    mocks.fromConnectionString.mockReturnValue(client);

    const table = await getOtpTable("UseDevelopmentStorage=true", "OtpCodes");

    expect(table).toBe(client);
    expect(client.createTable).not.toHaveBeenCalled();
  });

  it("getPhoneHashForUser returns the matching phone hash row key", async () => {
    const phoneLockTable = {
      listEntities: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          yield { rowKey: "phone-hash-001" };
        },
      })),
    };

    await expect(getPhoneHashForUser(phoneLockTable, "USER_001")).resolves.toBe("phone-hash-001");
    expect(phoneLockTable.listEntities).toHaveBeenCalledWith({
      queryOptions: { filter: "userRowKey eq 'USER_001'" },
    });
  });

  it("storeOtpCode ensures table and retries when table is missing", async () => {
    const table = {
      upsertEntity: vi
        .fn()
        .mockRejectedValueOnce({ statusCode: 404 })
        .mockResolvedValueOnce(undefined),
      createTable: vi.fn().mockResolvedValue(undefined),
    };

    await storeOtpCode(table, "token-hash", "123456", "+316****678");

    expect(table.createTable).toHaveBeenCalledTimes(1);
    expect(table.upsertEntity).toHaveBeenCalledTimes(2);
  });

  it("claimOtpAttempt ensures table and retries when table is missing", async () => {
    const table = {
      getEntity: vi.fn().mockResolvedValue({
        partitionKey: "otp",
        rowKey: "token-hash",
        code: "123456",
        createdAt: new Date().toISOString(),
        attempts: 1,
        etag: "etag-123",
      }),
      updateEntity: vi
        .fn()
        .mockRejectedValueOnce({ statusCode: 404 })
        .mockResolvedValueOnce(undefined),
      createTable: vi.fn().mockResolvedValue(undefined),
    };

    await expect(claimOtpAttempt(table, "token-hash", 3)).resolves.toMatchObject({
      status: "claimed",
      attempts: 2,
    });

    expect(table.createTable).toHaveBeenCalledTimes(1);
    expect(table.updateEntity).toHaveBeenCalledTimes(2);
    expect(table.updateEntity).toHaveBeenCalledWith({
      partitionKey: "otp",
      rowKey: "token-hash",
      attempts: 2,
    }, "Merge", { ifMatch: "etag-123" });
  });

  it("retries a concurrent conflict so every request claims its own attempt", async () => {
    const table = {
      getEntity: vi
        .fn()
        .mockResolvedValueOnce({
          partitionKey: "otp",
          rowKey: "token-hash",
          code: "123456",
          createdAt: new Date().toISOString(),
          attempts: 0,
          etag: "etag-1",
        })
        .mockResolvedValueOnce({
          partitionKey: "otp",
          rowKey: "token-hash",
          code: "123456",
          createdAt: new Date().toISOString(),
          attempts: 1,
          etag: "etag-2",
        }),
      updateEntity: vi
        .fn()
        .mockRejectedValueOnce({ statusCode: 412 })
        .mockResolvedValueOnce(undefined),
      createTable: vi.fn(),
    };

    await expect(claimOtpAttempt(table, "token-hash", 3)).resolves.toMatchObject({
      status: "claimed",
      attempts: 2,
    });

    expect(table.getEntity).toHaveBeenCalledTimes(2);
    expect(table.updateEntity).toHaveBeenNthCalledWith(2, {
      partitionKey: "otp",
      rowKey: "token-hash",
      attempts: 2,
    }, "Merge", { ifMatch: "etag-2" });
    expect(table.createTable).not.toHaveBeenCalled();
  });

  it("does not compare or update an OTP after the attempt limit is reached", async () => {
    const otpEntity = {
      partitionKey: "otp",
      rowKey: "token-hash",
      code: "123456",
      createdAt: new Date().toISOString(),
      attempts: 3,
      etag: "etag-3",
    };
    const table = {
      getEntity: vi.fn().mockResolvedValue(otpEntity),
      updateEntity: vi.fn(),
    };

    await expect(claimOtpAttempt(table, "token-hash", 3)).resolves.toEqual({
      status: "limitReached",
      otpEntity,
    });
    expect(table.updateEntity).not.toHaveBeenCalled();
  });

  it("fails after bounded retries when concurrent updates keep conflicting", async () => {
    const table = {
      getEntity: vi.fn().mockResolvedValue({
        partitionKey: "otp",
        rowKey: "token-hash",
        code: "123456",
        createdAt: new Date().toISOString(),
        attempts: 0,
        etag: "etag-1",
      }),
      updateEntity: vi.fn().mockRejectedValue({ statusCode: 412 }),
    };

    await expect(claimOtpAttempt(table, "token-hash", 3)).rejects.toThrow(
      "OTP attempt could not be claimed due to concurrent updates",
    );
    expect(table.updateEntity).toHaveBeenCalledTimes(4);
  });
});
