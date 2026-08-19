import { describe, expect, it } from "vitest";
import { calculateMarketItem, percentageChange } from "./bazaar";
import type { HypixelBazaarProduct } from "./types";

const product: HypixelBazaarProduct = {
  product_id: "TEST_ITEM",
  buy_summary: [{ amount: 10, orders: 2, pricePerUnit: 110 }],
  sell_summary: [{ amount: 12, orders: 3, pricePerUnit: 100 }],
  quick_status: {
    productId: "TEST_ITEM",
    buyPrice: 110,
    buyVolume: 100,
    buyMovingWeek: 1_680,
    buyOrders: 4,
    sellPrice: 100,
    sellVolume: 200,
    sellMovingWeek: 840,
    sellOrders: 5,
  },
};

describe("Bazaar calculations", () => {
  it("maps Hypixel order sides and deducts the 1.125% sell tax", () => {
    const item = calculateMarketItem(product, 123)!;
    expect(item.buyOrderPrice).toBe(100);
    expect(item.sellOrderPrice).toBe(110);
    expect(item.marginCoins).toBeCloseTo(8.7625);
    expect(item.coinsPerHour).toBeCloseTo(43.8125);
  });

  it("calculates percentage changes", () => {
    expect(percentageChange(110, 100)).toBe(10);
    expect(percentageChange(10, 0)).toBeUndefined();
  });
});

