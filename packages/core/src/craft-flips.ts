import {
  type CraftData,
  type CraftFlip,
  type CraftFlipIngredient,
  type CraftStrategy,
  type MarketItem,
  type OrderLevel,
  type ShardOrderBook,
} from "./types";

const inputUsesInstant = (strategy: CraftStrategy): boolean => strategy.startsWith("ib");
const outputUsesInstant = (strategy: CraftStrategy): boolean => strategy.endsWith("is");

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
  if (levelAmount(valid) + 1e-6 < requestedQuantity) return undefined;
  if (!consumeOrders) {
    const price = valid[0]?.pricePerUnit;
    return price === undefined ? undefined : { total: price * requestedQuantity, average: price };
  }
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
      requirement: recipe.requirement,
      source: recipe.source,
    });
  }
  return { flips, skippedCount };
}
