export const STATS_COUNTER_SHARDS_DEFAULT = 32;
export const STATS_COUNTER_ROW_KEY = "counters";
export const STATS_COUNTER_SHARD_PREFIX = "counter-shard-";

export function buildStatsCounterShardPartitionKey(shardIndex) {
  return `${STATS_COUNTER_SHARD_PREFIX}${String(shardIndex).padStart(2, "0")}`;
}
