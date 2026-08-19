import { describe, expect, it } from "vitest";
import {
  compactMarketSnapshot,
  HISTORY_PARTITION_COUNT,
  historyPartitionForProduct,
  importedPointsForRange,
  mergePriceHistory,
  partitionMarketSnapshot,
} from "./history";
import type { ImportedProductHistory, MarketSnapshot } from "./types";

const imported: ImportedProductHistory = {
  schemaVersion: 1,
  provider: "coflnet",
  productId: "TEST_ITEM",
  fetchedAt: 1,
  ranges: {
    day: { fetchedAt: 1, status: "ok", points: [[310_000, 31, 30, 32, 10]] },
    week: { fetchedAt: 1, status: "ok", points: [[200_000, 20, 19, 21, 20]] },
    history: { fetchedAt: 1, status: "ok", points: [[100_000, 10, 9, 11, 30]] },
  },
};

describe("imported history", () => {
  it("uses only high-resolution day data for 1h and 1d", () => {
    expect(importedPointsForRange(imported, "1d").map((point) => point.price)).toEqual([31]);
  });

  it("combines long-term ranges for month and all views", () => {
    expect(importedPointsForRange(imported, "all").map((point) => point.price)).toEqual([10, 20, 31]);
  });

  it("deduplicates by bucket and gives later sources priority", () => {
    const provider = [{ time: 301_000, price: 10, source: "coflnet" as const }];
    const primary = [{ time: 302_000, price: 11, source: "hypixel" as const }];
    expect(mergePriceHistory([provider, primary], 300_000)).toEqual([
      { time: 300_000, price: 11, source: "hypixel" },
    ]);
  });
});

describe("D1 history partitions", () => {
  it("assigns a product to a stable partition", () => {
    expect(historyPartitionForProduct("BOOSTER_COOKIE")).toBe(historyPartitionForProduct("BOOSTER_COOKIE"));
    expect(historyPartitionForProduct("BOOSTER_COOKIE")).toBeGreaterThanOrEqual(0);
    expect(historyPartitionForProduct("BOOSTER_COOKIE")).toBeLessThan(HISTORY_PARTITION_COUNT);
  });

  it("compacts and partitions every market item exactly once", () => {
    const item = {
      productId: "TEST_ITEM",
      name: "Test Item",
      updatedAt: 123,
      buyOrderPrice: 90,
      sellOrderPrice: 110,
      instantBuyPrice: 110,
      instantSellPrice: 90,
      marginCoins: 1,
      marginPercent: 1,
      coinsPerHour: 1,
      coinsPerHourEstimated: true as const,
      buyVolume: 4,
      sellVolume: 6,
      totalVolume: 10,
      buyMovingWeek: 1,
      sellMovingWeek: 1,
      weeklyVolume: 2,
      buyOrders: 1,
      sellOrders: 1,
      midpoint: 100,
      depthWithinFivePercent: {
        buyOrders: { quantity: 0, notional: 0, levels: 0 },
        sellOffers: { quantity: 0, notional: 0, levels: 0 },
        partial: false,
      },
      icon: { kind: "placeholder" as const, key: "TEST_ITEM" },
    };
    const snapshot: MarketSnapshot = {
      source: "hypixel",
      success: true,
      updatedAt: 123,
      taxRate: 0.01125,
      items: [item],
    };
    const compact = compactMarketSnapshot(snapshot);
    const partitions = partitionMarketSnapshot(compact);
    expect(partitions).toHaveLength(HISTORY_PARTITION_COUNT);
    expect(partitions.flatMap((partition) => Object.keys(partition.items))).toEqual(["TEST_ITEM"]);
    expect(compact.items.TEST_ITEM).toEqual([100, 90, 110, 10]);
  });
});
