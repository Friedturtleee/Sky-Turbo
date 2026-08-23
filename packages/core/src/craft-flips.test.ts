import { describe, expect, it } from "vitest";
import {
  calculateCraftFlips,
  calculateCraftProfitPlan,
  formatCraftRequirementLevel,
  groupCraftRequirements,
  listCraftRequirements,
  meetsCraftRequirement,
  normalizeCraftRequirement,
  parseCraftRequirement,
} from "./craft-flips";
import type { CraftData, CraftStrategy, MarketItem, ShardOrderBook } from "./types";

const data: CraftData = {
  schemaVersion: 1,
  generatedAt: "2026-01-01T00:00:00.000Z",
  source: { project: "test", commit: "abc", branch: "main", archiveUrl: "https://example.com", license: "MIT" },
  warnings: [],
  recipes: [{
    id: "OUTPUT:test",
    type: "crafting",
    output: { productId: "OUTPUT", name: "Output", amount: 2 },
    ingredients: [
      { productId: "A", name: "A", amount: 2 },
      { productId: "B", name: "B", amount: 1 },
    ],
    source: { label: "test", url: "https://example.com", file: "OUTPUT.json" },
  }],
};

const market = [
  { productId: "A", buyMovingWeek: 1_000, sellMovingWeek: 900 },
  { productId: "B", buyMovingWeek: 1_000, sellMovingWeek: 900 },
  { productId: "OUTPUT", buyMovingWeek: 500, sellMovingWeek: 450 },
] as MarketItem[];

const books: Record<string, ShardOrderBook> = {
  A: {
    buyOrders: [{ amount: 100, orders: 1, pricePerUnit: 5 }],
    sellOffers: [{ amount: 1, orders: 1, pricePerUnit: 7 }, { amount: 100, orders: 1, pricePerUnit: 9 }],
    partial: false,
  },
  B: {
    buyOrders: [{ amount: 100, orders: 1, pricePerUnit: 10 }],
    sellOffers: [{ amount: 100, orders: 1, pricePerUnit: 12 }],
    partial: false,
  },
  OUTPUT: {
    buyOrders: [{ amount: 1, orders: 1, pricePerUnit: 30 }, { amount: 100, orders: 1, pricePerUnit: 25 }],
    sellOffers: [{ amount: 100, orders: 1, pricePerUnit: 40 }],
    partial: false,
  },
};

describe("calculateCraftFlips", () => {
  it.each([
    ["bo-so", 20, 80, 52],
    ["ib-so", 28, 80, 44],
    ["bo-is", 20, 55, 29.5],
    ["ib-is", 28, 55, 21.5],
  ] satisfies Array<[CraftStrategy, number, number, number]>) (
    "calculates %s with the selected order-book sides",
    (strategy, inputCost, grossRevenue, profit) => {
      const result = calculateCraftFlips(data, market, books, strategy, 0.1);
      expect(result.skippedCount).toBe(0);
      expect(result.flips[0]).toMatchObject({
        strategy,
        outputAmount: 2,
        inputCost,
        grossRevenue,
        revenueAfterTax: grossRevenue * 0.9,
        profit,
        profitPerOutput: profit / 2,
        matchedVolume7d: 450,
      });
    },
  );

  it("skips a recipe when a material is not Bazaar-tradeable", () => {
    const result = calculateCraftFlips(data, market.filter((item) => item.productId !== "B"), books, "bo-so", 0.1);
    expect(result.flips).toEqual([]);
    expect(result.skippedCount).toBe(1);
  });

  it("skips an instant strategy when visible depth cannot fill one craft", () => {
    const shallow = {
      ...books,
      A: { ...books.A!, sellOffers: [{ amount: 1, orders: 1, pricePerUnit: 7 }] },
    };
    expect(calculateCraftFlips(data, market, shallow, "ib-so", 0.1)).toMatchObject({
      flips: [],
      skippedCount: 1,
    });
  });

  it.each([
    ["bo-so", 225, 11_700, 180],
    ["ib-so", 50, 2_102, 40],
    ["bo-is", 50, 1_254.5, 40],
    ["ib-is", 50, 756.5, 40],
  ] satisfies Array<[CraftStrategy, number, number, number]>) (
    "finds %s Max Profit across liquidity and visible order depth",
    (strategy, maxCrafts, maxProfit, eightyPercentCrafts) => {
      const flip = calculateCraftFlips(data, market, books, strategy, 0.1).flips[0]!;
      expect(flip.depth).toMatchObject({
        available: true,
        maxCrafts,
        maxOutput: maxCrafts * 2,
        maxProfit,
      });
      expect(calculateCraftProfitPlan(flip, 1)).toMatchObject({
        fraction: 1,
        craftCount: maxCrafts,
        outputQuantity: maxCrafts * 2,
        totalProfit: maxProfit,
      });
      expect(calculateCraftProfitPlan(flip, 0.8)?.craftCount).toBe(eightyPercentCrafts);
      expect(calculateCraftProfitPlan(flip, 0.8)?.totalProfit).toBeGreaterThanOrEqual(maxProfit * 0.8);
    },
  );

  it("expands every ingredient for the full and 80% cost plans", () => {
    const flip = calculateCraftFlips(data, market, books, "bo-so", 0.1).flips[0]!;
    expect(calculateCraftProfitPlan(flip, 1)?.ingredients).toEqual([
      { productId: "A", name: "A", amount: 450, unitCost: 5, totalCost: 2_250 },
      { productId: "B", name: "B", amount: 225, unitCost: 10, totalCost: 2_250 },
    ]);
    expect(calculateCraftProfitPlan(flip, 0.8)?.ingredients).toEqual([
      { productId: "A", name: "A", amount: 360, unitCost: 5, totalCost: 1_800 },
      { productId: "B", name: "B", amount: 180, unitCost: 10, totalCost: 1_800 },
    ]);
  });
});

describe("Craft requirements", () => {
  it("normalizes both NEU requirement formats", () => {
    expect(normalizeCraftRequirement("Requires Chili Pepper IV")).toBe("Requires: Chili Pepper IV");
    expect(normalizeCraftRequirement("  Requires:   Chili Pepper IV ")).toBe("Requires: Chili Pepper IV");
    expect(normalizeCraftRequirement(undefined)).toBeUndefined();
  });

  it("returns a stable, unique requirement list for filters", () => {
    const requirements = listCraftRequirements({
      ...data,
      recipes: [
        { ...data.recipes[0]!, requirement: "Requires Chili Pepper IV" },
        { ...data.recipes[0]!, id: "OUTPUT:second", requirement: "Requires: Chili Pepper IV" },
        { ...data.recipes[0]!, id: "OUTPUT:third", requirement: "Requires: Chili Pepper I" },
      ],
    });
    expect(requirements).toEqual(["Requires: Chili Pepper I", "Requires: Chili Pepper IV"]);
  });

  it("groups requirements into numeric progress scales", () => {
    expect(parseCraftRequirement("Requires Chili Pepper IV")).toMatchObject({
      key: "Chili Pepper", level: 4, format: "roman",
    });
    expect(parseCraftRequirement("Requires: Spider Slayer 7")).toMatchObject({
      key: "Spider Slayer", level: 7, format: "number",
    });
    expect(parseCraftRequirement("Requires: 20 Museum Donations")).toMatchObject({
      key: "Museum Donations", level: 20, format: "number",
    });
    expect(groupCraftRequirements([
      "Requires: Chili Pepper I", "Requires: Chili Pepper IV", "Requires: Spider Slayer 7",
    ])).toEqual([
      { key: "Chili Pepper", label: "Chili Pepper", maxLevel: 4, format: "roman" },
      { key: "Spider Slayer", label: "Spider Slayer", maxLevel: 7, format: "number" },
    ]);
    expect(formatCraftRequirementLevel(4, "roman")).toBe("IV");
    expect(meetsCraftRequirement("Requires: Chili Pepper IV", { "Chili Pepper": 3 })).toBe(false);
    expect(meetsCraftRequirement("Requires: Chili Pepper IV", { "Chili Pepper": 4 })).toBe(true);
    expect(meetsCraftRequirement("Requires: Chili Pepper IV", {})).toBe(true);
  });
});
