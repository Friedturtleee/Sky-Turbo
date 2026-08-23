import { calculateNpcFlips, type MarketSnapshot, type NpcShopData } from "@sky-turbo/core";
import npcShopDataJson from "@sky-turbo/core/npc-shop-data";
import { jsonError, jsonOk } from "@/lib/http";
import { getExactAuctionPrices, getRoughAuctionPrices } from "@/lib/lowest-bin";
import { getEnrichedMarketSnapshot } from "@/lib/market";

export const dynamic = "force-dynamic";

const npcShopData = npcShopDataJson as NpcShopData;
function exactPriceTargets(
  market: MarketSnapshot,
): Set<string> {
  const bazaarIds = new Set(market.items.map((item) => item.productId));
  return new Set([
    "CELESTE_BOOTS", "CELESTE_CHESTPLATE", "CELESTE_HELMET", "CELESTE_LEGGINGS", "CELESTE_WAND",
  ].filter((productId) => !bazaarIds.has(productId)));
}

export async function GET() {
  try {
    const [market, roughAh] = await Promise.all([
      getEnrichedMarketSnapshot(),
      getRoughAuctionPrices(),
    ]);
    const exactAh = await getExactAuctionPrices(exactPriceTargets(market));
    const auctionPrices = Object.fromEntries(Object.entries(roughAh.prices).map(([productId, price]) => [
      productId,
      { lowestBin: price, recentMedian: price, model: "adjusted-estimate" as const },
    ]));
    Object.assign(auctionPrices, exactAh.prices);
    const calculated = calculateNpcFlips(npcShopData.offers, market, auctionPrices);
    return jsonOk({
      flips: calculated.flips.sort((left, right) => right.profit - left.profit),
      unpricedCount: calculated.unpricedCount,
      updatedAt: Math.max(market.updatedAt, exactAh.fetchedAt),
      marketUpdatedAt: market.updatedAt,
      auctionUpdatedAt: exactAh.fetchedAt,
      shopDataGeneratedAt: npcShopData.generatedAt,
      priceModel: "BZ insta sell / buy；AH 批次調整估價，Celeste 額外核對 LBIN 與近期成交",
    });
  } catch (error) {
    return jsonError(
      "無法取得 NPC Flip 行情",
      502,
      error instanceof Error ? error.message : undefined,
    );
  }
}
