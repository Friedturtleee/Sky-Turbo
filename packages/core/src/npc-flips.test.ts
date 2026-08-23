import { describe, expect, it } from "vitest";
import { calculateNpcFlips, calculateNpcProfitPlan, npcBazaarQuotesFromResponse } from "./npc-flips";
import type { HypixelBazaarResponse, MarketSnapshot, NpcShopOffer } from "./types";

const market = {
  source: "hypixel",
  success: true,
  updatedAt: 1,
  taxRate: 0.01125,
  items: [
    { productId: "COUPON", buyOrderPrice: 90, instantBuyPrice: 100, instantSellPrice: 90, sellOrderPrice: 100, buyMovingWeek: 1_680, sellMovingWeek: 840 },
    { productId: "OUTPUT", buyOrderPrice: 1_000, instantBuyPrice: 1_100, instantSellPrice: 1_000, sellOrderPrice: 1_100, buyMovingWeek: 1_680, sellMovingWeek: 840 },
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
  it("defaults to buy-order costs and sell-order revenue", () => {
    const result = calculateNpcFlips([offer], market, {});
    expect(result.unpricedCount).toBe(0);
    expect(result.flips[0]).toMatchObject({
      totalCost: 280,
      strategy: "bo-so",
      saleSource: "bazaar",
      salePriceGross: 1_100,
      salePriceNet: 1_087.625,
      profit: 807.625,
      bazaarInstaSellPriceGross: 1_000,
      bazaarInstaSellPriceNet: 988.75,
      bazaarInstaSellProfit: 708.75,
      bazaarSellOrderPriceGross: 1_100,
      bazaarSellOrderPriceNet: 1_087.625,
      bazaarSellOrderProfit: 807.625,
      bazaarMatchedVolume7d: 840,
      maxPurchases: 640,
      maxProfitStrategy: "sell-order",
      maxProfitPerPurchase: 807.625,
      maxDailyProfit: 516_880,
    });
  });

  it.each([
    ["bo-so", 280, 1_100, 807.625, "sell-order"],
    ["ib-so", 300, 1_100, 787.625, "sell-order"],
    ["bo-is", 280, 1_000, 708.75, "insta-sell"],
    ["ib-is", 300, 1_000, 688.75, "insta-sell"],
  ] as const)("calculates the %s NPC strategy independently", (strategy, totalCost, salePriceGross, profit, outputMethod) => {
    expect(calculateNpcFlips([offer], market, {}, {}, strategy).flips[0]).toMatchObject({
      strategy,
      totalCost,
      salePriceGross,
      profit,
      maxProfitPerPurchase: profit,
      maxProfitStrategy: outputMethod,
    });
  });

  it("plans all or 80% of the maximum profit and expands every required cost", () => {
    const flip = calculateNpcFlips([offer], market, {}).flips[0]!;
    expect(calculateNpcProfitPlan(flip)).toMatchObject({
      purchaseCount: 640,
      outputQuantity: 640,
      totalCost: 179_200,
      totalProfit: 516_880,
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
    const flip = calculateNpcFlips([ahOffer], market, { AH_ITEM: { lowestBin: 2_000 } }).flips[0]!;
    expect(flip).toMatchObject({
      saleSource: "ah-lowest-bin",
      salePriceGross: 2_000,
      salePriceNet: 1_960,
    });
    expect(calculateNpcProfitPlan(flip)).toMatchObject({
      purchaseCount: 1,
      outputQuantity: 1,
      stockPurchaseLimit: 640,
      executionPurchaseLimit: 1,
      limitedBy: "AH 預設只估算 1 次購買",
    });
    expect(calculateNpcFlips([ahOffer], market, {}).unpricedCount).toBe(1);
  });

  it("walks Instant depth and stops at the highest cumulative profit", () => {
    const quotes = {
      COUPON: {
        productId: "COUPON",
        instantBuyPrice: 100,
        buyOrderPrice: 90,
        instantSellPrice: 90,
        sellOrderPrice: 100,
        instantBuyDepth: [
          { amount: 4, orders: 1, pricePerUnit: 100 },
          { amount: 4, orders: 1, pricePerUnit: 300 },
        ],
        instantSellDepth: [],
        buyMovingWeek: 1_680,
        sellMovingWeek: 840,
      },
      OUTPUT: {
        productId: "OUTPUT",
        instantBuyPrice: 1_100,
        buyOrderPrice: 1_000,
        instantSellPrice: 1_000,
        sellOrderPrice: 1_100,
        instantBuyDepth: [],
        instantSellDepth: [
          { amount: 2, orders: 1, pricePerUnit: 1_000 },
          { amount: 2, orders: 1, pricePerUnit: 400 },
        ],
        buyMovingWeek: 1_680,
        sellMovingWeek: 840,
      },
    };
    const noTaxMarket = { ...market, taxRate: 0 };
    const flip = calculateNpcFlips([offer], noTaxMarket, {}, quotes, "ib-is").flips[0]!;
    expect(calculateNpcProfitPlan(flip)).toMatchObject({
      purchaseCount: 2,
      outputQuantity: 2,
      executionPurchaseLimit: 4,
      maxProfitPurchaseCount: 2,
      depthLimited: true,
      totalCost: 600,
      revenueAfterTax: 2_000,
      totalProfit: 1_400,
    });
  });

  it("caps maker strategies by the selected Bazaar-side depth", () => {
    const quotes = {
      COUPON: {
        productId: "COUPON",
        instantBuyPrice: 100,
        buyOrderPrice: 90,
        instantSellPrice: 90,
        sellOrderPrice: 100,
        instantBuyDepth: [{ amount: 100, orders: 1, pricePerUnit: 100 }],
        instantSellDepth: [{ amount: 4, orders: 1, pricePerUnit: 90 }],
        buyMovingWeek: 1_680,
        sellMovingWeek: 840,
      },
      OUTPUT: {
        productId: "OUTPUT",
        instantBuyPrice: 1_100,
        buyOrderPrice: 1_000,
        instantSellPrice: 1_000,
        sellOrderPrice: 1_100,
        instantBuyDepth: [{ amount: 10, orders: 1, pricePerUnit: 1_100 }],
        instantSellDepth: [{ amount: 100, orders: 1, pricePerUnit: 1_000 }],
        buyMovingWeek: 1_680,
        sellMovingWeek: 840,
      },
    };
    const flip = calculateNpcFlips([offer], { ...market, taxRate: 0 }, {}, quotes, "bo-so").flips[0]!;
    expect(calculateNpcProfitPlan(flip)).toMatchObject({
      purchaseCount: 2,
      executionPurchaseLimit: 2,
      depthLimited: true,
      limitedBy: "Coupon Buy Orders 可見深度",
      totalCost: 560,
      revenueAfterTax: 2_200,
      totalProfit: 1_640,
    });
  });

  it("maps Hypixel maker-side summaries to the correct taker depth", () => {
    const response = {
      success: true,
      lastUpdated: 1,
      products: {
        OUTPUT: {
          product_id: "OUTPUT",
          buy_summary: [{ amount: 3, orders: 1, pricePerUnit: 1_100 }],
          sell_summary: [{ amount: 4, orders: 1, pricePerUnit: 1_000 }],
          quick_status: {
            productId: "OUTPUT", buyPrice: 0, buyVolume: 0, buyMovingWeek: 10, buyOrders: 0,
            sellPrice: 0, sellVolume: 0, sellMovingWeek: 8, sellOrders: 0,
          },
        },
      },
    } satisfies HypixelBazaarResponse;
    expect(npcBazaarQuotesFromResponse(response).OUTPUT).toMatchObject({
      instantBuyDepth: [{ amount: 3, pricePerUnit: 1_100 }],
      instantSellDepth: [{ amount: 4, pricePerUnit: 1_000 }],
    });
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
