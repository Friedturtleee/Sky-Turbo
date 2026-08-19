import { describe, expect, it } from "vitest";
import { calculateRobustChartPriceRange } from "./chart-range";

describe("calculateRobustChartPriceRange", () => {
  it("adds breathing room around ordinary prices", () => {
    const range = calculateRobustChartPriceRange([90, 100, 110]);
    expect(range?.minValue).toBeLessThan(90);
    expect(range?.maxValue).toBeGreaterThan(110);
  });

  it("does not let a single move above 1,000% flatten the chart", () => {
    const range = calculateRobustChartPriceRange([100, 102, 98, 101, 5_000_000_000]);
    expect(range?.maxValue).toBeLessThan(1_000);
  });

  it("follows a sustained new price regime instead of an obsolete extreme", () => {
    const oldPrices = Array.from({ length: 90 }, () => 0.5);
    const currentPrices = Array.from({ length: 10 }, () => 5_000_000_000);
    const range = calculateRobustChartPriceRange([...oldPrices, ...currentPrices]);
    expect(range?.minValue).toBeGreaterThan(1_000_000_000);
    expect(range?.maxValue).toBeGreaterThan(5_000_000_000);
  });

  it("ignores invalid and non-positive values", () => {
    expect(calculateRobustChartPriceRange([Number.NaN, 0, -5, 25])).toEqual({
      minValue: 23.75,
      maxValue: 26.25,
    });
  });
});
