import { BAZAAR_TAX_RATE, type MarketSnapshot, type NpcFlip, type NpcFlipCost, type NpcShopOffer } from "./types";

export const AUCTION_FEE_MODEL = "2% under 10m, 4% from 10m, 5% from 100m";

export function auctionFeeRate(price: number): number {
  if (price >= 100_000_000) return 0.05;
  if (price >= 10_000_000) return 0.04;
  return 0.02;
}

function isPositivePrice(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

export function calculateNpcFlips(
  offers: NpcShopOffer[],
  market: MarketSnapshot,
  lowestBins: Readonly<Record<string, number>>,
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
      const unitPrice = marketItem?.instantBuyPrice || lowestBins[cost.productId];
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
        priceSource: marketItem ? "bazaar" : "ah-lowest-bin",
      });
    }

    const outputMarket = bazaar.get(offer.output.productId);
    const outputLowestBin = lowestBins[offer.output.productId];
    if (!priced || (!outputMarket && !isPositivePrice(outputLowestBin))) {
      unpricedCount += 1;
      continue;
    }

    const totalCost = costs.reduce((sum, cost) => sum + cost.totalPrice, 0);
    const saleSource = outputMarket ? "bazaar" : "ah-lowest-bin";
    const salePriceGross = outputMarket
      ? outputMarket.instantSellPrice * offer.output.amount
      : (outputLowestBin ?? 0) * offer.output.amount;
    const saleFeeRate = outputMarket ? market.taxRate : auctionFeeRate(salePriceGross);
    const salePriceNet = salePriceGross * (1 - saleFeeRate);
    const profit = salePriceNet - totalCost;
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
      profit,
      marginPercent: totalCost > 0 ? profit / totalCost * 100 : 0,
      dailyLimit: offer.dailyLimit,
      maxPurchases,
      maxDailyProfit: maxPurchases === undefined ? undefined : profit * maxPurchases,
      requirement: offer.requirement,
      source: offer.source,
    });
  }

  return { flips, unpricedCount };
}
