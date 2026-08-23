import { describe, expect, it } from "vitest";
import upgradeDataJson from "../data/ah-upgrade-data.json";
import {
  STAR_UPGRADE_COMPONENT_RETENTION,
  starUpgradeFeatures,
  type AhStarUpgradeData,
} from "./ah-star-upgrades";

const upgrades = (upgradeDataJson as { starUpgrades: AhStarUpgradeData }).starUpgrades;

function feature(features: ReturnType<typeof starUpgradeFeatures>, key: string) {
  return features.find((candidate) => candidate.key === key);
}

describe("AH star upgrade valuation", () => {
  it("uses Moogma's ten cumulative Essence levels without inventing Master Stars", () => {
    const prices = new Map([
      ["ESSENCE_CRIMSON", 1_000],
      ["MOOGMA_PELT", 100],
      ["HEAVY_PEARL", 10_000],
      ["FIRST_MASTER_STAR", 100_000_000],
    ]);
    const features = starUpgradeFeatures("MOOGMA_LEGGINGS", 10, false, prices, upgrades);

    expect(feature(features, "star_cost:ESSENCE_CRIMSON")?.value).toBe("×1,550");
    expect(feature(features, "star_cost:MOOGMA_PELT")?.value).toBe("×550");
    expect(feature(features, "star_cost:HEAVY_PEARL")?.value).toBe("×12");
    expect(feature(features, "star_cost:coins")?.replacementCost).toBe(1_935_000);
    expect(features.some((candidate) => candidate.key.startsWith("master_star:"))).toBe(false);

    const expectedReplacementCost = 1_550_000 + 55_000 + 120_000 + 1_935_000;
    const contribution = features.reduce((sum, candidate) => sum + (candidate.estimatedContribution ?? 0), 0);
    expect(contribution).toBe(expectedReplacementCost * STAR_UPGRADE_COMPONENT_RETENTION);
  });

  it("still recognizes Master Stars on true five-star Dungeon items", () => {
    const prices = new Map([
      ["ESSENCE_WITHER", 2_000],
      ["FIRST_MASTER_STAR", 10_000_000],
      ["SECOND_MASTER_STAR", 20_000_000],
      ["THIRD_MASTER_STAR", 30_000_000],
      ["FOURTH_MASTER_STAR", 40_000_000],
      ["FIFTH_MASTER_STAR", 50_000_000],
    ]);
    const features = starUpgradeFeatures("HYPERION", 10, false, prices, upgrades);

    expect(feature(features, "star_cost:ESSENCE_WITHER")?.value).toBe("×3,350");
    expect(feature(features, "star_cost:coins")?.replacementCost).toBe(35_000);
    expect(features.filter((candidate) => candidate.key.startsWith("master_star:"))).toHaveLength(5);
  });

  it("requires Dungeon metadata before valuing levels 6-10 as Master Stars", () => {
    const prices = new Map([["FIRST_MASTER_STAR", 10_000_000]]);
    const plain = starUpgradeFeatures("ASPECT_OF_THE_DRAGON", 6, false, prices, upgrades);
    const dungeonized = starUpgradeFeatures("ASPECT_OF_THE_DRAGON", 6, true, prices, upgrades);

    expect(plain.some((candidate) => candidate.key === "master_star:1")).toBe(false);
    expect(dungeonized.some((candidate) => candidate.key === "master_star:1")).toBe(true);
  });

  it("keeps every generated upgrade table finite, sequential, and positive", () => {
    expect(Object.keys(upgrades).length).toBeGreaterThan(500);
    for (const item of Object.values(upgrades)) {
      expect(item.levels.length).toBeGreaterThan(0);
      item.levels.forEach((level, index) => {
        expect(level.level).toBe(index + 1);
        expect(Number.isFinite(level.coinCost)).toBe(true);
        expect(level.coinCost).toBeGreaterThanOrEqual(0);
        for (const cost of level.costs) {
          expect(cost.productId).not.toBe("");
          expect(Number.isFinite(cost.amount)).toBe(true);
          expect(cost.amount).toBeGreaterThan(0);
        }
      });
    }
  });
});
