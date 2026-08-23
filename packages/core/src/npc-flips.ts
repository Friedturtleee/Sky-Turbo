import {
  type AuctionPriceQuote,
  type MarketSnapshot,
  type HypixelBazaarResponse,
  type NpcBazaarQuote,
  type NpcFlip,
  type NpcFlipCost,
  type NpcProfitPlan,
  type NpcShopOffer,
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
      ...(isPositivePrice(instantSellPrice) ? { instantSellPrice } : {}),
      buyMovingWeek: Number.isFinite(product.quick_status.buyMovingWeek) ? product.quick_status.buyMovingWeek : 0,
      sellMovingWeek: Number.isFinite(product.quick_status.sellMovingWeek) ? product.quick_status.sellMovingWeek : 0,
    }];
  }));
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
  const maximumPurchases = Math.floor(effectiveDailyLimit / Math.max(flip.quantity, 1));
  const purchaseCount = fraction === 1
    ? maximumPurchases
    : Math.ceil(maximumPurchases * fraction);
  const revenuePerPurchase = flip.maxProfitStrategy === "sell-order"
    ? flip.bazaarSellOrderPriceNet ?? flip.salePriceNet
    : flip.salePriceNet;
  return {
    fraction,
    purchaseCount,
    outputQuantity: purchaseCount * flip.quantity,
    effectiveDailyLimit,
    totalCost: flip.totalCost * purchaseCount,
    revenueAfterTax: revenuePerPurchase * purchaseCount,
    totalProfit: flip.maxProfitPerPurchase * purchaseCount,
    profitStrategy: flip.maxProfitStrategy,
    diazApplied,
    conditionalBonusApplied,
    costs: flip.costs.map((cost) => ({
      kind: cost.kind,
      ...(cost.productId ? { productId: cost.productId } : {}),
      name: cost.name,
      amountPerPurchase: cost.amount,
      requiredAmount: cost.amount * purchaseCount,
      unitPrice: cost.unitPrice,
      totalPrice: cost.totalPrice * purchaseCount,
      priceSource: cost.priceSource,
    })),
  };
}

export function calculateNpcFlips(
  offers: NpcShopOffer[],
  market: MarketSnapshot,
  auctionPrices: Readonly<Record<string, AuctionPriceQuote>>,
  bazaarQuotes: Readonly<Record<string, NpcBazaarQuote>> = {},
): { flips: NpcFlip[]; unpricedCount: number } {
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
      const unitPrice = marketItem?.instantBuyPrice
        || bazaarQuote?.instantBuyPrice
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
        priceSource: marketItem || bazaarQuote?.instantBuyPrice ? "bazaar" : "ah-lowest-bin",
      });
    }

    const outputMarket = bazaar.get(offer.output.productId);
    const outputBazaarQuote = bazaarQuotes[offer.output.productId];
    const outputAuction = outputBazaarQuote ? undefined : auctionPrices[offer.output.productId];
    const outputLowestBin = outputAuction?.lowestBin;
    const instantSellUnitPrice = outputMarket?.instantSellPrice ?? outputBazaarQuote?.instantSellPrice;
    const sellOrderUnitPrice = outputMarket?.sellOrderPrice ?? outputBazaarQuote?.sellOrderPrice;
    const hasBazaarSale = isPositivePrice(instantSellUnitPrice) || isPositivePrice(sellOrderUnitPrice);
    if (!priced || (!hasBazaarSale && !isPositivePrice(outputLowestBin))) {
      unpricedCount += 1;
      continue;
    }

    const totalCost = costs.reduce((sum, cost) => sum + cost.totalPrice, 0);
    const saleSource = hasBazaarSale ? "bazaar" : "ah-lowest-bin";
    // A lone manipulated listing is not a realistic sale estimate. Preserve the
    // current LBIN for display, but cap AH proceeds at the recent sold median.
    const auctionUnitSalePrice = outputAuction?.recentMedian && outputAuction.recentMedian > 0
      ? Math.min(outputAuction.lowestBin, outputAuction.recentMedian)
      : outputAuction?.lowestBin;
    const salePriceGross = hasBazaarSale
      ? (instantSellUnitPrice ?? sellOrderUnitPrice ?? 0) * offer.output.amount
      : (auctionUnitSalePrice ?? 0) * offer.output.amount;
    const saleFeeRate = hasBazaarSale ? market.taxRate : auctionFeeRate(salePriceGross);
    const salePriceNet = salePriceGross * (1 - saleFeeRate);
    const profit = salePriceNet - totalCost;
    const bazaarSellOrderPriceGross = hasBazaarSale && sellOrderUnitPrice
      ? sellOrderUnitPrice * offer.output.amount
      : undefined;
    const bazaarSellOrderPriceNet = bazaarSellOrderPriceGross === undefined
      ? undefined
      : bazaarSellOrderPriceGross * (1 - market.taxRate);
    const bazaarSellOrderProfit = bazaarSellOrderPriceNet === undefined
      ? undefined
      : bazaarSellOrderPriceNet - totalCost;
    const instaSellAvailable = isPositivePrice(instantSellUnitPrice);
    const maxProfitStrategy: NpcFlip["maxProfitStrategy"] = hasBazaarSale
      ? !instaSellAvailable && bazaarSellOrderProfit !== undefined
        ? "sell-order"
        : bazaarSellOrderProfit !== undefined && bazaarSellOrderProfit > profit
        ? "sell-order"
        : "insta-sell"
      : "ah";
    const maxProfitPerPurchase = maxProfitStrategy === "sell-order"
      ? bazaarSellOrderProfit ?? profit
      : profit;
    const maxPurchases = offer.dailyLimit === undefined
      ? undefined
      : Math.floor(offer.dailyLimit / Math.max(offer.output.amount, 1));

    flips.push({
      offerId: offer.id,
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
      ...(hasBazaarSale ? {
        bazaarInstaSellAvailable: instaSellAvailable,
        bazaarSellOrderPriceGross,
        bazaarSellOrderPriceNet,
        bazaarSellOrderProfit,
        bazaarMatchedVolume7d: Math.min(
          outputMarket?.buyMovingWeek ?? outputBazaarQuote?.buyMovingWeek ?? 0,
          outputMarket?.sellMovingWeek ?? outputBazaarQuote?.sellMovingWeek ?? 0,
        ),
      } : {}),
      ...(!hasBazaarSale && outputAuction ? {
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
