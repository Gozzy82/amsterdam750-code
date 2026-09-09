import { beforeEach, describe, expect, it, vi } from "vitest";
import { STATS_COUNTER_ROW_KEY, buildStatsCounterShardPartitionKey } from "@gozzy82/amsterdam750-shared/stats";

const mocks = vi.hoisted(() => ({
  fromConnectionString: vi.fn(),
  http: vi.fn(),
}));

vi.mock("@azure/data-tables", () => ({
  TableClient: {
    fromConnectionString: mocks.fromConnectionString,
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

import { _statsHandler, resetStatsCacheForTests } from "./index.js";

function asAsyncIterable(items) {
  return (async function* iter() {
    for (const item of items) {
      yield item;
    }
  })();
}

describe("stats handler", () => {
  function toDailyField(dateKey) {
    return `registrations_${String(dateKey).replaceAll("-", "")}`;
  }

  beforeEach(() => {
    process.env.TABLE_CONNECTION_STRING = "UseDevelopmentStorage=true";
    process.env.TABLE_NAME = "PreRegistrations";
    process.env.STATS_TABLE_NAME = "Stats";
    process.env.STATS_CACHE_TTL_MS = "60000";

    resetStatsCacheForTests();
    mocks.fromConnectionString.mockReset();
    mocks.http.mockReset();
  });

  it("uses registrations and daily counters without scanning user rows", async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const dataTable = {
      listEntities: vi.fn(() => asAsyncIterable([
        { kind: "user" },
      ])),
    };
    const statsTable = {
      getEntity: vi.fn(async () => ({
        partitionKey: "global",
        rowKey: STATS_COUNTER_ROW_KEY,
        registrations: 42,
        [toDailyField(today)]: 2,
        challenge_shown: 3,
      })),
      listEntities: vi.fn(() => asAsyncIterable([])),
    };

    mocks.fromConnectionString.mockImplementation((_conn, tableName) =>
      tableName === "PreRegistrations" ? dataTable : statsTable
    );

    const response = await _statsHandler({}, { log: vi.fn() });
    const body = JSON.parse(response.body);

    expect(body.totalRegistrations).toBe(42);
    expect(body.dailyCounts).toHaveLength(30);
    expect(body.dailyCounts.find((entry) => entry.date === today)?.count).toBe(2);
    expect(dataTable.listEntities).not.toHaveBeenCalled();
  });

  it("falls back to full user count when registrations counter is missing", async () => {
    const dataTable = {
      listEntities: vi.fn(() => asAsyncIterable([{ kind: "user" }, { kind: "user" }, { kind: "user" }])),
    };
    const statsTable = {
      getEntity: vi.fn(async () => ({
        partitionKey: "global",
        rowKey: STATS_COUNTER_ROW_KEY,
        challenge_shown: 5,
      })),
      listEntities: vi.fn(() => asAsyncIterable([])),
    };

    mocks.fromConnectionString.mockImplementation((_conn, tableName) =>
      tableName === "PreRegistrations" ? dataTable : statsTable
    );

    const response = await _statsHandler({}, { log: vi.fn() });
    const body = JSON.parse(response.body);

    expect(body.totalRegistrations).toBe(3);
    expect(dataTable.listEntities).toHaveBeenCalledTimes(1);
    expect(dataTable.listEntities.mock.calls[0][0].queryOptions.filter).toBe("kind eq 'user'");
  });

  it("returns cached payload while cache ttl is valid", async () => {
    const dataTable = {
      listEntities: vi.fn(() => asAsyncIterable([])),
    };
    const statsTable = {
      getEntity: vi.fn(async () => ({
        partitionKey: "global",
        rowKey: STATS_COUNTER_ROW_KEY,
        registrations: 9,
      })),
      listEntities: vi.fn(() => asAsyncIterable([])),
    };

    mocks.fromConnectionString.mockImplementation((_conn, tableName) =>
      tableName === "PreRegistrations" ? dataTable : statsTable
    );

    const context = { log: vi.fn() };

    const first = await _statsHandler({}, context);
    const second = await _statsHandler({}, context);

    expect(JSON.parse(first.body).totalRegistrations).toBe(9);
    expect(JSON.parse(second.body).totalRegistrations).toBe(9);
    expect(dataTable.listEntities).not.toHaveBeenCalled();
    expect(statsTable.getEntity).toHaveBeenCalledTimes(1);
    expect(statsTable.listEntities).toHaveBeenCalledTimes(1);
  });

  it("falls back to full user count when registrations counter is lower than daily counters", async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterdayDate = new Date(now);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = yesterdayDate.toISOString().slice(0, 10);

    const dataTable = {
      listEntities: vi.fn(() => asAsyncIterable([
        { kind: "user" },
        { kind: "user" },
        { kind: "user" },
        { kind: "user" },
        { kind: "user" },
      ])),
    };
    const statsTable = {
      getEntity: vi.fn(async () => ({
        partitionKey: "global",
        rowKey: STATS_COUNTER_ROW_KEY,
        registrations: 1,
        [toDailyField(today)]: 2,
        [toDailyField(yesterday)]: 1,
      })),
      listEntities: vi.fn(() => asAsyncIterable([])),
    };

    mocks.fromConnectionString.mockImplementation((_conn, tableName) =>
      tableName === "PreRegistrations" ? dataTable : statsTable
    );

    const response = await _statsHandler({}, { log: vi.fn() });
    const body = JSON.parse(response.body);

    expect(body.totalRegistrations).toBe(5);
    expect(dataTable.listEntities).toHaveBeenCalledTimes(1);
    expect(dataTable.listEntities.mock.calls[0][0].queryOptions.filter).toBe("kind eq 'user'");
  });

  it("reads legacy daily counters with dashed date fields", async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const dataTable = {
      listEntities: vi.fn(() => asAsyncIterable([])),
    };
    const statsTable = {
      getEntity: vi.fn(async () => ({
        partitionKey: "global",
        rowKey: STATS_COUNTER_ROW_KEY,
        registrations: 12,
        [`registrations_${today}`]: 4,
      })),
      listEntities: vi.fn(() => asAsyncIterable([])),
    };

    mocks.fromConnectionString.mockImplementation((_conn, tableName) =>
      tableName === "PreRegistrations" ? dataTable : statsTable
    );

    const response = await _statsHandler({}, { log: vi.fn() });
    const body = JSON.parse(response.body);

    expect(body.totalRegistrations).toBe(12);
    expect(body.dailyCounts.find((entry) => entry.date === today)?.count).toBe(4);
  });

  it("creates the stats table when Azure reports TableNotFound and returns zeros", async () => {
    const statsTable = {
      createTable: vi.fn(async () => undefined),
      getEntity: vi.fn(async () => {
        throw { statusCode: 404, code: "TableNotFound" };
      }),
      listEntities: vi.fn(() => asAsyncIterable([])),
    };
    const dataTable = {
      createTable: vi.fn(async () => undefined),
      listEntities: vi.fn(() => asAsyncIterable([])),
    };

    mocks.fromConnectionString.mockImplementation((_conn, tableName) =>
      tableName === "PreRegistrations" ? dataTable : statsTable
    );

    const response = await _statsHandler({}, { log: vi.fn() });
    const body = JSON.parse(response.body);

    expect(response.status).toBe(200);
    expect(body.totalRegistrations).toBe(0);
    expect(statsTable.createTable).toHaveBeenCalledTimes(1);
  });

  it("creates the preregistration table when a full scan hits TableNotFound", async () => {
    const dataTable = {
      createTable: vi.fn(async () => undefined),
      listEntities: vi.fn()
        .mockImplementationOnce(() => ({
          async *[Symbol.asyncIterator]() {
            throw { statusCode: 404, code: "TableNotFound" };
          },
        }))
        .mockImplementationOnce(() => asAsyncIterable([])),
    };
    const statsTable = {
      createTable: vi.fn(async () => undefined),
      getEntity: vi.fn(async () => ({
        partitionKey: "global",
        rowKey: STATS_COUNTER_ROW_KEY,
        challenge_shown: 1,
      })),
      listEntities: vi.fn(() => asAsyncIterable([])),
    };

    mocks.fromConnectionString.mockImplementation((_conn, tableName) =>
      tableName === "PreRegistrations" ? dataTable : statsTable
    );

    const response = await _statsHandler({}, { log: vi.fn() });
    const body = JSON.parse(response.body);

    expect(response.status).toBe(200);
    expect(body.totalRegistrations).toBe(0);
    expect(dataTable.createTable).toHaveBeenCalledTimes(1);
    expect(dataTable.listEntities).toHaveBeenCalledTimes(2);
  });

  it("aggregates shard counters together with legacy counters", async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const dataTable = {
      listEntities: vi.fn(() => asAsyncIterable([])),
    };
    const statsTable = {
      getEntity: vi.fn(async () => ({
        partitionKey: "global",
        rowKey: STATS_COUNTER_ROW_KEY,
        registrations: 12,
        [toDailyField(today)]: 4,
        challenge_shown: 2,
      })),
      listEntities: vi.fn(() => asAsyncIterable([
        {
          partitionKey: buildStatsCounterShardPartitionKey(0),
          rowKey: STATS_COUNTER_ROW_KEY,
          registrations: 10,
          [toDailyField(today)]: 3,
          challenge_shown: 1,
        },
        {
          partitionKey: buildStatsCounterShardPartitionKey(1),
          rowKey: STATS_COUNTER_ROW_KEY,
          registrations: 8,
          [toDailyField(today)]: 2,
          challenge_shown: 5,
        },
      ])),
    };

    mocks.fromConnectionString.mockImplementation((_conn, tableName) =>
      tableName === "PreRegistrations" ? dataTable : statsTable
    );

    const response = await _statsHandler({}, { log: vi.fn() });
    const body = JSON.parse(response.body);

    expect(body.totalRegistrations).toBe(30);
    expect(body.dailyCounts.find((entry) => entry.date === today)?.count).toBe(9);
    expect(body.counters.challenge_shown).toBe(8);
    expect(statsTable.listEntities).toHaveBeenCalledWith({
      queryOptions: { filter: `RowKey eq '${STATS_COUNTER_ROW_KEY}'` },
    });
    expect(dataTable.listEntities).not.toHaveBeenCalled();
  });
});
