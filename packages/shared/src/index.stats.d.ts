export const STATS_COUNTER_SHARDS_DEFAULT: number;
export const STATS_COUNTER_ROW_KEY: string;
export const STATS_COUNTER_SHARD_PREFIX: string;

export function buildStatsCounterShardPartitionKey(shardIndex: number): string;
