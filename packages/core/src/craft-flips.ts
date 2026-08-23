import {
  type CraftData,
  type CraftFlip,
  type CraftFlipIngredient,
  type CraftProfitPlan,
  type CraftRecipe,
  type CraftRequirementProgress,
  type CraftRequirementScale,
  type CraftStrategy,
  type MarketItem,
  type OrderLevel,
  type ShardOrderBook,
} from "./types";

const inputUsesInstant = (strategy: CraftStrategy): boolean => strategy.startsWith("ib");
const outputUsesInstant = (strategy: CraftStrategy): boolean => strategy.endsWith("is");

export function normalizeCraftRequirement(requirement: string | undefined): string | undefined {
  const cleaned = requirement?.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  const match = /^Requires(?::)?\s+(.+)$/i.exec(cleaned);
  return match?.[1] ? `Requires: ${match[1]}` : cleaned;
}

export function listCraftRequirements(data: CraftData): string[] {
  return [...new Set(data.recipes
    .map((recipe) => normalizeCraftRequirement(recipe.requirement))
    .filter((requirement): requirement is string => Boolean(requirement)))]
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

function romanToNumber(value: string): number | undefined {
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1_000 };
  let total = 0;
  let previous = 0;
  for (const character of [...value.toUpperCase()].reverse()) {
    const current = values[character];
    if (!current) return undefined;
    total += current < previous ? -current : current;
    previous = current;
  }
  return total > 0 ? total : undefined;
}

export function formatCraftRequirementLevel(level: number, format: "roman" | "number"): string {
  const normalized = Math.max(0, Math.floor(level));
  if (format === "number" || normalized === 0) return String(normalized);
  const numerals: Array<[number, string]> = [
    [1_000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let remaining = normalized;
  let result = "";
  for (const [amount, numeral] of numerals) {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  }
  return result;
}

export function parseCraftRequirement(requirement: string | undefined): CraftRequirementProgress | undefined {
  const normalized = normalizeCraftRequirement(requirement);
  if (!normalized) return undefined;
  const body = normalized.replace(/^Requires:\s+/i, "");
  const prefixNumber = /^(\d+)\s+(.+)$/.exec(body);
  if (prefixNumber) {
    return {
      key: prefixNumber[2]!,
      label: prefixNumber[2]!,
      level: Number(prefixNumber[1]),
      format: "number",
    };
  }
  const suffix = /^(.+?)\s+([IVXLCDM]+|\d+)$/.exec(body);
  if (!suffix) return undefined;
  const numeric = /^\d+$/.test(suffix[2]!);
  const level = numeric ? Number(suffix[2]) : romanToNumber(suffix[2]!);
  if (!level || !Number.isSafeInteger(level)) return undefined;
  return {
    key: suffix[1]!,
    label: suffix[1]!,
    level,
    format: numeric ? "number" : "roman",
  };
}

export function groupCraftRequirements(requirements: readonly string[]): CraftRequirementScale[] {
  const groups = new Map<string, CraftRequirementScale>();
  for (const requirement of requirements) {
    const parsed = parseCraftRequirement(requirement);
    if (!parsed) continue;
    const current = groups.get(parsed.key);
    groups.set(parsed.key, {
      key: parsed.key,
      label: parsed.label,
      maxLevel: Math.max(current?.maxLevel ?? 0, parsed.level),
      format: current?.format === "number" || parsed.format === "number" ? "number" : "roman",
    });
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, "en", { numeric: true }));
}

export function meetsCraftRequirement(
  requirement: string | undefined,
  levels: Readonly<Record<string, number>>,
): boolean {
  const parsed = parseCraftRequirement(requirement);
  if (!parsed) return true;
  const selected = levels[parsed.key];
  return selected === undefined || selected >= parsed.level;
}

function levelAmount(levels: OrderLevel[]): number {
  return levels.reduce((sum, level) => sum + Math.max(0, level.amount), 0);
}

function priceLevels(
  levels: OrderLevel[],
  requestedQuantity: number,
  bestPriceFirst: "ascending" | "descending",
  consumeOrders: boolean,
): { total: number; average: number } | undefined {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return undefined;
  const valid = levels
    .filter((level) => level.amount > 0 && level.pricePerUnit > 0)
    .sort((left, right) => bestPriceFirst === "ascending"
      ? left.pricePerUnit - right.pricePerUnit
      : right.pricePerUnit - left.pricePerUnit);
  if (!consumeOrders) {
    const price = valid[0]?.pricePerUnit;
    return price === undefined ? undefined : { total: price * requestedQuantity, average: price };
  }
  if (levelAmount(valid) + 1e-6 < requestedQuantity) return undefined;
  let remaining = requestedQuantity;
  let total = 0;
  for (const level of valid) {
    if (remaining <= 1e-8) break;
    const quantity = Math.min(remaining, level.amount);
    total += quantity * level.pricePerUnit;
    remaining -= quantity;
  }
  return remaining > 1e-6 ? undefined : { total, average: total / requestedQuantity };
}

function emptyDepth(limitedBy: string): CraftFlip["depth"] {
  return { available: false, partial: false, maxCrafts: 0, maxOutput: 0, maxProfit: 0, limitedBy };
}

function evaluateCraftPlan(
  recipe: CraftRecipe,
  orderBooks: Readonly<Record<string, ShardOrderBook>>,
  strategy: CraftStrategy,
  taxRate: number,
  craftCount: number,
  fraction: 1 | 0.8,
): CraftProfitPlan | undefined {
  if (!Number.isInteger(craftCount) || craftCount < 1) return undefined;
  const ingredients: CraftProfitPlan["ingredients"] = [];
  let inputCost = 0;
  for (const ingredient of recipe.ingredients) {
    const amount = ingredient.amount * craftCount;
    const priced = priceInput(orderBooks[ingredient.productId], strategy, amount);
    if (!priced) return undefined;
    ingredients.push({ ...ingredient, amount, unitCost: priced.average, totalCost: priced.total });
    inputCost += priced.total;
  }
  const outputQuantity = recipe.output.amount * craftCount;
  const output = priceOutput(orderBooks[recipe.output.productId], strategy, outputQuantity);
  if (!output) return undefined;
  const grossRevenue = output.total;
  const revenueAfterTax = grossRevenue * (1 - taxRate);
  return {
    fraction,
    craftCount,
    outputQuantity,
    ingredients,
    inputCost,
    grossRevenue,
    revenueAfterTax,
    totalProfit: revenueAfterTax - inputCost,
  };
}

function calculateCraftDepth(
  recipe: CraftRecipe,
  marketByProduct: ReadonlyMap<string, MarketItem>,
  orderBooks: Readonly<Record<string, ShardOrderBook>>,
  strategy: CraftStrategy,
  taxRate: number,
): CraftFlip["depth"] {
  const limits: Array<{ crafts: number; reason: string }> = [];
  const outputMarket = marketByProduct.get(recipe.output.productId);
  if (!outputMarket) return emptyDepth("成品沒有 Bazaar 行情");
  const partial = Boolean(
    (outputUsesInstant(strategy) && orderBooks[recipe.output.productId]?.partial)
    || (inputUsesInstant(strategy) && recipe.ingredients.some((ingredient) =>
      orderBooks[ingredient.productId]?.partial)),
  );

  const outputWeekly = Math.min(outputMarket.buyMovingWeek, outputMarket.sellMovingWeek);
  limits.push({
    crafts: Math.floor(outputWeekly / recipe.output.amount),
    reason: "成品近 7 日成交量",
  });
  if (outputUsesInstant(strategy)) {
    limits.push({
      crafts: Math.floor(levelAmount(orderBooks[recipe.output.productId]?.buyOrders ?? []) / recipe.output.amount),
      reason: "成品 Buy Orders 可見深度",
    });
  }

  for (const ingredient of recipe.ingredients) {
    const ingredientMarket = marketByProduct.get(ingredient.productId);
    if (!ingredientMarket) return emptyDepth(`${ingredient.name} 沒有 Bazaar 行情`);
    const weekly = Math.min(ingredientMarket.buyMovingWeek, ingredientMarket.sellMovingWeek);
    limits.push({
      crafts: Math.floor(weekly / ingredient.amount),
      reason: `${ingredient.name} 近 7 日成交量`,
    });
    if (inputUsesInstant(strategy)) {
      limits.push({
        crafts: Math.floor(levelAmount(orderBooks[ingredient.productId]?.sellOffers ?? []) / ingredient.amount),
        reason: `${ingredient.name} Sell Offers 可見深度`,
      });
    }
  }

  const finiteLimits = limits.filter((limit) => Number.isFinite(limit.crafts) && limit.crafts >= 0);
  const bindingLimit = finiteLimits.reduce((minimum, limit) =>
    limit.crafts < minimum.crafts ? limit : minimum,
  { crafts: Number.MAX_SAFE_INTEGER, reason: "市場流動性" });
  const upperBound = bindingLimit.crafts;
  if (!Number.isSafeInteger(upperBound) || upperBound < 1) return emptyDepth(bindingLimit.reason);

  const profitAt = (craftCount: number) => evaluateCraftPlan(
    recipe, orderBooks, strategy, taxRate, craftCount, 1,
  )?.totalProfit ?? Number.NEGATIVE_INFINITY;
  let low = 1;
  let high = upperBound;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (profitAt(middle + 1) >= profitAt(middle)) low = middle + 1;
    else high = middle;
  }
  const maxCrafts = low;
  const full = evaluateCraftPlan(recipe, orderBooks, strategy, taxRate, maxCrafts, 1);
  if (!full || !Number.isFinite(full.totalProfit) || full.totalProfit <= 0) {
    return emptyDepth("目前深度沒有正 Total Profit");
  }

  const target = full.totalProfit * 0.8;
  low = 1;
  high = maxCrafts;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (profitAt(middle) >= target) high = middle;
    else low = middle + 1;
  }
  const eighty = evaluateCraftPlan(recipe, orderBooks, strategy, taxRate, low, 0.8);
  return {
    available: true,
    partial,
    maxCrafts,
    maxOutput: full.outputQuantity,
    maxProfit: full.totalProfit,
    limitedBy: maxCrafts < upperBound ? "邊際 Craft Profit" : bindingLimit.reason,
    fullPlan: full,
    ...(eighty ? { eightyPercentPlan: eighty } : {}),
  };
}

export function calculateCraftProfitPlan(
  flip: CraftFlip,
  fraction: 1 | 0.8 = 1,
): CraftProfitPlan | undefined {
  return fraction === 1 ? flip.depth.fullPlan : flip.depth.eightyPercentPlan;
}

function priceInput(
  book: ShardOrderBook | undefined,
  strategy: CraftStrategy,
  quantity: number,
) {
  if (!book) return undefined;
  const instant = inputUsesInstant(strategy);
  return priceLevels(
    instant ? book.sellOffers : book.buyOrders,
    quantity,
    instant ? "ascending" : "descending",
    instant,
  );
}

function priceOutput(
  book: ShardOrderBook | undefined,
  strategy: CraftStrategy,
  quantity: number,
) {
  if (!book) return undefined;
  const instant = outputUsesInstant(strategy);
  return priceLevels(
    instant ? book.buyOrders : book.sellOffers,
    quantity,
    instant ? "descending" : "ascending",
    instant,
  );
}

export function calculateCraftFlips(
  data: CraftData,
  market: MarketItem[],
  orderBooks: Readonly<Record<string, ShardOrderBook>>,
  strategy: CraftStrategy,
  taxRate: number,
): { flips: CraftFlip[]; skippedCount: number } {
  const marketByProduct = new Map(market.map((item) => [item.productId, item]));
  const flips: CraftFlip[] = [];
  let skippedCount = 0;

  for (const recipe of data.recipes) {
    const outputMarket = marketByProduct.get(recipe.output.productId);
    if (!outputMarket || recipe.ingredients.length === 0) {
      skippedCount += 1;
      continue;
    }
    const ingredients: CraftFlipIngredient[] = [];
    let inputCost = 0;
    let partial = Boolean(orderBooks[recipe.output.productId]?.partial);
    let available = true;
    for (const ingredient of recipe.ingredients) {
      if (!marketByProduct.has(ingredient.productId)) {
        available = false;
        break;
      }
      const priced = priceInput(orderBooks[ingredient.productId], strategy, ingredient.amount);
      if (!priced) {
        available = false;
        break;
      }
      ingredients.push({ ...ingredient, unitCost: priced.average, totalCost: priced.total });
      inputCost += priced.total;
      partial ||= Boolean(orderBooks[ingredient.productId]?.partial);
    }
    const output = available
      ? priceOutput(orderBooks[recipe.output.productId], strategy, recipe.output.amount)
      : undefined;
    if (!output || !Number.isFinite(inputCost) || inputCost <= 0) {
      skippedCount += 1;
      continue;
    }

    const grossRevenue = output.total;
    const revenueAfterTax = grossRevenue * (1 - taxRate);
    const profit = revenueAfterTax - inputCost;
    const depth = calculateCraftDepth(recipe, marketByProduct, orderBooks, strategy, taxRate);
    flips.push({
      recipeId: recipe.id,
      strategy,
      productId: recipe.output.productId,
      name: recipe.output.name,
      outputAmount: recipe.output.amount,
      ingredients,
      inputCost,
      grossRevenue,
      revenueAfterTax,
      profit,
      profitPerOutput: profit / recipe.output.amount,
      marginPercent: profit / inputCost * 100,
      buyMovingWeek: outputMarket.buyMovingWeek,
      sellMovingWeek: outputMarket.sellMovingWeek,
      matchedVolume7d: Math.min(outputMarket.buyMovingWeek, outputMarket.sellMovingWeek),
      partial,
      depth,
      requirement: normalizeCraftRequirement(recipe.requirement),
      source: recipe.source,
    });
  }
  return { flips, skippedCount };
}
