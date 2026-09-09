import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fromConnectionString: vi.fn(),
  deleteTable: vi.fn(),
  createTable: vi.fn(),
  upsertEntity: vi.fn(),
}));

vi.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: mocks.fromConnectionString,
  },
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class DefaultAzureCredential {},
}));

import { deleteAllPreRegistrations } from './index.js';

describe('deleteAllPreRegistrations', () => {
  beforeEach(() => {
    process.env.TABLE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    delete process.env.TABLE_NAME;
    delete process.env.PHONE_LOCK_TABLE_NAME;
    delete process.env.STATS_TABLE_NAME;

    mocks.fromConnectionString.mockReset();
    mocks.deleteTable.mockReset();
    mocks.createTable.mockReset();
    mocks.upsertEntity.mockReset();
  });

  it('reinitializes the preregistration, phone lock and stats tables without scanning entities', async () => {
    mocks.fromConnectionString.mockImplementation((conn, tableName) => ({
      conn,
      tableName,
      deleteTable: mocks.deleteTable,
      createTable: mocks.createTable,
      upsertEntity: mocks.upsertEntity,
    }));

    const result = await deleteAllPreRegistrations();

    expect(result).toEqual({
      reinitializedTables: ['PreRegistrations', 'PhoneLocks', 'Stats'],
      tableName: 'PreRegistrations',
      phoneLockTableName: 'PhoneLocks',
      statsTableName: 'Stats',
    });
    expect(mocks.fromConnectionString).toHaveBeenCalledTimes(3);
    expect(mocks.fromConnectionString).toHaveBeenNthCalledWith(1, 'UseDevelopmentStorage=true', 'PreRegistrations');
    expect(mocks.fromConnectionString).toHaveBeenNthCalledWith(2, 'UseDevelopmentStorage=true', 'PhoneLocks');
    expect(mocks.fromConnectionString).toHaveBeenNthCalledWith(3, 'UseDevelopmentStorage=true', 'Stats');
    expect(mocks.deleteTable).toHaveBeenCalledTimes(3);
    expect(mocks.createTable).toHaveBeenCalledTimes(3);
    expect(mocks.upsertEntity).toHaveBeenCalledTimes(1);
    expect(mocks.upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'global',
        rowKey: 'counters',
        registrations: 0,
        challenge_shown: 0,
        challenge_failed: 0,
        challenge_passed: 0,
        blocked_honeypot: 0,
      }),
      'Replace'
    );
  });

  it('retries table creation when Azure reports TableBeingDeleted', async () => {
    mocks.fromConnectionString.mockImplementation((conn, tableName) => ({
      conn,
      tableName,
      deleteTable: mocks.deleteTable,
      createTable: mocks.createTable,
      upsertEntity: mocks.upsertEntity,
    }));
    mocks.createTable
      .mockRejectedValueOnce({ statusCode: 409, code: 'TableBeingDeleted', message: 'The table specified is being deleted.' })
      .mockResolvedValue(undefined);

    const result = await deleteAllPreRegistrations();

    expect(result.reinitializedTables).toEqual(['PreRegistrations', 'PhoneLocks', 'Stats']);
    expect(mocks.createTable).toHaveBeenCalledTimes(4);
    expect(mocks.upsertEntity).toHaveBeenCalledTimes(1);
  });

  it('logs retry details when table recreation is delayed', async () => {
    const log = vi.fn();
    mocks.fromConnectionString.mockImplementation((conn, tableName) => ({
      conn,
      tableName,
      deleteTable: mocks.deleteTable,
      createTable: mocks.createTable,
      upsertEntity: mocks.upsertEntity,
    }));
    mocks.createTable
      .mockRejectedValueOnce({ statusCode: 409, code: 'TableBeingDeleted', message: 'The table specified is being deleted.' })
      .mockResolvedValue(undefined);

    await deleteAllPreRegistrations({ log });

    expect(log).toHaveBeenCalledWith(
      'delete-preregistrations: tabel nog in verwijdering, retry',
      expect.objectContaining({
        tableName: 'PreRegistrations',
        attempt: 1,
        maxAttempts: 20,
        retryDelayMs: 300,
      })
    );
    expect(log).toHaveBeenCalledWith(
      'delete-preregistrations: tabel aangemaakt na retries',
      expect.objectContaining({
        tableName: 'PreRegistrations',
        attempt: 2,
      })
    );
  });
});
