import {
  BAZAAR_TAX_RATE,
  type DepthSide,
  type HypixelBazaarProduct,
  type HypixelBazaarResponse,
  type MarketItem,
  type MarketSnapshot,
  type OrderLevel,
  type PricePoint,
} from "./types";

const safeNumber = (value: number | undefined): number =>
  Number.isFinite(value) ? (value ?? 0) : 0;

export function productName(productId: string): string {
  return productId
    .replace(/^SHARD_/, "")
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function sumDepth(levels: OrderLevel[], predicate: (price: number) => boolean): DepthSide {
  return levels.reduce<DepthSide>(
    (result, level) => {
      if (!predicate(level.pricePerUnit)) return result;
      result.quantity += level.amount;
      result.notional += level.amount * level.pricePerUnit;
      result.levels += 1;
      return result;
    },
    { quantity: 0, notional: 0, levels: 0 },
  );
}

export function calculateMarketItem(
  product: HypixelBazaarProduct,
  updatedAt: number,
  taxRate = BAZAAR_TAX_RATE,
): MarketItem | null {
  // Hypixel naming is from the maker's perspective: buy_summary is sell offers,
  // while sell_summary is buy orders.
  const sellOrderPrice = safeNumber(product.buy_summary[0]?.pricePerUnit);
  const buyOrderPrice = safeNumber(product.sell_summary[0]?.pricePerUnit);
  if (sellOrderPrice <= 0 || buyOrderPrice <= 0) return null;

  const marginCoins = sellOrderPrice * (1 - taxRate) - buyOrderPrice;
  const weeklyMatched = Math.min(
    safeNumber(product.quick_status.buyMovingWeek),
    safeNumber(product.quick_status.sellMovingWeek),
  );
  const midpoint = (sellOrderPrice + buyOrderPrice) / 2;
  const lower = midpoint * 0.95;
  const upper = midpoint * 1.05;

  return {
    productId: product.product_id,
    name: productName(product.product_id),
    updatedAt,
    buyOrderPrice,
    sellOrderPrice,
    instantBuyPrice: sellOrderPrice,
    instantSellPrice: buyOrderPrice,
    marginCoins,
    marginPercent: buyOrderPrice > 0 ? (marginCoins / buyOrderPrice) * 100 : 0,
    coinsPerHour: marginCoins * (weeklyMatched / 168),
    coinsPerHourEstimated: true,
    buyVolume: safeNumber(product.quick_status.buyVolume),
    sellVolume: safeNumber(product.quick_status.sellVolume),
    totalVolume:
      safeNumber(product.quick_status.buyVolume) + safeNumber(product.quick_status.sellVolume),
    buyMovingWeek: safeNumber(product.quick_status.buyMovingWeek),
    sellMovingWeek: safeNumber(product.quick_status.sellMovingWeek),
    weeklyVolume:
      safeNumber(product.quick_status.buyMovingWeek) +
      safeNumber(product.quick_status.sellMovingWeek),
    buyOrders: safeNumber(product.quick_status.buyOrders),
    sellOrders: safeNumber(product.quick_status.sellOrders),
    midpoint,
    depthWithinFivePercent: {
      buyOrders: sumDepth(product.sell_summary, (price) => price >= lower && price <= midpoint),
      sellOffers: sumDepth(product.buy_summary, (price) => price <= upper && price >= midpoint),
      partial: product.sell_summary.length >= 30 || product.buy_summary.length >= 30,
    },
    icon: { kind: "placeholder", key: product.product_id },
  };
}

export function calculateMarketSnapshot(
  response: HypixelBazaarResponse,
  taxRate = BAZAAR_TAX_RATE,
): MarketSnapshot {
  if (!response.success || !response.products) {
    throw new Error("Hypixel Bazaar returned an unsuccessful response");
  }

  const items = Object.values(response.products)
    .map((product) => calculateMarketItem(product, response.lastUpdated, taxRate))
    .filter((item): item is MarketItem => item !== null);

  return {
    source: "hypixel",
    success: true,
    updatedAt: response.lastUpdated,
    taxRate,
    items,
  };
}

function closestPoint(points: PricePoint[], target: number): PricePoint | undefined {
  let best: PricePoint | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const nextDistance = Math.abs(point.time - target);
    if (nextDistance < distance) {
      distance = nextDistance;
      best = point;
    }
  }
  return best;
}

export function percentageChange(current: number, previous?: number): number | undefined {
  if (!previous || previous <= 0) return undefined;
  return ((current - previous) / previous) * 100;
}

export function isCrashingMarketItem(item: MarketItem, thresholdPercent = 30): boolean {
  return item.buyOrderChange24h !== undefined && item.buyOrderChange24h < -Math.abs(thresholdPercent);
}

export function enrichWithHistory(item: MarketItem, points: PricePoint[]): MarketItem {
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const now = item.updatedAt;
  const current = item.midpoint;
  const changes: MarketItem["changes"] = {};
  const changeRanges = { "10m": 10 * 60_000, "1h": 60 * 60_000, "1d": 86_400_000, "1mo": 30 * 86_400_000 } as const;
  for (const [range, duration] of Object.entries(changeRanges) as [keyof typeof changeRanges, number][]) {
    const value = percentageChange(current, closestPoint(sorted, now - duration)?.price);
    if (value !== undefined) changes[range] = value;
  }

  const volatility: NonNullable<MarketItem["volatility"]> = {};
  const volatilityRanges = { "1d": 1, "3d": 3, "7d": 7, "30d": 30 } as const;
  for (const [range, days] of Object.entries(volatilityRanges) as [keyof typeof volatilityRanges, number][]) {
    const start = now - days * 86_400_000;
    const window = sorted.filter((point) => point.time >= start && point.price > 0);
    if (window.length === 0) continue;
    const average = window.reduce((sum, point) => sum + point.price, 0) / window.length;
    volatility[range] = average > 0 ? (Math.abs(current - average) / average) * 100 : 0;
  }

  const buyOrderHistory = sorted.filter(
    (point) => point.buyOrderPrice !== undefined && point.buyOrderPrice > 0,
  );
  const buyOrderChange24h = percentageChange(
    item.buyOrderPrice,
    closestPoint(buyOrderHistory, now - 86_400_000)?.buyOrderPrice,
  );

  return { ...item, changes, buyOrderChange24h, volatility };
}
