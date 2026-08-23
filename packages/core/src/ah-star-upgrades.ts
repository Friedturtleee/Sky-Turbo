import type { AhItemFeature } from "./types";

export type AhStarUpgradeCost = {
  productId: string;
  name: string;
  amount: number;
  kind: "essence" | "item";
};

export type AhStarUpgradeLevel = {
  level: number;
  coinCost: number;
  costs: AhStarUpgradeCost[];
};

export type AhStarUpgradeItem = {
  name: string;
  dungeonItem: boolean;
  levels: AhStarUpgradeLevel[];
};

export type AhStarUpgradeData = Record<string, AhStarUpgradeItem>;

// Star materials are sunk costs and generally retain much less than their
// replacement cost. Exact SkyCofl NBT comparables still take priority later.
export const STAR_UPGRADE_COMPONENT_RETENTION = 0.35;

const MASTER_STARS = [
  "FIRST_MASTER_STAR",
  "SECOND_MASTER_STAR",
  "THIRD_MASTER_STAR",
  "FOURTH_MASTER_STAR",
  "FIFTH_MASTER_STAR",
] as const;

function finitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function commaNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function pricedUpgradeFeature(
  feature: Omit<AhItemFeature, "replacementCost" | "estimatedContribution">,
  replacementCost: number | undefined,
): AhItemFeature {
  if (!finitePositive(replacementCost)) return feature;
  return {
    ...feature,
    replacementCost,
    estimatedContribution: replacementCost * STAR_UPGRADE_COMPONENT_RETENTION,
  };
}

/**
 * Expands an item's NBT upgrade_level into cumulative, item-specific costs.
 * Items with 10/15 normal Essence stars must never be interpreted as carrying
 * Master Stars merely because their upgrade_level is greater than five.
 */
export function starUpgradeFeatures(
  productId: string,
  upgradeLevel: number,
  nbtDungeonItem: boolean,
  priceMap: ReadonlyMap<string, number>,
  upgradeData: AhStarUpgradeData,
): AhItemFeature[] {
  const level = Math.max(0, Math.floor(upgradeLevel));
  if (level < 1) return [];

  const result: AhItemFeature[] = [{
    key: "upgrade_level",
    label: "Item Stars",
    value: `${level} star`,
    category: "stars",
    recognized: true,
  }];
  const item = upgradeData[productId];
  const knownLevels = item?.levels.length ?? 0;

  if (item && knownLevels > 0) {
    const aggregate = new Map<string, { name: string; amount: number; kind: "essence" | "item" }>();
    let coinCost = 0;
    for (const step of item.levels.slice(0, Math.min(level, knownLevels))) {
      if (finitePositive(step.coinCost)) coinCost += step.coinCost;
      for (const cost of step.costs) {
        if (!finitePositive(cost.amount)) continue;
        const current = aggregate.get(cost.productId);
        aggregate.set(cost.productId, {
          name: cost.name,
          amount: (current?.amount ?? 0) + cost.amount,
          kind: cost.kind,
        });
      }
    }

    for (const [costProductId, cost] of aggregate) {
      const replacementCost = finitePositive(priceMap.get(costProductId))
        ? priceMap.get(costProductId)! * cost.amount
        : undefined;
      result.push(pricedUpgradeFeature({
        key: `star_cost:${costProductId}`,
        label: cost.name,
        value: `×${commaNumber(cost.amount)}`,
        category: "stars",
        recognized: true,
        marketProductId: costProductId,
      }, replacementCost));
    }

    if (coinCost > 0) result.push(pricedUpgradeFeature({
      key: "star_cost:coins",
      label: "Star Upgrade Coin Fees",
      value: `${commaNumber(coinCost)} coins`,
      category: "stars",
      recognized: true,
    }, coinCost));
  }

  // A five-level upgrade table followed by upgrade levels 6-10 represents
  // Dungeon Master Stars. Ten/fifteen-level Essence tables (Moogma, Kuudra,
  // fishing gear, etc.) are normal stars and intentionally never enter here.
  const supportsMasterStars = knownLevels <= 5 && (item?.dungeonItem === true || nbtDungeonItem);
  if (supportsMasterStars && level > 5) {
    for (let index = 0; index < Math.min(MASTER_STARS.length, level - 5); index += 1) {
      const masterStar = MASTER_STARS[index]!;
      result.push(pricedUpgradeFeature({
        key: `master_star:${index + 1}`,
        label: `${index + 1} Master Star`,
        value: masterStar,
        category: "stars",
        recognized: true,
        marketProductId: masterStar,
      }, priceMap.get(masterStar)));
    }
  }

  return result;
}
