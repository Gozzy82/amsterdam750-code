import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STATS_COUNTER_ROW_KEY, buildStatsCounterShardPartitionKey } from "@gozzy82/amsterdam750-shared/stats";
import {
  ensureTable,
  isTableNotFoundError,
  runWithTableEnsureOnNotFound,
  incrCounter,
  incrRegistrationsWithDaily,
  checkLimit,
  makeRowKeyDesc,
  computePartitionKey,
} from './storage.js';

// --- Mock TableClient factory ---
function makeClient(overrides = {}) {
  return {
    createTable: vi.fn().mockResolvedValue(undefined),
    createEntity: vi.fn().mockResolvedValue(undefined),
    getEntity: vi.fn(),
    updateEntity: vi.fn().mockResolvedValue(undefined),
    upsertEntity: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// =============================================================================

describe('ensureTable', () => {
  it('calls createTable on the client', async () => {
    const client = makeClient();
    await ensureTable(client);
    expect(client.createTable).toHaveBeenCalledOnce();
  });

  it('silently ignores a 409 conflict (table already exists)', async () => {
    const client = makeClient({ createTable: vi.fn().mockRejectedValue({ statusCode: 409 }) });
    await expect(ensureTable(client)).resolves.toBeUndefined();
  });

  it('rethrows non-409 errors', async () => {
    const err = { statusCode: 500, message: 'Internal error' };
    const client = makeClient({ createTable: vi.fn().mockRejectedValue(err) });
    await expect(ensureTable(client)).rejects.toBe(err);
  });
});

// =============================================================================

describe('isTableNotFoundError', () => {
  it('matches Azure TableNotFound responses', () => {
    expect(
      isTableNotFoundError({
        statusCode: 404,
        code: 'TableNotFound',
      })
    ).toBe(true);
  });

  it('does not match entity-level 404 responses', () => {
    expect(isTableNotFoundError({ statusCode: 404 })).toBe(false);
  });
});

// =============================================================================

describe('runWithTableEnsureOnNotFound', () => {
  it('creates the table and retries when Azure reports TableNotFound', async () => {
    const client = makeClient();
    const operation = vi.fn()
      .mockRejectedValueOnce({ statusCode: 404, code: 'TableNotFound' })
      .mockResolvedValueOnce('ok');

    await expect(runWithTableEnsureOnNotFound(client, operation)).resolves.toBe('ok');

    expect(client.createTable).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-table 404 errors', async () => {
    const error = { statusCode: 404 };
    const client = makeClient();
    const operation = vi.fn().mockRejectedValue(error);

    await expect(runWithTableEnsureOnNotFound(client, operation)).rejects.toBe(error);
    expect(client.createTable).not.toHaveBeenCalled();
  });
});

// =============================================================================

describe('incrCounter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it('creates a new counters row when none exists (404)', async () => {
    const client = makeClient({ getEntity: vi.fn().mockRejectedValue({ statusCode: 404 }) });
    await incrCounter(client, 'registrations');

    expect(client.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({ partitionKey: buildStatsCounterShardPartitionKey(0), rowKey: STATS_COUNTER_ROW_KEY, registrations: 1 }),
    );
  });

  it('increments an existing counter', async () => {
    const existing = { partitionKey: buildStatsCounterShardPartitionKey(0), rowKey: STATS_COUNTER_ROW_KEY, etag: 'etag-1', registrations: 5 };
    const client = makeClient({ getEntity: vi.fn().mockResolvedValue(existing) });
    await incrCounter(client, 'registrations');

    expect(client.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ registrations: 6 }),
      'Replace',
      expect.objectContaining({ etag: 'etag-1', matchCondition: 'IfNotModified' })
    );
  });

  it('initialises a new field to 1 on an existing row', async () => {
    const existing = { partitionKey: buildStatsCounterShardPartitionKey(0), rowKey: STATS_COUNTER_ROW_KEY, etag: 'etag-1', registrations: 3 };
    const client = makeClient({ getEntity: vi.fn().mockResolvedValue(existing) });
    await incrCounter(client, 'challenge_shown');

    expect(client.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ challenge_shown: 1, registrations: 3 }),
      'Replace',
      expect.any(Object)
    );
  });

  it('rethrows unexpected errors from getEntity', async () => {
    const err = { statusCode: 503 };
    const client = makeClient({ getEntity: vi.fn().mockRejectedValue(err) });
    await expect(incrCounter(client, 'registrations')).rejects.toBe(err);
  });

  it('retries after optimistic concurrency conflicts', async () => {
    const existing = { partitionKey: buildStatsCounterShardPartitionKey(0), rowKey: STATS_COUNTER_ROW_KEY, etag: 'etag-1', registrations: 5 };
    const client = makeClient({
      getEntity: vi.fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ ...existing, etag: 'etag-2' }),
      updateEntity: vi.fn()
        .mockRejectedValueOnce({ statusCode: 412, code: 'UpdateConditionNotSatisfied' })
        .mockResolvedValueOnce(undefined),
    });

    await incrCounter(client, 'registrations');
    expect(client.updateEntity).toHaveBeenCalledTimes(2);
  });
});

// =============================================================================

describe('incrRegistrationsWithDaily', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  it('increments both registrations and daily registrations field', async () => {
    const existing = { partitionKey: buildStatsCounterShardPartitionKey(0), rowKey: STATS_COUNTER_ROW_KEY, etag: 'etag-1', registrations: 5 };
    const client = makeClient({ getEntity: vi.fn().mockResolvedValue(existing) });
    const now = new Date('2026-07-10T12:00:00.000Z');
    await incrRegistrationsWithDaily(client, now);

    const [entity] = client.updateEntity.mock.calls[0];
    expect(entity.registrations).toBe(6);
    expect(entity["registrations_20260710"]).toBe(1);
    expect(client.updateEntity.mock.calls[0][1]).toBe('Replace');
  });

  it('creates counters row with both fields when row does not exist', async () => {
    const client = makeClient({ getEntity: vi.fn().mockRejectedValue({ statusCode: 404 }) });
    const now = new Date('2026-07-10T12:00:00.000Z');
    await incrRegistrationsWithDaily(client, now);

    expect(client.createEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: buildStatsCounterShardPartitionKey(0),
        rowKey: STATS_COUNTER_ROW_KEY,
        registrations: 1,
        ["registrations_20260710"]: 1,
      }),
    );
  });
});

// =============================================================================

describe('checkLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));
  });

  it('allows the first request (no existing counter)', async () => {
    const client = makeClient({ getEntity: vi.fn().mockRejectedValue({ statusCode: 404 }) });
    const result = await checkLimit(client, 'em:hash', 5, 600);
    expect(result.blocked).toBe(false);
    expect(client.upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      'Merge'
    );
  });

  it('allows a request when count is below the limit', async () => {
    const client = makeClient({ getEntity: vi.fn().mockResolvedValue({ count: 3 }) });
    const result = await checkLimit(client, 'em:hash', 5, 600);
    expect(result.blocked).toBe(false);
  });

  it('allows a request when count equals the limit exactly', async () => {
    const client = makeClient({ getEntity: vi.fn().mockResolvedValue({ count: 4 }) });
    const result = await checkLimit(client, 'em:hash', 5, 600);
    // count becomes 5, limit is 5 → 5 > 5 is false
    expect(result.blocked).toBe(false);
  });

  it('blocks when count exceeds the limit', async () => {
    const client = makeClient({ getEntity: vi.fn().mockResolvedValue({ count: 5 }) });
    const result = await checkLimit(client, 'em:hash', 5, 600);
    expect(result.blocked).toBe(true);
    expect(result.resetIn).toBeGreaterThan(0);
  });

  it('uses partitionKey derived from the provided key', async () => {
    const client = makeClient({ getEntity: vi.fn().mockRejectedValue({ statusCode: 404 }) });
    await checkLimit(client, 'em:hash', 3, 600);

    expect(client.getEntity).toHaveBeenCalledWith('rl-em:hash', expect.any(String));
  });

  it('rethrows unexpected errors from getEntity', async () => {
    const err = { statusCode: 500 };
    const client = makeClient({ getEntity: vi.fn().mockRejectedValue(err) });
    await expect(checkLimit(client, 'em:hash', 5, 600)).rejects.toBe(err);
  });
});

// =============================================================================

describe('makeRowKeyDesc', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('contains an underscore separator between timestamp and random suffix', () => {
    const key = makeRowKeyDesc();
    expect(key).toMatch(/^[a-z0-9]+_[a-z0-9]+$/);
  });

  it('produces descending values: a later call returns a numerically smaller timestamp part', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const early = makeRowKeyDesc();

    vi.setSystemTime(new Date('2024-06-01T00:00:00.000Z'));
    const later = makeRowKeyDesc();

    // Descending: earlier invocation time → larger inverted timestamp
    const [earlyTs] = early.split('_');
    const [laterTs] = later.split('_');
    expect(parseInt(earlyTs, 36)).toBeGreaterThan(parseInt(laterTs, 36));
  });

  it('generates unique keys for concurrent calls', () => {
    const keys = new Set(Array.from({ length: 100 }, () => makeRowKeyDesc()));
    // Random suffix should avoid collisions in practice
    expect(keys.size).toBeGreaterThan(90);
  });
});

// =============================================================================

describe('computePartitionKey', () => {
  it('returns a string prefixed with "pre-"', () => {
    const pk = computePartitionKey('user@example.com');
    expect(pk).toMatch(/^pre-[0-9a-f]{8}$/);
  });

  it('produces the same partition key for the same email', () => {
    expect(computePartitionKey('same@example.com')).toBe(computePartitionKey('same@example.com'));
  });

  it('produces different partition keys for different emails (with high probability)', () => {
    expect(computePartitionKey('a@example.com')).not.toBe(computePartitionKey('b@example.com'));
  });

  it('handles an empty string without throwing', () => {
    expect(() => computePartitionKey('')).not.toThrow();
    expect(computePartitionKey('')).toMatch(/^pre-[0-9a-f]{8}$/);
  });

  it('handles null/undefined by converting to string', () => {
    expect(() => computePartitionKey(null)).not.toThrow();
    expect(() => computePartitionKey(undefined)).not.toThrow();
  });
});
