import type {
  CompactHistoryPartition,
  MarketItem,
  MarketSnapshot,
  SkyblockIndex,
  SkyblockIndexConstituent,
  SkyblockIndexPoint,
} from "./types";

export const SKYBLOCK_INDEX_BASE_VALUE = 1_000;
export const SKYBLOCK_INDEX_MAX_WEIGHT = 0.05;
export const SKYBLOCK_INDEX_MIN_WEEKLY_MATCHED = 1_000;

type PriceSnapshot = { time: number; prices: Map<string, number> };

function validPrice(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function priceSnapshots(history: CompactHistoryPartition[], bucketMs: number): PriceSnapshot[] {
  const grouped = new Map<number, Map<string, number>>();
  for (const partition of history) {
    const bucket = Math.floor(partition.updatedAt / bucketMs) * bucketMs;
    const prices = grouped.get(bucket) ?? new Map<string, number>();
    for (const [productId, values] of Object.entries(partition.items)) {
      if (validPrice(values[0])) prices.set(productId, values[0]);
    }
    grouped.set(bucket, prices);
  }
  return [...grouped.entries()]
    .map(([time, prices]) => ({ time, prices }))
    .sort((left, right) => left.time - right.time);
}

function cappedWeights(rawWeights: Array<{ item: MarketItem; weight: number }>): Array<{ item: MarketItem; weight: number }> {
  if (rawWeights.length === 0) return [];
  const cap = Math.max(SKYBLOCK_INDEX_MAX_WEIGHT, 1 / rawWeights.length);
  const total = rawWeights.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (!Number.isFinite(total) || total <= 0) return [];
  const pending = rawWeights.map((candidate) => ({ ...candidate, weight: candidate.weight / total }));
  const capped = new Set<number>();
  let remainingWeight = 1;
  let remainingRaw = 1;

  while (true) {
    const over = pending
      .map((candidate, index) => ({ index, weight: candidate.weight / remainingRaw * remainingWeight }))
      .filter(({ index, weight }) => !capped.has(index) && weight > cap + 1e-12);
    if (over.length === 0) break;
    for (const { index } of over) {
      capped.add(index);
      remainingWeight -= cap;
      remainingRaw -= pending[index]!.weight;
      pending[index]!.weight = cap;
    }
    if (remainingWeight <= 0 || remainingRaw <= 0) break;
  }

  if (remainingRaw > 0) {
    for (let index = 0; index < pending.length; index += 1) {
      if (!capped.has(index)) pending[index]!.weight = pending[index]!.weight / remainingRaw * remainingWeight;
    }
  }
  return pending;
}

/**
 * A capped, liquidity-weighted Laspeyres price index. Bazaar does not expose
 * circulating supply, so current seven-day matched coin volume is the closest
 * practical equivalent to an equity index's free-float market-cap weight.
 */
export function calculateSkyblockIndex(
  snapshot: MarketSnapshot,
  history: CompactHistoryPartition[],
  options: { bucketMs?: number } = {},
): SkyblockIndex | null {
  const points = priceSnapshots(history, options.bucketMs ?? 86_400_000);
  if (points.length === 0) return null;
  const currentPrices = new Map(snapshot.items.map((item) => [item.productId, item.midpoint]));
  const baseline = points[0]!;
  const candidates = snapshot.items.filter((item) => {
    const weeklyMatched = Math.min(item.buyMovingWeek, item.sellMovingWeek);
    return validPrice(item.midpoint)
      && weeklyMatched >= SKYBLOCK_INDEX_MIN_WEEKLY_MATCHED
      && validPrice(baseline.prices.get(item.productId))
      && validPrice(currentPrices.get(item.productId))
      && points.every((point) => validPrice(point.prices.get(item.productId)));
  });
  const weighted = cappedWeights(candidates.map((item) => ({
    item,
    // Square root dampens extreme Bazaar prices/volume while retaining the
    // liquidity weighting used by a float-adjusted market-cap index.
    weight: Math.sqrt(item.midpoint * Math.min(item.buyMovingWeek, item.sellMovingWeek)),
  })));
  if (weighted.length === 0) return null;

  const indexedPoints: SkyblockIndexPoint[] = points.map((point) => ({
    time: point.time,
    value: SKYBLOCK_INDEX_BASE_VALUE * weighted.reduce((sum, candidate) =>
      sum + candidate.weight * point.prices.get(candidate.item.productId)! / baseline.prices.get(candidate.item.productId)!, 0),
  }));
  const currentValue = SKYBLOCK_INDEX_BASE_VALUE * weighted.reduce((sum, candidate) =>
    sum + candidate.weight * candidate.item.midpoint / baseline.prices.get(candidate.item.productId)!, 0);
  indexedPoints.push({ time: snapshot.updatedAt, value: currentValue });

  const previous = indexedPoints.at(-2)?.value;
  const constituents: SkyblockIndexConstituent[] = weighted
    .map((candidate) => ({
      productId: candidate.item.productId,
      name: candidate.item.name,
      weight: candidate.weight,
      midpoint: candidate.item.midpoint,
      weeklyMatched: Math.min(candidate.item.buyMovingWeek, candidate.item.sellMovingWeek),
    }))
    .sort((left, right) => right.weight - left.weight);
  return {
    baseValue: SKYBLOCK_INDEX_BASE_VALUE,
    value: currentValue,
    ...(previous && previous > 0 ? { change24h: (currentValue / previous - 1) * 100 } : {}),
    points: indexedPoints,
    constituents,
    constituentCount: constituents.length,
    coveragePercent: candidates.length / snapshot.items.length * 100,
    maxConstituentWeight: SKYBLOCK_INDEX_MAX_WEIGHT,
  };
}
