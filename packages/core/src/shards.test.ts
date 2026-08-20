import { describe, expect, it } from "vitest";
import { applyCrocodileLevelToFlip, calculateShardFlips, collectShardRouteMaterials, scaleShardRouteForOutput } from "./shards";
import type { FusionData, MarketItem } from "./types";

const data: FusionData = {
  shards: {
    A: { name: "Alpha", family: "Reptile Family", type: "Global", rarity: "common", fuse_amount: 2, internal_id: "SHARD_ALPHA" },
    B: { name: "Beta", family: "Forest Family", type: "Global", rarity: "common", fuse_amount: 3, internal_id: "SHARD_BETA" },
    C: { name: "Gamma", family: "Forest Family", type: "Global", rarity: "rare", fuse_amount: 1, internal_id: "SHARD_GAMMA" },
  },
  recipes: { C: { "2": [["A", "B"]] } },
};

function market(productId: string, buyOrderPrice: number, sellOrderPrice: number, totalVolume = 100): MarketItem {
  return {
    productId, name: productId, updatedAt: 1, buyOrderPrice, sellOrderPrice,
    instantBuyPrice: sellOrderPrice, instantSellPrice: buyOrderPrice,
    marginCoins: 0, marginPercent: 0, coinsPerHour: 0, coinsPerHourEstimated: true,
    buyVolume: totalVolume / 2, sellVolume: totalVolume / 2, totalVolume, buyMovingWeek: 0, sellMovingWeek: 0,
    weeklyVolume: 0, buyOrders: 0, sellOrders: 0, midpoint: (buyOrderPrice + sellOrderPrice) / 2,
    depthWithinFivePercent: {
      buyOrders: { quantity: 0, notional: 0, levels: 0 },
      sellOffers: { quantity: 0, notional: 0, levels: 0 }, partial: false,
    },
    icon: { kind: "placeholder", key: productId },
  };
}

describe("Shard fusion calculations", () => {
  it("uses fuse amounts, tax and the selected order strategy", () => {
    const flips = calculateShardFlips(data, [
      market("SHARD_ALPHA", 10, 11), market("SHARD_BETA", 10, 12), market("SHARD_GAMMA", 90, 100),
    ], "bo-so", 0);
    expect(flips).toHaveLength(1);
    expect(flips[0]?.inputCost).toBe(50);
    expect(flips[0]?.revenueAfterTax).toBeCloseTo(197.75);
    expect(flips[0]?.profit).toBeCloseTo(147.75);
  });

  it("applies Crocodile expected value only when a Reptile input is present", () => {
    const [flip] = calculateShardFlips(data, [
      market("SHARD_ALPHA", 10, 11), market("SHARD_BETA", 10, 12), market("SHARD_GAMMA", 90, 100),
    ], "bo-so", 5);
    expect(flip?.crocodileApplied).toBe(true);
    expect(flip?.expectedOutput).toBeCloseTo(2.2);
    expect(flip?.profit).toBeCloseTo(167.525);
    expect(flip?.materials.map((material) => material.quantityPerFusion)).toEqual([2, 3]);
    expect(flip?.materials.every((material) => Number.isInteger(material.quantityPerFusion))).toBe(true);
    const scaled = scaleShardRouteForOutput(flip!.route, 7);
    expect(scaled.fusionCount).toBe(4);
    expect(scaled.expectedOutput).toBeCloseTo(8.8);
    expect(collectShardRouteMaterials(scaled.route).map((material) => material.quantity)).toEqual([8, 12]);
  });

  it("adjusts Crocodile output and profit with math without changing materials", () => {
    const [baseFlip] = calculateShardFlips(data, [
      market("SHARD_ALPHA", 10, 11), market("SHARD_BETA", 10, 12), market("SHARD_GAMMA", 90, 100),
    ], "bo-so", 0);
    const adjusted = applyCrocodileLevelToFlip(baseFlip!, 5);

    expect(adjusted.expectedOutput).toBeCloseTo(2.2);
    expect(adjusted.revenueAfterTax).toBeCloseTo(baseFlip!.revenueAfterTax * 1.1);
    expect(adjusted.profit).toBeCloseTo(adjusted.revenueAfterTax - baseFlip!.inputCost);
    expect(adjusted.route.kind === "fusion" ? adjusted.route.expectedOutput : 0).toBeCloseTo(2.2);
    expect(adjusted.materials).toEqual(baseFlip!.materials);
    expect(collectShardRouteMaterials(adjusted.route)).toEqual(collectShardRouteMaterials(baseFlip!.route));
    const baseShoppingPlan = scaleShardRouteForOutput(baseFlip!.route, 11);
    const adjustedShoppingPlan = scaleShardRouteForOutput(adjusted.route, 11);
    expect(baseShoppingPlan.fusionCount).toBe(6);
    expect(adjustedShoppingPlan.fusionCount).toBe(5);
    expect(collectShardRouteMaterials(adjustedShoppingPlan.route).map((material) => material.quantity)).toEqual([10, 15]);
    expect(adjustedShoppingPlan.expectedOutput).toBeCloseTo(11);
  });

  it("walks visible order levels to report maximum profitable final output", () => {
    const [flip] = calculateShardFlips(data, [
      market("SHARD_ALPHA", 10, 11), market("SHARD_BETA", 10, 12), market("SHARD_GAMMA", 90, 100),
    ], "ib-is", 0, undefined, {
      orderBooks: {
        SHARD_ALPHA: { buyOrders: [{ amount: 20, orders: 1, pricePerUnit: 10 }], sellOffers: [{ amount: 20, orders: 1, pricePerUnit: 11 }], partial: false },
        SHARD_BETA: { buyOrders: [{ amount: 30, orders: 1, pricePerUnit: 10 }], sellOffers: [{ amount: 30, orders: 1, pricePerUnit: 12 }], partial: false },
        SHARD_GAMMA: { buyOrders: [{ amount: 10, orders: 1, pricePerUnit: 90 }], sellOffers: [{ amount: 10, orders: 1, pricePerUnit: 100 }], partial: false },
      },
    });
    expect(flip?.depth.maxProfitableFusions).toBe(5);
    expect(flip?.depth.maxProfitableOutput).toBe(10);
    expect(flip?.depth.limitedBy).toContain("Gamma");
    expect(flip?.depth.materialsRequired.map((material) => material.quantity)).toEqual([10, 15]);
    expect(flip?.depth.minProfit).toEqual({ mode: "percent", value: 0.1 });
  });

  it("walks multiple input and output levels for the displayed single-Flip cost and profit", () => {
    const [flip] = calculateShardFlips(data, [
      market("SHARD_ALPHA", 10, 11), market("SHARD_BETA", 10, 12), market("SHARD_GAMMA", 90, 100),
    ], "ib-is", 0, undefined, {
      orderBooks: {
        SHARD_ALPHA: { buyOrders: [], sellOffers: [
          { amount: 1, orders: 1, pricePerUnit: 11 },
          { amount: 10, orders: 1, pricePerUnit: 20 },
        ], partial: false },
        SHARD_BETA: { buyOrders: [], sellOffers: [
          { amount: 1, orders: 1, pricePerUnit: 12 },
          { amount: 10, orders: 1, pricePerUnit: 22 },
        ], partial: false },
        SHARD_GAMMA: { buyOrders: [
          { amount: 1, orders: 1, pricePerUnit: 90 },
          { amount: 10, orders: 1, pricePerUnit: 80 },
        ], sellOffers: [], partial: false },
      },
    });

    expect(flip?.inputCost).toBe(87);
    expect(flip?.revenueAfterTax).toBeCloseTo(168.0875);
    expect(flip?.profit).toBeCloseTo(81.0875);
    expect(flip?.materials.map((material) => material.unitCost)).toEqual([15.5, 56 / 3]);
  });

  it("limits depth by Min Flip Profit as a percent of max or a fixed coin floor", () => {
    const orderBooks = {
      SHARD_ALPHA: { buyOrders: [], sellOffers: [{ amount: 20, orders: 1, pricePerUnit: 10 }], partial: false },
      SHARD_BETA: { buyOrders: [], sellOffers: [{ amount: 30, orders: 1, pricePerUnit: 10 }], partial: false },
      SHARD_GAMMA: { buyOrders: [
        { amount: 4, orders: 1, pricePerUnit: 100 },
        { amount: 6, orders: 1, pricePerUnit: 40 },
      ], sellOffers: [], partial: false },
    };
    const marketItems = [
      market("SHARD_ALPHA", 10, 10), market("SHARD_BETA", 10, 10), market("SHARD_GAMMA", 90, 100),
    ];
    const [percentFlip] = calculateShardFlips(data, marketItems, "ib-is", 0, undefined, {
      minFlipProfit: { mode: "percent", value: 50 },
      orderBooks,
    });
    const [coinFlip] = calculateShardFlips(data, marketItems, "ib-is", 0, undefined, {
      minFlipProfit: { mode: "coins", value: 30 },
      orderBooks,
    });

    expect(percentFlip?.depth.maxFlipProfit).toBeCloseTo(147.75);
    expect(percentFlip?.depth.maxProfitableFusions).toBe(2);
    expect(percentFlip?.depth.limitedBy).toBe("Min Flip Profit 50%");
    expect(coinFlip?.depth.maxProfitableFusions).toBe(2);
    expect(coinFlip?.depth.limitedBy).toBe("Min Flip Profit 30 coins");
  });

  it("includes Crocodile EV in the fully recalculated market depth", () => {
    const [flip] = calculateShardFlips(data, [
      market("SHARD_ALPHA", 10, 11), market("SHARD_BETA", 10, 12), market("SHARD_GAMMA", 90, 100),
    ], "ib-is", 5, undefined, {
      orderBooks: {
        SHARD_ALPHA: { buyOrders: [], sellOffers: [{ amount: 20, orders: 1, pricePerUnit: 11 }], partial: false },
        SHARD_BETA: { buyOrders: [], sellOffers: [{ amount: 30, orders: 1, pricePerUnit: 12 }], partial: false },
        SHARD_GAMMA: { buyOrders: [{ amount: 11, orders: 1, pricePerUnit: 90 }], sellOffers: [], partial: false },
      },
    });

    expect(flip?.expectedOutput).toBeCloseTo(2.2);
    expect(flip?.depth.maxProfitableFusions).toBe(5);
    expect(flip?.depth.maxProfitableOutput).toBeCloseTo(11);
    expect(flip?.depth.materialsRequired.map((material) => material.quantity)).toEqual([10, 15]);
  });

  it("excludes depth whose total profit is below the configured material-cost floor", () => {
    const [flip] = calculateShardFlips(data, [
      market("SHARD_ALPHA", 10, 11), market("SHARD_BETA", 10, 12), market("SHARD_GAMMA", 40, 50),
    ], "ib-is", 0, undefined, {
      minProfitPercent: 50,
      orderBooks: {
        SHARD_ALPHA: { buyOrders: [], sellOffers: [{ amount: 20, orders: 1, pricePerUnit: 11 }], partial: false },
        SHARD_BETA: { buyOrders: [], sellOffers: [{ amount: 30, orders: 1, pricePerUnit: 12 }], partial: false },
        SHARD_GAMMA: { buyOrders: [{ amount: 10, orders: 1, pricePerUnit: 40 }], sellOffers: [], partial: false },
      },
    });
    expect(flip?.profit).toBeGreaterThan(0);
    expect(flip?.depth.maxProfitableFusions).toBe(0);
    expect(flip?.depth.limitedBy).toBe("Min Profit 50%");
  });

  it("accepts a fixed coin Min Profit and finds the last qualifying depth", () => {
    const [flip] = calculateShardFlips(data, [
      market("SHARD_ALPHA", 10, 11), market("SHARD_BETA", 10, 12), market("SHARD_GAMMA", 40, 50),
    ], "ib-is", 0, undefined, {
      minProfit: { mode: "coins", value: 50 },
      orderBooks: {
        SHARD_ALPHA: { buyOrders: [], sellOffers: [{ amount: 20, orders: 1, pricePerUnit: 11 }], partial: false },
        SHARD_BETA: { buyOrders: [], sellOffers: [{ amount: 30, orders: 1, pricePerUnit: 12 }], partial: false },
        SHARD_GAMMA: { buyOrders: [
          { amount: 6, orders: 1, pricePerUnit: 40 },
          { amount: 4, orders: 1, pricePerUnit: 20 },
        ], sellOffers: [], partial: false },
      },
    });

    expect(flip?.depth.minProfit).toEqual({ mode: "coins", value: 50 });
    expect(flip?.depth.maxProfitableFusions).toBe(3);
    expect(flip?.depth.totalProfit).toBeGreaterThanOrEqual(50);
    expect(flip?.depth.limitedBy).toBe("Min Profit 50 coins");
  });

  it("uses an alternate fusion route when a direct material market fails filters", () => {
    const alternativeData: FusionData = {
      ...data,
      recipes: { B: { "2": [["A", "A"]] }, C: { "2": [["A", "B"]] } },
    };
    const flips = calculateShardFlips(alternativeData, [
      market("SHARD_ALPHA", 10, 11, 100), market("SHARD_BETA", 10, 12, 0), market("SHARD_GAMMA", 90, 100, 100),
    ], "bo-so", 0, undefined, { marketFilters: { totalVolume: { min: 50 } } });
    const gamma = flips.find((flip) => flip.shardId === "C");
    expect(gamma?.materials).toHaveLength(1);
    expect(gamma?.materials[0]?.name).toBe("Alpha");
    // Producing 3 Beta requires two whole 2-output Fusion operations. Raw
    // purchases remain integers instead of using a fractional 1.5 operation.
    expect(gamma?.materials[0]?.quantityPerFusion).toBe(10);
    expect(Number.isInteger(gamma?.materials[0]?.quantityPerFusion)).toBe(true);
  });
});
