import assert from "node:assert/strict";
import test from "node:test";
import { isAuctionItemFlag, normalizeAhAnalysis } from "./coflnet-ah-history-lib";

test("recognizes SkyCofl auction flags including combined numeric flags", () => {
  assert.equal(isAuctionItemFlag("AUCTION"), true);
  assert.equal(isAuctionItemFlag(4), true);
  assert.equal(isAuctionItemFlag(20), true);
  assert.equal(isAuctionItemFlag("BAZAAR"), false);
  assert.equal(isAuctionItemFlag(17), false);
});

test("normalizes seven-day SkyCofl analysis", () => {
  const value = normalizeAhAnalysis("HYPERION", 123, {
    totalSales: 70,
    salesPerDay: 10,
    avgPrice: 110,
    medianPrice: 100,
    minPrice: 50,
    maxPrice: 200,
    avgSellTimeSeconds: 400,
    medianSellTimeSeconds: 300,
    binPercentage: 99,
    priceStdDev: 20,
    priceCoeffVariation: 0.2,
  });
  assert.equal(value?.days, 7);
  assert.equal(value?.totalSales, 70);
  assert.equal(value?.medianPrice, 100);
});

test("rejects missing or non-positive medians", () => {
  assert.equal(normalizeAhAnalysis("BAD", 1, {}), null);
  assert.equal(normalizeAhAnalysis("BAD", 1, { totalSales: 1, medianPrice: 0 }), null);
});
