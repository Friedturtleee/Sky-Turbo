import { describe, expect, it } from "vitest";
import { calculateAhFlip } from "./ah-flips";
import type { AhValuationInput } from "./types";

const base: AhValuationInput = {
  auctionId: "abc123",
  productId: "HYPERION",
  name: "Heroic Hyperion",
  category: "weapon",
  tier: "LEGENDARY",
  quantity: 1,
  listingPrice: 900_000_000,
  start: 1_000,
  end: 10_000,
  componentEstimate: 1_100_000_000,
  features: [],
  unknownAttributeKeys: [],
  history: {
    productId: "HYPERION",
    fetchedAt: 1,
    days: 7,
    totalSales: 100,
    salesPerDay: 14,
    averagePrice: 1_100_000_000,
    medianPrice: 1_100_000_000,
    minimumPrice: 900_000_000,
    maximumPrice: 1_300_000_000,
    averageSellTimeSeconds: 1_000,
    medianSellTimeSeconds: 500,
    binPercentage: 99,
    priceStdDev: 100_000_000,
    priceCoefficientVariation: 0.09,
  },
};

describe("calculateAhFlip", () => {
  it("uses an exact SkyCofl NBT median and applies the full 100m+ AH fee", () => {
    const flip = calculateAhFlip({
      ...base,
      nbtEstimate: { lbin: 900_000_000, median: 1_200_000_000, fastSell: 1_050_000_000, volume: 12 },
    });
    expect(flip?.feeRate).toBe(0.05);
    expect(flip?.resaleAfterTax).toBe(1_140_000_000);
    expect(flip?.profit).toBe(240_000_000);
    expect(flip?.valuationSource).toBe("skycofl-nbt");
    expect(flip?.riskLevel).toBe("low");
  });

  it("keeps component fallback estimates and marks them high risk", () => {
    const flip = calculateAhFlip({ ...base, history: undefined });
    expect(flip?.valuationSource).toBe("component-estimate");
    expect(flip?.riskLevel).toBe("high");
    expect(flip?.riskReasons.join(" ")).toContain("Component Estimate");
  });

  it("marks thin and volatile exact comparisons as high risk", () => {
    const flip = calculateAhFlip({
      ...base,
      unknownAttributeKeys: ["new_upgrade"],
      history: { ...base.history!, totalSales: 1, priceCoefficientVariation: 1.2 },
      nbtEstimate: { lbin: 1, median: 1_200_000_000, fastSell: 1_000_000_000, volume: 0.2 },
    });
    expect(flip?.riskLevel).toBe("high");
    expect(flip?.riskReasons.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects malformed auctions", () => {
    expect(calculateAhFlip({ ...base, listingPrice: 0 })).toBeNull();
    expect(calculateAhFlip({ ...base, end: base.start })).toBeNull();
  });
});
