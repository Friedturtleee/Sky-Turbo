import {
  type AuctionPriceQuote,
  type MarketSnapshot,
  type HypixelBazaarResponse,
  type NpcBazaarQuote,
  type NpcFlip,
  type NpcFlipCost,
  type NpcProfitPlan,
  type NpcShopOffer,
  type NpcStrategy,
  type OrderLevel,
} from "./types";

export const AUCTION_FEE_MODEL = "2% under 10m, 4% from 10m, 5% from 100m";

export function auctionFeeRate(price: number): number {
  if (price >= 100_000_000) return 0.05;
  if (price >= 10_000_000) return 0.04;
  return 0.02;
}

function isPositivePrice(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

export function npcBazaarQuotesFromResponse(
  response: HypixelBazaarResponse,
): Record<string, NpcBazaarQuote> {
  return Object.fromEntries(Object.values(response.products).map((product) => {
    const instantBuyPrice = product.buy_summary[0]?.pricePerUnit;
    const instantSellPrice = product.sell_summary[0]?.pricePerUnit;
    return [product.product_id, {
      productId: product.product_id,
      ...(isPositivePrice(instantBuyPrice) ? { instantBuyPrice, sellOrderPrice: instantBuyPrice } : {}),
      ...(isPositivePrice(instantSellPrice) ? { instantSellPrice, buyOrderPrice: instantSellPrice } : {}),
      instantBuyDepth: product.buy_summary,
      instantSellDepth: product.sell_summary,
      instantBuyDepthPartial: product.buy_summary.length >= 30,
      instantSellDepthPartial: product.sell_summary.length >= 30,
      buyMovingWeek: Number.isFinite(product.quick_status.buyMovingWeek) ? product.quick_status.buyMovingWeek : 0,
      sellMovingWeek: Number.isFinite(product.quick_status.sellMovingWeek) ? product.quick_status.sellMovingWeek : 0,
    }];
  }));
}

function levelAmount(levels: OrderLevel[]): number {
  return levels.reduce((sum, level) => sum + (level.amount > 0 ? level.amount : 0), 0);
}

function priceDepth(
  levels: OrderLevel[],
  requestedQuantity: number,
  bestPriceFirst: "ascending" | "descending",
): { total: number; average: number } | undefined {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) return undefined;
  const valid = levels
    .filter((level) => level.amount > 0 && level.pricePerUnit > 0)
    .sort((left, right) => bestPriceFirst === "ascending"
      ? left.pricePerUnit - right.pricePerUnit
      : right.pricePerUnit - left.pricePerUnit);
  if (levelAmount(valid) + 1e-6 < requestedQuantity) return undefined;
  let remaining = requestedQuantity;
  let total = 0;
  for (const level of valid) {
    if (remaining <= 1e-8) break;
    const amount = Math.min(remaining, level.amount);
    total += amount * level.pricePerUnit;
    remaining -= amount;
  }
  return remaining > 1e-6 ? undefined : { total, average: total / requestedQuantity };
}

type EvaluatedNpcPlan = {
  totalCost: number;
  revenueAfterTax: number;
  totalProfit: number;
  costTotals: number[];
};

function evaluateNpcPlan(flip: NpcFlip, purchaseCount: number): EvaluatedNpcPlan | undefined {
  if (!Number.isSafeInteger(purchaseCount) || purchaseCount < 1) return undefined;
  const costTotals: number[] = [];
  let totalCost = 0;
  for (const cost of flip.costs) {
    const requestedQuantity = cost.amount * purchaseCount;
    const priced = cost.executionDepth
      ? priceDepth(cost.executionDepth, requestedQuantity, "ascending")
      : { total: cost.totalPrice * purchaseCount };
    if (!priced) return undefined;
    costTotals.push(priced.total);
    totalCost += priced.total;
  }
  const requestedOutput = flip.quantity * purchaseCount;
  const grossRevenue = flip.bazaarExecutionDepth
    ? priceDepth(flip.bazaarExecutionDepth, requestedOutput, "descending")?.total
    : flip.salePriceGross * purchaseCount;
  if (grossRevenue === undefined) return undefined;
  const revenueAfterTax = flip.bazaarExecutionDepth
    ? grossRevenue * (1 - flip.saleFeeRate)
    : flip.salePriceNet * purchaseCount;
  return {
    totalCost,
    revenueAfterTax,
    totalProfit: revenueAfterTax - totalCost,
    costTotals,
  };
}

export function calculateNpcProfitPlan(
  flip: NpcFlip,
  options: {
    diazActive?: boolean;
    conditionalBonusActive?: boolean;
    fraction?: 1 | 0.8;
  } = {},
): NpcProfitPlan | null {
  if (flip.dailyLimit === undefined) return null;
  const fraction = options.fraction ?? 1;
  const conditionalBonusApplied = Boolean(
    options.conditionalBonusActive && flip.conditionalDailyLimitBonus,
  );
  const withConditionalBonus = flip.dailyLimit
    + (conditionalBonusApplied ? flip.conditionalDailyLimitBonus ?? 0 : 0);
  const diazApplied = Boolean(options.diazActive && flip.diazEligible);
  const effectiveDailyLimit = withConditionalBonus * (diazApplied ? 10 : 1);
  const stockPurchaseLimit = Math.floor(effectiveDailyLimit / Math.max(flip.quantity, 1));
  let executionPurchaseLimit = flip.saleSource === "ah-lowest-bin"
    ? Math.min(stockPurchaseLimit, 1)
    : stockPurchaseLimit;
  let limitedBy = flip.saleSource === "ah-lowest-bin" && stockPurchaseLimit > 1
    ? "AH 預設只估算 1 次購買"
    : "NPC 每日庫存";
  for (const cost of flip.costs) {
    if (!cost.executionDepth) continue;
    const limit = Math.floor(levelAmount(cost.executionDepth) / Math.max(cost.amount, 1));
    if (limit < executionPurchaseLimit) {
      executionPurchaseLimit = limit;
      limitedBy = `${cost.name} Instant Buy 可見深度`;
    }
  }
  if (flip.bazaarExecutionDepth) {
    const limit = Math.floor(levelAmount(flip.bazaarExecutionDepth) / Math.max(flip.quantity, 1));
    if (limit < executionPurchaseLimit) {
      executionPurchaseLimit = limit;
      limitedBy = `${flip.name} Instant Sell 可見深度`;
    }
  }
  if (executionPurchaseLimit < 1) return null;

  const profitAt = (count: number) => evaluateNpcPlan(flip, count)?.totalProfit
    ?? Number.NEGATIVE_INFINITY;
  let low = 1;
  let high = executionPurchaseLimit;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (profitAt(middle + 1) >= profitAt(middle)) low = middle + 1;
    else high = middle;
  }
  const maxProfitPurchaseCount = low;
  const maximum = evaluateNpcPlan(flip, maxProfitPurchaseCount);
  if (!maximum) return null;

  let purchaseCount = maxProfitPurchaseCount;
  if (fraction === 0.8 && maximum.totalProfit > 0) {
    const target = maximum.totalProfit * 0.8;
    low = 1;
    high = maxProfitPurchaseCount;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (profitAt(middle) >= target) high = middle;
      else low = middle + 1;
    }
    purchaseCount = low;
  }
  const evaluated = purchaseCount === maxProfitPurchaseCount
    ? maximum
    : evaluateNpcPlan(flip, purchaseCount);
  if (!evaluated) return null;
  const depthPartial = Boolean(
    flip.bazaarExecutionDepthPartial
    || flip.costs.some((cost) => cost.executionDepthPartial),
  );
  return {
    fraction,
    purchaseCount,
    outputQuantity: purchaseCount * flip.quantity,
    effectiveDailyLimit,
    stockPurchaseLimit,
    executionPurchaseLimit,
    maxProfitPurchaseCount,
    depthLimited: executionPurchaseLimit < stockPurchaseLimit,
    depthPartial,
    limitedBy,
    totalCost: evaluated.totalCost,
    revenueAfterTax: evaluated.revenueAfterTax,
    totalProfit: evaluated.totalProfit,
    profitStrategy: flip.maxProfitStrategy,
    diazApplied,
    conditionalBonusApplied,
    costs: flip.costs.map((cost, index) => ({
      kind: cost.kind,
      ...(cost.productId ? { productId: cost.productId } : {}),
      name: cost.name,
      amountPerPurchase: cost.amount,
      requiredAmount: cost.amount * purchaseCount,
      unitPrice: evaluated.costTotals[index]! / (cost.amount * purchaseCount),
      totalPrice: evaluated.costTotals[index]!,
      priceSource: cost.priceSource,
    })),
  };
}

export function calculateNpcFlips(
  offers: NpcShopOffer[],
  market: MarketSnapshot,
  auctionPrices: Readonly<Record<string, AuctionPriceQuote>>,
  bazaarQuotes: Readonly<Record<string, NpcBazaarQuote>> = {},
  strategy: NpcStrategy = "bo-so",
): { flips: NpcFlip[]; unpricedCount: number } {
  const inputUsesInstant = strategy.startsWith("ib");
  const outputUsesInstant = strategy.endsWith("is");
  const bazaar = new Map(market.items.map((item) => [item.productId, item]));
  const flips: NpcFlip[] = [];
  let unpricedCount = 0;

  for (const offer of offers) {
    const costs: NpcFlipCost[] = [];
    let priced = true;
    for (const cost of offer.costs) {
      if (cost.kind === "coins") {
        costs.push({
          kind: "coins",
          name: "Coins",
          amount: cost.amount,
          unitPrice: 1,
          totalPrice: cost.amount,
          priceSource: "coins",
        });
        continue;
      }

      const marketItem = bazaar.get(cost.productId);
      const bazaarQuote = bazaarQuotes[cost.productId];
      const bazaarUnitPrice = inputUsesInstant
        ? marketItem?.instantBuyPrice ?? bazaarQuote?.instantBuyPrice
        : marketItem?.buyOrderPrice ?? bazaarQuote?.buyOrderPrice;
      const unitPrice = bazaarUnitPrice
        || (bazaarQuote ? undefined : auctionPrices[cost.productId]?.lowestBin);
      if (!isPositivePrice(unitPrice)) {
        priced = false;
        break;
      }
      costs.push({
        kind: "item",
        productId: cost.productId,
        name: cost.name,
        amount: cost.amount,
        unitPrice,
        totalPrice: unitPrice * cost.amount,
        priceSource: marketItem || isPositivePrice(bazaarUnitPrice) ? "bazaar" : "ah-lowest-bin",
        ...(inputUsesInstant && (marketItem || isPositivePrice(bazaarUnitPrice)) && bazaarQuote?.instantBuyDepth ? {
          executionDepth: bazaarQuote.instantBuyDepth,
          executionDepthPartial: bazaarQuote.instantBuyDepthPartial,
        } : {}),
      });
    }

    const outputMarket = bazaar.get(offer.output.productId);
    const outputBazaarQuote = bazaarQuotes[offer.output.productId];
    const isBazaarOutput = Boolean(outputMarket || outputBazaarQuote);
    const outputAuction = isBazaarOutput ? undefined : auctionPrices[offer.output.productId];
    const outputLowestBin = outputAuction?.lowestBin;
    const instantSellUnitPrice = outputMarket?.instantSellPrice ?? outputBazaarQuote?.instantSellPrice;
    const sellOrderUnitPrice = outputMarket?.sellOrderPrice ?? outputBazaarQuote?.sellOrderPrice;
    const selectedBazaarUnitPrice = outputUsesInstant ? instantSellUnitPrice : sellOrderUnitPrice;
    if (!priced || (isBazaarOutput ? !isPositivePrice(selectedBazaarUnitPrice) : !isPositivePrice(outputLowestBin))) {
      unpricedCount += 1;
      continue;
    }

    const totalCost = costs.reduce((sum, cost) => sum + cost.totalPrice, 0);
    const saleSource = isBazaarOutput ? "bazaar" : "ah-lowest-bin";
    // A lone manipulated listing is not a realistic sale estimate. Preserve the
    // current LBIN for display, but cap AH proceeds at the recent sold median.
    const auctionUnitSalePrice = outputAuction?.recentMedian && outputAuction.recentMedian > 0
      ? Math.min(outputAuction.lowestBin, outputAuction.recentMedian)
      : outputAuction?.lowestBin;
    const salePriceGross = isBazaarOutput
      ? (selectedBazaarUnitPrice ?? 0) * offer.output.amount
      : (auctionUnitSalePrice ?? 0) * offer.output.amount;
    const saleFeeRate = isBazaarOutput ? market.taxRate : auctionFeeRate(salePriceGross);
    const salePriceNet = salePriceGross * (1 - saleFeeRate);
    const profit = salePriceNet - totalCost;
    const bazaarInstaSellPriceGross = isBazaarOutput && instantSellUnitPrice
      ? instantSellUnitPrice * offer.output.amount
      : undefined;
    const bazaarInstaSellPriceNet = bazaarInstaSellPriceGross === undefined
      ? undefined
      : bazaarInstaSellPriceGross * (1 - market.taxRate);
    const bazaarInstaSellProfit = bazaarInstaSellPriceNet === undefined
      ? undefined
      : bazaarInstaSellPriceNet - totalCost;
    const bazaarSellOrderPriceGross = isBazaarOutput && sellOrderUnitPrice
      ? sellOrderUnitPrice * offer.output.amount
      : undefined;
    const bazaarSellOrderPriceNet = bazaarSellOrderPriceGross === undefined
      ? undefined
      : bazaarSellOrderPriceGross * (1 - market.taxRate);
    const bazaarSellOrderProfit = bazaarSellOrderPriceNet === undefined
      ? undefined
      : bazaarSellOrderPriceNet - totalCost;
    const instaSellAvailable = isPositivePrice(instantSellUnitPrice);
    const maxProfitStrategy: NpcFlip["maxProfitStrategy"] = isBazaarOutput
      ? outputUsesInstant ? "insta-sell" : "sell-order"
      : "ah";
    const maxProfitPerPurchase = profit;
    const maxPurchases = offer.dailyLimit === undefined
      ? undefined
      : Math.floor(offer.dailyLimit / Math.max(offer.output.amount, 1));

    flips.push({
      offerId: offer.id,
      strategy,
      npc: offer.npc,
      productId: offer.output.productId,
      name: offer.output.name,
      quantity: offer.output.amount,
      costs,
      totalCost,
      saleSource,
      salePriceGross,
      salePriceNet,
      saleFeeRate,
      ...(isBazaarOutput ? {
        bazaarInstaSellAvailable: instaSellAvailable,
        bazaarInstaSellPriceGross,
        bazaarInstaSellPriceNet,
        bazaarInstaSellProfit,
        bazaarSellOrderPriceGross,
        bazaarSellOrderPriceNet,
        bazaarSellOrderProfit,
        ...(outputUsesInstant && outputBazaarQuote?.instantSellDepth ? {
          bazaarExecutionDepth: outputBazaarQuote.instantSellDepth,
          bazaarExecutionDepthPartial: outputBazaarQuote.instantSellDepthPartial,
        } : {}),
        bazaarMatchedVolume7d: Math.min(
          outputMarket?.buyMovingWeek ?? outputBazaarQuote?.buyMovingWeek ?? 0,
          outputMarket?.sellMovingWeek ?? outputBazaarQuote?.sellMovingWeek ?? 0,
        ),
      } : {}),
      ...(!isBazaarOutput && outputAuction ? {
        auctionLowestBin: outputAuction.lowestBin,
        auctionRecentMedian: outputAuction.recentMedian,
        auctionRecentVolume: outputAuction.recentVolume,
        auctionPriceCapped: auctionUnitSalePrice !== outputAuction.lowestBin,
        auctionPriceModel: outputAuction.model,
      } : {}),
      profit,
      marginPercent: totalCost > 0 ? profit / totalCost * 100 : 0,
      maxProfitPerPurchase,
      maxProfitStrategy,
      dailyLimit: offer.dailyLimit,
      dailyLimitSource: offer.dailyLimitSource,
      diazEligible: offer.dailyLimit !== undefined && offer.diazEligible !== false,
      conditionalDailyLimitBonus: offer.conditionalDailyLimitBonus,
      conditionalLimitRequirement: offer.conditionalLimitRequirement,
      maxPurchases,
      maxDailyProfit: maxPurchases === undefined ? undefined : maxProfitPerPurchase * maxPurchases,
      requirement: offer.requirement,
      source: offer.source,
    });
  }

  return { flips, unpricedCount };
}
