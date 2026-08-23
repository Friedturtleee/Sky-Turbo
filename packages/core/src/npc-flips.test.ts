import { describe, expect, it } from "vitest";
import { calculateNpcFlips, calculateNpcProfitPlan } from "./npc-flips";
import type { MarketSnapshot, NpcShopOffer } from "./types";

const market = {
  source: "hypixel",
  success: true,
  updatedAt: 1,
  taxRate: 0.01125,
  items: [
    { productId: "COUPON", instantBuyPrice: 100, instantSellPrice: 90, sellOrderPrice: 100, buyMovingWeek: 1_680, sellMovingWeek: 840 },
    { productId: "OUTPUT", instantBuyPrice: 1_100, instantSellPrice: 1_000, sellOrderPrice: 1_100, buyMovingWeek: 1_680, sellMovingWeek: 840 },
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
      bazaarSellOrderPriceGross: 1_100,
      bazaarSellOrderPriceNet: 1_087.625,
      bazaarSellOrderProfit: 787.625,
      bazaarMatchedVolume7d: 840,
      maxPurchases: 640,
      maxProfitStrategy: "sell-order",
      maxProfitPerPurchase: 787.625,
      maxDailyProfit: 504_080,
    });
  });

  it("plans all or 80% of the maximum profit and expands every required cost", () => {
    const flip = calculateNpcFlips([offer], market, {}).flips[0]!;
    expect(calculateNpcProfitPlan(flip)).toMatchObject({
      purchaseCount: 640,
      outputQuantity: 640,
      totalCost: 192_000,
      totalProfit: 504_080,
      profitStrategy: "sell-order",
      costs: [
        { name: "Coins", requiredAmount: 64_000 },
        { name: "Coupon", requiredAmount: 1_280 },
      ],
    });
    expect(calculateNpcProfitPlan(flip, { fraction: 0.8 })?.purchaseCount).toBe(512);
  });

  it("applies Diaz only to eligible shops and supports conditional stock bonuses", () => {
    const regular = calculateNpcFlips([offer], market, {}).flips[0]!;
    expect(calculateNpcProfitPlan(regular, { diazActive: true })?.purchaseCount).toBe(6_400);

    const kiaraOffer: NpcShopOffer = {
      ...offer,
      id: "KIARA:SHARD_VIPER",
      npc: "Kiara",
      dailyLimit: 10,
      diazEligible: false,
      conditionalDailyLimitBonus: 1,
      conditionalLimitRequirement: "Kiara Abiphone Contact",
    };
    const kiara = calculateNpcFlips([kiaraOffer], market, {}).flips[0]!;
    expect(calculateNpcProfitPlan(kiara, { diazActive: true })?.purchaseCount).toBe(10);
    expect(calculateNpcProfitPlan(kiara, {
      diazActive: true,
      conditionalBonusActive: true,
    })?.purchaseCount).toBe(11);
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

  it("keeps one-sided Bazaar products when a sell order can still be placed", () => {
    const oneSided = {
      ...offer,
      output: { productId: "ONE_SIDED", name: "One Sided", amount: 1 },
      costs: [{ kind: "coins" as const, amount: 100 }],
    };
    expect(calculateNpcFlips([oneSided], market, {}, {
      ONE_SIDED: {
        productId: "ONE_SIDED",
        instantBuyPrice: 500,
        sellOrderPrice: 500,
        buyMovingWeek: 100,
        sellMovingWeek: 0,
      },
    }).flips[0]).toMatchObject({
      saleSource: "bazaar",
      salePriceGross: 500,
      maxProfitStrategy: "sell-order",
      maxProfitPerPurchase: 394.375,
    });
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
