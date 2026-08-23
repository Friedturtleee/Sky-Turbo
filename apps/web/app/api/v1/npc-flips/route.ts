import { calculateNpcFlips, type MarketSnapshot, type NpcShopData, type NpcShopOffer } from "@sky-turbo/core";
import npcShopDataJson from "@sky-turbo/core/npc-shop-data";
import { jsonError, jsonOk } from "@/lib/http";
import { getExactLowestBins, getRoughAuctionPrices } from "@/lib/lowest-bin";
import { getEnrichedMarketSnapshot } from "@/lib/market";

export const dynamic = "force-dynamic";

const npcShopData = npcShopDataJson as NpcShopData;
const MIRIA_IDS = new Set([
  "EXTREMELY_MILD_ADHESIVE",
  "GIANT_SLOTH_CLAW",
  "LARGE_SLOTH_CLAW",
  "MEDIUM_SLOTH_CLAW",
  "MIRIA_COUPON",
  "MIRIA_PRIZE",
  "RUBBER_SNORKEL",
  "SHARD_VULTURE",
  "SHARD_WOODPECKER",
  "SMALL_SLOTH_CLAW",
  "TORRHUS_ARTIFACT",
  "TORRHUS_RING",
  "TORRHUS_TALISMAN",
  "VIAL_OF_SPRING_WATER",
  "WINDING_IVY",
]);

function roughOfferProfit(
  offer: NpcShopOffer,
  market: MarketSnapshot,
  roughAh: Readonly<Record<string, number>>,
): number | undefined {
  const bazaar = new Map(market.items.map((item) => [item.productId, item]));
  let cost = 0;
  for (const part of offer.costs) {
    if (part.kind === "coins") {
      cost += part.amount;
      continue;
    }
    const price = bazaar.get(part.productId)?.instantBuyPrice ?? roughAh[part.productId];
    if (!price) return undefined;
    cost += price * part.amount;
  }
  const outputPrice = bazaar.get(offer.output.productId)?.instantSellPrice
    ?? roughAh[offer.output.productId];
  return outputPrice ? outputPrice * offer.output.amount - cost : undefined;
}

function exactPriceTargets(
  market: MarketSnapshot,
  roughAh: Readonly<Record<string, number>>,
): Set<string> {
  const bazaarIds = new Set(market.items.map((item) => item.productId));
  const ranked = npcShopData.offers
    .map((offer) => ({ offer, roughProfit: roughOfferProfit(offer, market, roughAh) }))
    .filter((entry): entry is { offer: NpcShopOffer; roughProfit: number } => entry.roughProfit !== undefined)
    .sort((left, right) => right.roughProfit - left.roughProfit)
    .slice(0, 100);
  const targets = new Set<string>();
  for (const { offer } of ranked) {
    if (!bazaarIds.has(offer.output.productId)) targets.add(offer.output.productId);
    for (const cost of offer.costs) {
      if (cost.kind === "item" && !bazaarIds.has(cost.productId)) targets.add(cost.productId);
    }
  }
  for (const productId of MIRIA_IDS) {
    if (!bazaarIds.has(productId) && roughAh[productId]) targets.add(productId);
  }
  return targets;
}

export async function GET() {
  try {
    const [market, roughAh] = await Promise.all([
      getEnrichedMarketSnapshot(),
      getRoughAuctionPrices(),
    ]);
    const exactAh = await getExactLowestBins(exactPriceTargets(market, roughAh.prices));
    const calculated = calculateNpcFlips(npcShopData.offers, market, exactAh.prices);
    return jsonOk({
      flips: calculated.flips.sort((left, right) => right.profit - left.profit),
      unpricedCount: calculated.unpricedCount,
      updatedAt: Math.max(market.updatedAt, exactAh.fetchedAt),
      marketUpdatedAt: market.updatedAt,
      auctionUpdatedAt: exactAh.fetchedAt,
      shopDataGeneratedAt: npcShopData.generatedAt,
      priceModel: "Bazaar instant sell / instant buy；AH exact lowest BIN",
    });
  } catch (error) {
    return jsonError(
      "無法取得 NPC Flip 行情",
      502,
      error instanceof Error ? error.message : undefined,
    );
  }
}
