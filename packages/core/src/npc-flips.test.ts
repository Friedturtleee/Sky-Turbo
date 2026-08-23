import { describe, expect, it } from "vitest";
import { calculateNpcFlips } from "./npc-flips";
import type { MarketSnapshot, NpcShopOffer } from "./types";

const market = {
  source: "hypixel",
  success: true,
  updatedAt: 1,
  taxRate: 0.01125,
  items: [
    { productId: "COUPON", instantBuyPrice: 100, instantSellPrice: 90 },
    { productId: "OUTPUT", instantBuyPrice: 1_100, instantSellPrice: 1_000 },
  ],
} as MarketSnapshot;

const offer: NpcShopOffer = {
  id: "npc:output",
  npc: "NPC",
  output: { productId: "OUTPUT", name: "Output", amount: 1 },
  costs: [
    { kind: "coins", amount: 100 },
    { kind: "item", productId: "COUPON", name: "Coupon", amount: 2 },
  ],
  dailyLimit: 640,
  source: { label: "test", url: "https://example.com" },
};

describe("calculateNpcFlips", () => {
  it("includes item currencies at their instant-buy cost", () => {
    const result = calculateNpcFlips([offer], market, {});
    expect(result.unpricedCount).toBe(0);
    expect(result.flips[0]).toMatchObject({
      totalCost: 300,
      saleSource: "bazaar",
      salePriceGross: 1_000,
      salePriceNet: 988.75,
      profit: 688.75,
      maxPurchases: 640,
    });
  });

  it("uses lowest BIN for AH outputs and excludes unknown prices", () => {
    const ahOffer = { ...offer, output: { productId: "AH_ITEM", name: "AH Item", amount: 1 } };
    expect(calculateNpcFlips([ahOffer], market, { AH_ITEM: { lowestBin: 2_000 } }).flips[0]).toMatchObject({
      saleSource: "ah-lowest-bin",
      salePriceGross: 2_000,
      salePriceNet: 1_960,
    });
    expect(calculateNpcFlips([ahOffer], market, {}).unpricedCount).toBe(1);
  });

  it("caps manipulated AH listings at the recent sold median", () => {
    const ahOffer = { ...offer, output: { productId: "AH_ITEM", name: "AH Item", amount: 1 } };
    expect(calculateNpcFlips([ahOffer], market, {
      AH_ITEM: { lowestBin: 50_000_000, recentMedian: 299_000, recentVolume: 15 },
    }).flips[0]).toMatchObject({
      salePriceGross: 299_000,
      auctionLowestBin: 50_000_000,
      auctionRecentMedian: 299_000,
      auctionRecentVolume: 15,
      auctionPriceCapped: true,
    });
  });
});
