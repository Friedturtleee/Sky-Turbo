import type {
  CompactHistoryPartition,
  CompactMarketSnapshot,
  CompactPricePoint,
  ImportedHistoryRangeKey,
  ImportedProductHistory,
  MarketSnapshot,
  PricePoint,
} from "./types";

export const HISTORY_PARTITION_COUNT = 8;

export function historyPartitionForProduct(productId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < productId.length; index += 1) {
    hash ^= productId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % HISTORY_PARTITION_COUNT;
}

export function compactMarketSnapshot(snapshot: MarketSnapshot): CompactMarketSnapshot {
  return {
    updatedAt: snapshot.updatedAt,
    items: Object.fromEntries(
      snapshot.items.map((item) => [
        item.productId,
        [item.midpoint, item.buyOrderPrice, item.sellOrderPrice, item.totalVolume],
      ]),
    ),
  };
}

export function partitionMarketSnapshot(snapshot: CompactMarketSnapshot): CompactHistoryPartition[] {
  const partitions: CompactHistoryPartition[] = Array.from({ length: HISTORY_PARTITION_COUNT }, (_, partition) => ({
    updatedAt: snapshot.updatedAt,
    partition,
    items: {},
  }));
  for (const [productId, item] of Object.entries(snapshot.items)) {
    partitions[historyPartitionForProduct(productId)]!.items[productId] = item;
  }
  return partitions;
}

export function historyRangeConfig(range: string): {
  tier: "5m" | "1h" | "1d";
  duration: number;
  bucketMs: number;
} {
  if (range === "1h") return { tier: "5m", duration: 3_600_000, bucketMs: 300_000 };
  if (range === "1d") return { tier: "5m", duration: 86_400_000, bucketMs: 300_000 };
  if (range === "1mo") return { tier: "1h", duration: 30 * 86_400_000, bucketMs: 3_600_000 };
  return { tier: "1d", duration: Number.POSITIVE_INFINITY, bucketMs: 86_400_000 };
}

export function compactPricePoint(point: PricePoint): CompactPricePoint {
  return [
    point.time,
    point.price,
    point.buyOrderPrice ?? 0,
    point.sellOrderPrice ?? 0,
    point.volume ?? 0,
  ];
}

export function expandPricePoint(point: CompactPricePoint, source: PricePoint["source"]): PricePoint {
  return {
    time: point[0],
    price: point[1],
    buyOrderPrice: point[2] || undefined,
    sellOrderPrice: point[3] || undefined,
    volume: point[4] || undefined,
    source,
  };
}

export function importedPointsForRange(
  history: ImportedProductHistory,
  range: "1h" | "1d" | "1mo" | "all",
): PricePoint[] {
  const keys: ImportedHistoryRangeKey[] =
    range === "1h" || range === "1d" ? ["day"] : ["history", "week", "day"];
  return keys.flatMap((key) =>
    (history.ranges[key]?.points ?? []).map((point) => expandPricePoint(point, "coflnet")),
  );
}

/**
 * Later sources have priority. Points are deduplicated at the storage/display
 * resolution instead of by their provider-specific raw timestamp.
 */
export function mergePriceHistory(
  sources: PricePoint[][],
  bucketMs: number,
  cutoff = 0,
): PricePoint[] {
  const buckets = new Map<number, PricePoint>();
  for (const points of sources) {
    for (const point of [...points].sort((a, b) => a.time - b.time)) {
      if (!Number.isFinite(point.time) || !Number.isFinite(point.price) || point.price <= 0) continue;
      const time = Math.floor(point.time / bucketMs) * bucketMs;
      if (time < cutoff) continue;
      buckets.set(time, { ...point, time });
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
