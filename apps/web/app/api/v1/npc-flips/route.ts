import { calculateNpcFlips, type MarketSnapshot, type NpcShopData } from "@sky-turbo/core";
import npcShopDataJson from "@sky-turbo/core/npc-shop-data";
import { jsonError, jsonOk } from "@/lib/http";
import { getAuctionSevenDaySales, getExactAuctionPrices, getRoughAuctionPrices } from "@/lib/lowest-bin";
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
    const sortedFlips = calculated.flips.sort((left, right) => right.profit - left.profit);
    const ahProductIds = sortedFlips.filter((flip) => flip.saleSource === "ah-lowest-bin").map((flip) => flip.productId);
    const activity = await getAuctionSevenDaySales([
      "CELESTE_BOOTS", "CELESTE_CHESTPLATE", "CELESTE_HELMET", "CELESTE_LEGGINGS", "CELESTE_WAND",
      ...ahProductIds,
    ]);
    const flips = sortedFlips.map((flip) => flip.saleSource === "ah-lowest-bin" && activity.sales[flip.productId] !== undefined
      ? { ...flip, ahSalesLast7d: activity.sales[flip.productId] }
      : flip);
    return jsonOk({
      flips,
      unpricedCount: calculated.unpricedCount,
      updatedAt: Math.max(market.updatedAt, exactAh.fetchedAt, activity.fetchedAt),
      marketUpdatedAt: market.updatedAt,
      auctionUpdatedAt: exactAh.fetchedAt,
      shopDataGeneratedAt: npcShopData.generatedAt,
      priceModel: "BZ insta sell / buy；AH 顯示近 7 天成交筆數，分批快取更新",
    });
  } catch (error) {
    return jsonError(
      "無法取得 NPC Flip 行情",
      502,
      error instanceof Error ? error.message : undefined,
    );
  }
}
