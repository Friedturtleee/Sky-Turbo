import { describe, expect, it } from "vitest";
import { calculateSkyblockIndex } from "./skyblock-index";
import type { CompactHistoryPartition, MarketItem, MarketSnapshot } from "./types";

function item(productId: string, midpoint: number, weeklyMatched = 10_000): MarketItem {
  return {
    productId,
    name: productId,
    updatedAt: 3 * 86_400_000,
    buyOrderPrice: midpoint,
    sellOrderPrice: midpoint,
    instantBuyPrice: midpoint,
    instantSellPrice: midpoint,
    marginCoins: 0,
    marginPercent: 0,
    coinsPerHour: 0,
    coinsPerHourEstimated: true,
    buyVolume: weeklyMatched,
    sellVolume: weeklyMatched,
    totalVolume: weeklyMatched * 2,
    buyMovingWeek: weeklyMatched,
    sellMovingWeek: weeklyMatched,
    weeklyVolume: weeklyMatched * 2,
    buyOrders: 1,
    sellOrders: 1,
    midpoint,
    depthWithinFivePercent: {
      buyOrders: { quantity: 1, notional: midpoint, levels: 1 },
      sellOffers: { quantity: 1, notional: midpoint, levels: 1 },
      partial: false,
    },
    icon: { kind: "placeholder", key: productId },
  };
}

function history(time: number, prices: Record<string, number>): CompactHistoryPartition {
  return {
    updatedAt: time,
    partition: 0,
    items: Object.fromEntries(Object.entries(prices).map(([productId, price]) => [productId, [price, price, price, 1]])),
  };
}

describe("calculateSkyblockIndex", () => {
  it("normalizes its first historical basket point to 1,000", () => {
    const snapshot: MarketSnapshot = {
      source: "hypixel", success: true, updatedAt: 3 * 86_400_000, taxRate: 0.01125,
      items: [item("A", 110), item("B", 100), item("C", 90)],
    };
    const index = calculateSkyblockIndex(snapshot, [
      history(86_400_000, { A: 100, B: 100, C: 100 }),
      history(2 * 86_400_000, { A: 105, B: 100, C: 95 }),
    ]);
    expect(index).not.toBeNull();
    expect(index!.points[0]!.value).toBe(1_000);
    expect(index!.value).toBeCloseTo(1_000);
    expect(index!.constituentCount).toBe(3);
  });

  it("caps a single highly liquid product at five percent when the basket is large enough", () => {
    const prices = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`I${index}`, 100]));
    const snapshot: MarketSnapshot = {
      source: "hypixel", success: true, updatedAt: 2 * 86_400_000, taxRate: 0.01125,
      items: Array.from({ length: 25 }, (_, index) => item(`I${index}`, 100, index === 0 ? 1_000_000_000 : 10_000)),
    };
    const index = calculateSkyblockIndex(snapshot, [history(86_400_000, prices)]);
    expect(index).not.toBeNull();
    expect(index!.constituents[0]!.weight).toBeCloseTo(0.05);
    expect(index!.constituents.every((constituent) => constituent.weight <= 0.05 + 1e-12)).toBe(true);
  });
});
