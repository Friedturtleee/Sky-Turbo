import {
  BAZAAR_TAX_RATE,
  type FusionData,
  type MarketFilterKey,
  type MarketFilters,
  type MarketItem,
  type MinProfitThreshold,
  type OrderLevel,
  type ShardDepth,
  type ShardFlip,
  type ShardOrderBook,
  type ShardRouteNode,
  type ShardStrategy,
} from "./types";

const inputUsesInstant = (strategy: ShardStrategy): boolean => strategy.startsWith("ib");
const outputUsesInstant = (strategy: ShardStrategy): boolean => strategy.endsWith("is");

export function shardProductId(shard: FusionData["shards"][string]): string {
  const internal = shard.internal_id?.trim();
  if (internal?.startsWith("SHARD_")) return internal;
  return `SHARD_${shard.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

const filterValue = (item: MarketItem, key: MarketFilterKey): number | undefined => {
  if (key === "volatility") return item.volatility?.["7d"] ?? 0;
  if (key === "price") return item.midpoint;
  return item[key];
};

export function marketMatchesFilters(item: MarketItem, filters: MarketFilters = {}): boolean {
  for (const [key, range] of Object.entries(filters) as [MarketFilterKey, MarketFilters[MarketFilterKey]][]) {
    if (!range || (range.min === undefined && range.max === undefined)) continue;
    const value = filterValue(item, key);
    if (value === undefined || !Number.isFinite(value)) return false;
    if (range.min !== undefined && value < range.min) return false;
    if (range.max !== undefined && value > range.max) return false;
  }
  return true;
}

type CostPlan =
  | { kind: "market"; shardId: string; productId: string }
  | {
      kind: "fusion";
      shardId: string;
      baseOutput: number;
      left: { node: CostNode; quantity: number };
      right: { node: CostNode; quantity: number };
    };

type CostNode = { unitCost: number; path: string[]; plan: CostPlan };

type ShardCalculationOptions = {
  marketFilters?: MarketFilters;
  orderBooks?: Record<string, ShardOrderBook>;
  minProfit?: MinProfitThreshold;
  minFlipProfit?: MinProfitThreshold;
  maxFusions?: number;
  /** @deprecated Use minProfit with an explicit mode. */
  minProfitPercent?: number;
};

/**
 * Crocodile is deliberately excluded here. It changes the final recipe's EV
 * and profit, but never reduces the integer raw-material shopping plan.
 */
function solveUnitCosts(
  data: FusionData,
  marketByProduct: Map<string, MarketItem>,
  strategy: ShardStrategy,
  filters: MarketFilters,
): Map<string, CostNode> {
  const costs = new Map<string, CostNode>();
  for (const [shardId, shard] of Object.entries(data.shards)) {
    const productId = shardProductId(shard);
    const item = marketByProduct.get(productId);
    if (!item || !marketMatchesFilters(item, filters)) continue;
    const unitCost = inputUsesInstant(strategy) ? item.instantBuyPrice : item.buyOrderPrice;
    if (unitCost > 0) {
      costs.set(shardId, {
        unitCost,
        path: [shardId],
        plan: { kind: "market", shardId, productId },
      });
    }
  }

  const recipeCount = Object.values(data.recipes).reduce(
    (count, buckets) => count + Object.values(buckets).reduce((sum, pairs) => sum + pairs.length, 0),
    0,
  );
  const maxPasses = Math.min(16, Math.max(8, Math.ceil(Math.log2(recipeCount + 1))));
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const [outputId, buckets] of Object.entries(data.recipes)) {
      for (const [quantityText, pairs] of Object.entries(buckets)) {
        const baseOutput = Number(quantityText);
        if (!Number.isFinite(baseOutput) || baseOutput <= 0) continue;
        for (const [leftId, rightId] of pairs) {
          const left = data.shards[leftId];
          const right = data.shards[rightId];
          const leftCost = costs.get(leftId);
          const rightCost = costs.get(rightId);
          if (!left || !right || !leftCost || !rightCost) continue;
          if (leftCost.path.includes(outputId) || rightCost.path.includes(outputId)) continue;
          const total = leftCost.unitCost * left.fuse_amount + rightCost.unitCost * right.fuse_amount;
          const candidate = total / baseOutput;
          const current = costs.get(outputId);
          if (candidate + 1e-7 >= (current?.unitCost ?? Number.POSITIVE_INFINITY)) continue;
          costs.set(outputId, {
            unitCost: candidate,
            path: [...leftCost.path, ...rightCost.path, outputId],
            plan: {
              kind: "fusion",
              shardId: outputId,
              baseOutput,
              left: { node: leftCost, quantity: left.fuse_amount },
              right: { node: rightCost, quantity: right.fuse_amount },
            },
          });
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return costs;
}

function buildInputRoute(node: CostNode, requiredQuantity: number, data: FusionData): ShardRouteNode {
  const shard = data.shards[node.plan.shardId];
  const name = shard?.name ?? node.plan.shardId;
  const productId = shard ? shardProductId(shard) : node.plan.shardId;
  if (node.plan.kind === "market") {
    return {
      kind: "market",
      shardId: node.plan.shardId,
      productId: node.plan.productId,
      name,
      requiredQuantity,
      quantity: Math.max(0, Math.ceil(requiredQuantity - 1e-8)),
      unitCost: node.unitCost,
    };
  }
  const fusionCount = Math.max(1, Math.ceil(requiredQuantity / node.plan.baseOutput - 1e-8));
  return {
    kind: "fusion",
    shardId: node.plan.shardId,
    productId,
    name,
    requiredQuantity,
    fusionCount,
    baseOutput: node.plan.baseOutput,
    expectedOutput: fusionCount * node.plan.baseOutput,
    inputs: [
      buildInputRoute(node.plan.left.node, fusionCount * node.plan.left.quantity, data),
      buildInputRoute(node.plan.right.node, fusionCount * node.plan.right.quantity, data),
    ],
  };
}

function collectMaterials(
  routes: ShardRouteNode[],
): Array<{ shardId: string; productId: string; name: string; quantityPerFusion: number; unitCost: number }> {
  const result = new Map<string, { shardId: string; productId: string; name: string; quantityPerFusion: number; unitCost: number }>();
  const visit = (node: ShardRouteNode) => {
    if (node.kind === "fusion") {
      node.inputs.forEach(visit);
      return;
    }
    const current = result.get(node.productId);
    result.set(node.productId, {
      shardId: node.shardId,
      productId: node.productId,
      name: node.name,
      quantityPerFusion: (current?.quantityPerFusion ?? 0) + node.quantity,
      unitCost: node.unitCost,
    });
  };
  routes.forEach(visit);
  return [...result.values()];
}

function buildFinalRoute(
  outputId: string,
  outputName: string,
  outputProductId: string,
  baseOutput: number,
  expectedOutput: number,
  fusionCount: number,
  left: { node: CostNode; quantity: number },
  right: { node: CostNode; quantity: number },
  data: FusionData,
): Extract<ShardRouteNode, { kind: "fusion" }> {
  return {
    kind: "fusion",
    shardId: outputId,
    productId: outputProductId,
    name: outputName,
    requiredQuantity: fusionCount * expectedOutput,
    fusionCount,
    baseOutput,
    expectedOutput: fusionCount * expectedOutput,
    inputs: [
      buildInputRoute(left.node, fusionCount * left.quantity, data),
      buildInputRoute(right.node, fusionCount * right.quantity, data),
    ],
  };
}

function scaleRequiredRoute(node: ShardRouteNode, requiredQuantity: number): ShardRouteNode {
  if (node.kind === "market") {
    return { ...node, requiredQuantity, quantity: Math.max(0, Math.ceil(requiredQuantity - 1e-8)) };
  }
  const fusionCount = requiredQuantity <= 0
    ? 0
    : Math.max(1, Math.ceil(requiredQuantity / node.baseOutput - 1e-8));
  return scaleFusionRoute(node, fusionCount, requiredQuantity);
}

function scaleFusionRoute(
  node: Extract<ShardRouteNode, { kind: "fusion" }>,
  fusionCount: number,
  requiredQuantity: number,
): Extract<ShardRouteNode, { kind: "fusion" }> {
  const originalCount = Math.max(1, node.fusionCount);
  const expectedPerFusion = node.expectedOutput / originalCount;
  return {
    ...node,
    requiredQuantity,
    fusionCount,
    expectedOutput: expectedPerFusion * fusionCount,
    inputs: node.inputs.map((input) =>
      scaleRequiredRoute(input, (input.requiredQuantity / originalCount) * fusionCount),
    ) as [ShardRouteNode, ShardRouteNode],
  };
}

export function countShardRouteFusions(route: ShardRouteNode): number {
  if (route.kind === "market") return 0;
  return route.fusionCount + route.inputs.reduce(
    (total, input) => total + countShardRouteFusions(input),
    0,
  );
}

export function scaleShardRouteForOutput(
  route: ShardRouteNode,
  desiredOutput: number,
  options: { useBaseOutput?: boolean } = {},
) {
  const requested = Math.max(0, Math.ceil(desiredOutput));
  if (route.kind !== "fusion") {
    const scaledRoute = scaleRequiredRoute(route, requested);
    return {
      route: scaledRoute,
      fusionCount: 0,
      totalFusionCount: 0,
      expectedOutput: requested,
    };
  }
  const outputPerFusion = options.useBaseOutput
    ? route.baseOutput
    : route.expectedOutput / Math.max(1, route.fusionCount);
  const fusionCount = requested === 0
    ? 0
    : Math.max(1, Math.ceil(requested / outputPerFusion - 1e-8));
  const scaledRoute = scaleFusionRoute(route, fusionCount, requested);
  return {
    route: scaledRoute,
    fusionCount,
    totalFusionCount: countShardRouteFusions(scaledRoute),
    expectedOutput: scaledRoute.expectedOutput,
  };
}

export function defaultShardDesiredOutput(flip: ShardFlip): number {
  if (!flip.depth.available || flip.depth.maxProfitableFusions <= 0) return 0;
  return Math.max(0, Math.floor(flip.depth.maxProfitableOutput + 1e-8));
}

export function collectShardRouteMaterials(route: ShardRouteNode) {
  const materials = new Map<string, { productId: string; name: string; quantity: number; unitCost: number }>();
  const visit = (node: ShardRouteNode) => {
    if (node.kind === "fusion") {
      node.inputs.forEach(visit);
      return;
    }
    const current = materials.get(node.productId);
    materials.set(node.productId, {
      productId: node.productId,
      name: node.name,
      quantity: (current?.quantity ?? 0) + node.quantity,
      unitCost: node.unitCost,
    });
  };
  visit(route);
  return [...materials.values()];
}

function addMaterialRates(node: CostNode, quantity: number, rates: Map<string, number>): void {
  if (node.plan.kind === "market") {
    rates.set(node.plan.productId, (rates.get(node.plan.productId) ?? 0) + quantity);
    return;
  }
  const batches = quantity / node.plan.baseOutput;
  addMaterialRates(node.plan.left.node, batches * node.plan.left.quantity, rates);
  addMaterialRates(node.plan.right.node, batches * node.plan.right.quantity, rates);
}

function selectedInputLevels(book: ShardOrderBook | undefined, strategy: ShardStrategy): OrderLevel[] {
  return inputUsesInstant(strategy) ? (book?.sellOffers ?? []) : (book?.buyOrders ?? []);
}

function selectedOutputLevels(book: ShardOrderBook | undefined, strategy: ShardStrategy): OrderLevel[] {
  return outputUsesInstant(strategy) ? (book?.buyOrders ?? []) : (book?.sellOffers ?? []);
}

function levelAmount(levels: OrderLevel[]): number {
  return levels.reduce((sum, level) => sum + Math.max(0, level.amount), 0);
}

function priceLevels(
  levels: OrderLevel[],
  requestedQuantity: number,
  bestPriceFirst: "ascending" | "descending",
  consumeOrders: boolean,
): { filled: boolean; total: number } {
  const validLevels = levels
    .filter((level) => level.amount > 0 && level.pricePerUnit > 0)
    .sort((left, right) => bestPriceFirst === "ascending"
      ? left.pricePerUnit - right.pricePerUnit
      : right.pricePerUnit - left.pricePerUnit);
  if (!consumeOrders) {
    const bestPrice = validLevels[0]?.pricePerUnit;
    return {
      filled: bestPrice !== undefined && levelAmount(validLevels) + 1e-6 >= requestedQuantity,
      total: bestPrice === undefined ? 0 : requestedQuantity * bestPrice,
    };
  }
  let remaining = requestedQuantity;
  let total = 0;
  for (const level of validLevels) {
    if (remaining <= 1e-8) break;
    const quantity = Math.min(remaining, level.amount);
    total += quantity * level.pricePerUnit;
    remaining -= quantity;
  }
  return { filled: remaining <= 1e-6, total };
}

function priceInputLevels(
  book: ShardOrderBook | undefined,
  strategy: ShardStrategy,
  requestedQuantity: number,
): { filled: boolean; total: number } {
  const instant = inputUsesInstant(strategy);
  return priceLevels(
    selectedInputLevels(book, strategy),
    requestedQuantity,
    instant ? "ascending" : "descending",
    instant,
  );
}

function priceOutputLevels(
  book: ShardOrderBook | undefined,
  strategy: ShardStrategy,
  requestedQuantity: number,
): { filled: boolean; total: number } {
  const instant = outputUsesInstant(strategy);
  return priceLevels(
    selectedOutputLevels(book, strategy),
    requestedQuantity,
    instant ? "descending" : "ascending",
    instant,
  );
}

function priceMaterialsFromOrderBook(
  materials: Array<{ productId: string; quantityPerFusion: number }>,
  books: Record<string, ShardOrderBook> | undefined,
  strategy: ShardStrategy,
): { total: number; averageUnitCosts: Map<string, number> } | undefined {
  if (!books) return undefined;
  let total = 0;
  const averageUnitCosts = new Map<string, number>();
  for (const material of materials) {
    const priced = priceInputLevels(
      books[material.productId],
      strategy,
      material.quantityPerFusion,
    );
    if (!priced.filled) return undefined;
    total += priced.total;
    averageUnitCosts.set(
      material.productId,
      material.quantityPerFusion > 0 ? priced.total / material.quantityPerFusion : 0,
    );
  }
  return { total, averageUnitCosts };
}

function applyMarketUnitCosts(node: ShardRouteNode, unitCosts: Map<string, number>): ShardRouteNode {
  if (node.kind === "market") {
    return { ...node, unitCost: unitCosts.get(node.productId) ?? node.unitCost };
  }
  return {
    ...node,
    inputs: node.inputs.map((input) => applyMarketUnitCosts(input, unitCosts)) as [ShardRouteNode, ShardRouteNode],
  };
}

function normalizeProfitThreshold(
  threshold: MinProfitThreshold | undefined,
  fallback: MinProfitThreshold,
): MinProfitThreshold {
  const requested = threshold ?? fallback;
  const mode = requested.mode === "coins" ? "coins" : "percent";
  return {
    mode,
    value: Number.isFinite(requested.value)
      ? Math.max(0, mode === "percent" ? Math.min(100, requested.value) : requested.value)
      : fallback.value,
  };
}

function unavailableDepth(
  reason: string,
  minProfit: MinProfitThreshold,
  minFlipProfit: MinProfitThreshold,
  maxFusionLimit?: number,
): ShardDepth {
  return {
    available: false,
    maxFusionLimit,
    maxProfitableFusions: 0,
    maxProfitableOutput: 0,
    totalInputCost: 0,
    totalRevenueAfterTax: 0,
    totalProfit: 0,
    minProfit,
    minFlipProfit,
    maxFlipProfit: 0,
    materialsRequired: [],
    limitedBy: reason,
    partial: false,
    model: "selected-side-top-30",
  };
}

type DepthEvaluation = {
  inputCost: number;
  revenueAfterTax: number;
  profit: number;
  materials: ShardDepth["materialsRequired"];
};

function calculateDepth(
  data: FusionData,
  left: { node: CostNode; quantity: number },
  right: { node: CostNode; quantity: number },
  outputProductId: string,
  outputName: string,
  expectedOutput: number,
  strategy: ShardStrategy,
  books: Record<string, ShardOrderBook> | undefined,
  taxRate: number,
  minProfit: MinProfitThreshold,
  minFlipProfit: MinProfitThreshold,
  maxFusionLimit?: number,
): ShardDepth {
  if (!books) return unavailableDepth("尚無掛單資料", minProfit, minFlipProfit, maxFusionLimit);
  const rates = new Map<string, number>();
  addMaterialRates(left.node, left.quantity, rates);
  addMaterialRates(right.node, right.quantity, rates);
  const outputBook = books[outputProductId];
  const outputLevels = selectedOutputLevels(outputBook, strategy);
  if (outputLevels.length === 0) return unavailableDepth(`${outputName} 無掛單`, minProfit, minFlipProfit, maxFusionLimit);

  let maximumByDepth = levelAmount(outputLevels) / expectedOutput;
  let limitingName = outputName;
  for (const [productId, rate] of rates) {
    const book = books[productId];
    const levels = selectedInputLevels(book, strategy);
    const shardName = productId.replace(/^SHARD_/, "").replaceAll("_", " ");
    if (levels.length === 0) return unavailableDepth(`${shardName} 無掛單`, minProfit, minFlipProfit, maxFusionLimit);
    const capacity = levelAmount(levels) / rate;
    if (capacity < maximumByDepth) {
      maximumByDepth = capacity;
      limitingName = shardName;
    }
  }
  const marketUpperBound = Math.max(0, Math.min(2_000_000_000, Math.floor(maximumByDepth + 1e-8)));
  const buildRoute = (finalFusionCount: number) => buildFinalRoute(
    "",
    outputName,
    outputProductId,
    expectedOutput,
    expectedOutput,
    finalFusionCount,
    left,
    right,
    data,
  );
  const totalFusionCount = (finalFusionCount: number) =>
    finalFusionCount <= 0 ? 0 : countShardRouteFusions(buildRoute(finalFusionCount));
  let maximumByFusionLimit = marketUpperBound;
  if (maxFusionLimit !== undefined) {
    let low = 0;
    let high = marketUpperBound;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (totalFusionCount(middle) <= maxFusionLimit) low = middle;
      else high = middle - 1;
    }
    maximumByFusionLimit = low;
  }
  const upperBound = Math.min(marketUpperBound, maximumByFusionLimit);
  const cappedByMaxFusions = maxFusionLimit !== undefined && maximumByFusionLimit < marketUpperBound;
  const cache = new Map<number, DepthEvaluation | null>();
  const evaluate = (fusionCount: number): DepthEvaluation | null => {
    const cached = cache.get(fusionCount);
    if (cached !== undefined) return cached;
    if (fusionCount === 0) {
      const zero = { inputCost: 0, revenueAfterTax: 0, profit: 0, materials: [] };
      cache.set(0, zero);
      return zero;
    }
    const root = buildRoute(fusionCount);
    const materials = collectMaterials(root.inputs);
    let inputCost = 0;
    const materialTotals: ShardDepth["materialsRequired"] = [];
    for (const material of materials) {
      const priced = priceInputLevels(
        books[material.productId],
        strategy,
        material.quantityPerFusion,
      );
      if (!priced.filled) {
        cache.set(fusionCount, null);
        return null;
      }
      inputCost += priced.total;
      materialTotals.push({
        shardId: material.shardId,
        productId: material.productId,
        name: material.name,
        quantity: material.quantityPerFusion,
        estimatedCost: priced.total,
      });
    }
    const output = priceOutputLevels(outputBook, strategy, fusionCount * expectedOutput);
    if (!output.filled) {
      cache.set(fusionCount, null);
      return null;
    }
    const revenueAfterTax = output.total * (1 - taxRate);
    const evaluation = {
      inputCost,
      revenueAfterTax,
      profit: revenueAfterTax - inputCost,
      materials: materialTotals,
    };
    cache.set(fusionCount, evaluation);
    return evaluation;
  };
  const qualifies = (fusionCount: number): boolean => {
    const result = evaluate(fusionCount);
    const minimum = minProfit.mode === "percent"
      ? (result?.inputCost ?? 0) * (minProfit.value / 100)
      : minProfit.value;
    return Boolean(
      result &&
      result.profit > 0 &&
      result.profit + 1e-7 >= minimum,
    );
  };

  const marginalProfit = (fusionCount: number): number | undefined => {
    if (fusionCount <= 0) return undefined;
    const previous = evaluate(fusionCount - 1);
    const current = evaluate(fusionCount);
    if (!previous || !current) return undefined;
    return current.profit - previous.profit;
  };
  const maxFlipProfit = Math.max(0, evaluate(1)?.profit ?? 0);
  const minFlipProfitAmount = minFlipProfit.mode === "percent"
    ? maxFlipProfit * (minFlipProfit.value / 100)
    : minFlipProfit.value;
  let maximumByFlipProfit = upperBound;
  if (minFlipProfitAmount > 0 && upperBound > 0) {
    const flipQualifies = (fusionCount: number): boolean =>
      (marginalProfit(fusionCount) ?? Number.NEGATIVE_INFINITY) + 1e-7 >= minFlipProfitAmount;
    if (!flipQualifies(upperBound)) {
      let low = 0;
      let high = upperBound;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (flipQualifies(middle)) low = middle;
        else high = middle - 1;
      }
      maximumByFlipProfit = low;
    }
  }

  let best = 0;
  if (maximumByFlipProfit > 0 && qualifies(maximumByFlipProfit)) {
    best = maximumByFlipProfit;
  } else if (maximumByFlipProfit > 0 && minProfit.mode === "coins" && minProfit.value > 0) {
    // A fixed-coin floor is not a prefix predicate: small runs can be below
    // the floor before larger runs become profitable. Locate the profit peak,
    // then search its descending side for the last qualifying Fusion count.
    let peakLow = 1;
    let peakHigh = maximumByFlipProfit;
    while (peakHigh - peakLow > 16) {
      const third = Math.floor((peakHigh - peakLow) / 3);
      const leftProbe = peakLow + third;
      const rightProbe = peakHigh - third;
      const leftProfit = evaluate(leftProbe)?.profit ?? Number.NEGATIVE_INFINITY;
      const rightProfit = evaluate(rightProbe)?.profit ?? Number.NEGATIVE_INFINITY;
      if (leftProfit < rightProfit) peakLow = leftProbe + 1;
      else peakHigh = rightProbe - 1;
    }
    let peak = peakLow;
    let peakProfit = Number.NEGATIVE_INFINITY;
    for (let count = peakLow; count <= peakHigh; count += 1) {
      const profit = evaluate(count)?.profit ?? Number.NEGATIVE_INFINITY;
      if (profit > peakProfit) {
        peak = count;
        peakProfit = profit;
      }
    }
    if (qualifies(peak)) {
      let low = peak;
      let high = maximumByFlipProfit;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (qualifies(middle)) low = middle;
        else high = middle - 1;
      }
      best = low;
    }
  } else {
    let low = 0;
    let high = maximumByFlipProfit;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (qualifies(middle)) low = middle;
      else high = middle - 1;
    }
    best = low;
  }
  const totals = evaluate(best) ?? { inputCost: 0, revenueAfterTax: 0, profit: 0, materials: [] };
  const partial =
    Boolean(outputBook?.partial) ||
    [...rates.keys()].some((productId) => Boolean(books[productId]?.partial));
  return {
    available: true,
    maxFusionLimit,
    maxProfitableFusions: totalFusionCount(best),
    maxProfitableOutput: best * expectedOutput,
    totalInputCost: totals.inputCost,
    totalRevenueAfterTax: totals.revenueAfterTax,
    totalProfit: totals.profit,
    minProfit,
    minFlipProfit,
    maxFlipProfit,
    materialsRequired: totals.materials,
    limitedBy: best < maximumByFlipProfit
      ? `Min Profit ${minProfit.mode === "percent" ? `${minProfit.value}%` : `${minProfit.value.toLocaleString("en-US")} coins`}`
      : maximumByFlipProfit < upperBound
        ? `Min Flip Profit ${minFlipProfit.mode === "percent" ? `${minFlipProfit.value}%` : `${minFlipProfit.value.toLocaleString("en-US")} coins`}`
        : cappedByMaxFusions
          ? `Max Fusion ${maxFusionLimit}`
          : `${limitingName} 市場深度`,
    partial,
    model: "selected-side-top-30",
  };
}

type BestCandidate = {
  outputId: string;
  outputName: string;
  outputProductId: string;
  family: string;
  rarity: string;
  baseOutput: number;
  expectedOutput: number;
  crocodileApplied: boolean;
  salePrice: number;
  approximateProfit: number;
  leftId: string;
  rightId: string;
  left: FusionData["shards"][string];
  right: FusionData["shards"][string];
  leftCost: CostNode;
  rightCost: CostNode;
};

export function calculateShardFlips(
  data: FusionData,
  market: MarketItem[],
  strategy: ShardStrategy,
  crocodileLevel: number,
  taxRate = BAZAAR_TAX_RATE,
  options: ShardCalculationOptions = {},
): ShardFlip[] {
  const level = Math.min(10, Math.max(0, Math.trunc(crocodileLevel)));
  const filters = options.marketFilters ?? {};
  const minProfit = normalizeProfitThreshold(
    options.minProfit,
    { mode: "percent", value: options.minProfitPercent ?? 0.1 },
  );
  const minFlipProfit = normalizeProfitThreshold(
    options.minFlipProfit,
    { mode: "percent", value: 80 },
  );
  const maxFusionLimit = options.maxFusions !== undefined && Number.isFinite(options.maxFusions)
    ? Math.max(0, Math.floor(options.maxFusions))
    : undefined;
  const marketByProduct = new Map(market.map((item) => [item.productId, item]));
  const costs = solveUnitCosts(data, marketByProduct, strategy, filters);
  const bestCandidates = new Map<string, BestCandidate>();

  for (const [outputId, buckets] of Object.entries(data.recipes)) {
    const outputShard = data.shards[outputId];
    if (!outputShard) continue;
    const outputProductId = shardProductId(outputShard);
    const outputMarket = marketByProduct.get(outputProductId);
    if (!outputMarket || !marketMatchesFilters(outputMarket, filters)) continue;
    const salePrice = outputUsesInstant(strategy) ? outputMarket.instantSellPrice : outputMarket.sellOrderPrice;
    if (salePrice <= 0) continue;
    for (const [quantityText, pairs] of Object.entries(buckets)) {
      const baseOutput = Number(quantityText);
      if (!Number.isFinite(baseOutput) || baseOutput <= 0) continue;
      for (const [leftId, rightId] of pairs) {
        const left = data.shards[leftId];
        const right = data.shards[rightId];
        const leftCost = costs.get(leftId);
        const rightCost = costs.get(rightId);
        if (!left || !right || !leftCost || !rightCost) continue;
        const crocodileApplied = left.family.includes("Reptile") || right.family.includes("Reptile");
        const expectedOutput = baseOutput * (crocodileApplied ? 1 + level * 0.02 : 1);
        const approximateInputCost =
          leftCost.unitCost * left.fuse_amount + rightCost.unitCost * right.fuse_amount;
        const approximateProfit = salePrice * expectedOutput * (1 - taxRate) - approximateInputCost;
        const current = bestCandidates.get(outputId);
        if (current && current.approximateProfit >= approximateProfit) continue;
        bestCandidates.set(outputId, {
          outputId,
          outputName: outputShard.name,
          outputProductId,
          family: outputShard.family,
          rarity: outputShard.rarity,
          baseOutput,
          expectedOutput,
          crocodileApplied,
          salePrice,
          approximateProfit,
          leftId,
          rightId,
          left,
          right,
          leftCost,
          rightCost,
        });
      }
    }
  }

  const flips: ShardFlip[] = [];
  for (const candidate of bestCandidates.values()) {
    const leftInput = { node: candidate.leftCost, quantity: candidate.left.fuse_amount };
    const rightInput = { node: candidate.rightCost, quantity: candidate.right.fuse_amount };
    let route = buildFinalRoute(
      candidate.outputId,
      candidate.outputName,
      candidate.outputProductId,
      candidate.baseOutput,
      candidate.expectedOutput,
      1,
      leftInput,
      rightInput,
      data,
    );
    let materials = collectMaterials(route.inputs);
    const approximateInputCost = materials.reduce(
      (sum, material) => sum + material.quantityPerFusion * material.unitCost,
      0,
    );
    const exactMaterialPricing = priceMaterialsFromOrderBook(materials, options.orderBooks, strategy);
    const inputCost = exactMaterialPricing?.total ?? approximateInputCost;
    if (exactMaterialPricing) {
      route = applyMarketUnitCosts(route, exactMaterialPricing.averageUnitCosts) as typeof route;
      materials = materials.map((material) => ({
        ...material,
        unitCost: exactMaterialPricing.averageUnitCosts.get(material.productId) ?? material.unitCost,
      }));
    }
    const exactOutput = priceOutputLevels(
      options.orderBooks?.[candidate.outputProductId],
      strategy,
      candidate.expectedOutput,
    );
    const revenueAfterTax = (exactOutput.filled
      ? exactOutput.total
      : candidate.salePrice * candidate.expectedOutput) * (1 - taxRate);
    const profit = revenueAfterTax - inputCost;
    flips.push({
      shardId: candidate.outputId,
      productId: candidate.outputProductId,
      name: candidate.outputName,
      family: candidate.family,
      rarity: candidate.rarity,
      strategy,
      crocodileLevel: level,
      crocodileApplied: candidate.crocodileApplied,
      expectedOutput: candidate.expectedOutput,
      baseOutput: candidate.baseOutput,
      inputCost,
      revenueAfterTax,
      profit,
      profitPerOutput: profit / candidate.expectedOutput,
      marginPercent: inputCost > 0 ? (profit / inputCost) * 100 : 0,
      change24h: marketByProduct.get(candidate.outputProductId)?.changes?.["1d"],
      volatility7d: marketByProduct.get(candidate.outputProductId)?.volatility?.["7d"],
      inputs: [
        {
          shardId: candidate.leftId,
          name: candidate.left.name,
          quantity: candidate.left.fuse_amount,
          unitCost: candidate.leftCost.unitCost,
        },
        {
          shardId: candidate.rightId,
          name: candidate.right.name,
          quantity: candidate.right.fuse_amount,
          unitCost: candidate.rightCost.unitCost,
        },
      ],
      materials,
      route,
      depth: calculateDepth(
        data,
        leftInput,
        rightInput,
        candidate.outputProductId,
        candidate.outputName,
        candidate.expectedOutput,
        strategy,
        options.orderBooks,
        taxRate,
        minProfit,
        minFlipProfit,
        maxFusionLimit,
      ),
      path: [...candidate.leftCost.path, ...candidate.rightCost.path, candidate.outputId],
    });
  }
  return flips.sort((a, b) => b.profit - a.profit);
}

/**
 * Applies Crocodile's expected-output bonus without solving the fusion route
 * or consuming additional materials. Revenue is scaled by expected output;
 * the selected route, Fusion count and raw-material quantities stay fixed.
 */
export function applyCrocodileLevelToFlip(flip: ShardFlip, crocodileLevel: number): ShardFlip {
  const level = Math.min(10, Math.max(0, Math.trunc(crocodileLevel)));
  const expectedOutput = flip.baseOutput * (flip.crocodileApplied ? 1 + level * 0.02 : 1);
  const outputRatio = flip.expectedOutput > 0 ? expectedOutput / flip.expectedOutput : 1;
  const revenueAfterTax = flip.revenueAfterTax * outputRatio;
  const profit = revenueAfterTax - flip.inputCost;
  const totalRevenueAfterTax = flip.depth.totalRevenueAfterTax * outputRatio;
  const maxFlipProfit = flip.depth.maxFlipProfit + (revenueAfterTax - flip.revenueAfterTax);
  const route = flip.route.kind === "fusion"
    ? { ...flip.route, expectedOutput: flip.route.fusionCount * expectedOutput }
    : flip.route;

  return {
    ...flip,
    crocodileLevel: level,
    expectedOutput,
    revenueAfterTax,
    profit,
    profitPerOutput: expectedOutput > 0 ? profit / expectedOutput : 0,
    marginPercent: flip.inputCost > 0 ? (profit / flip.inputCost) * 100 : 0,
    route,
    depth: {
      ...flip.depth,
      maxProfitableOutput: flip.depth.maxProfitableOutput * outputRatio,
      totalRevenueAfterTax,
      totalProfit: totalRevenueAfterTax - flip.depth.totalInputCost,
      maxFlipProfit,
    },
  };
}
