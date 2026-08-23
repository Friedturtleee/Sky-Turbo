import {
  calculateNpcFlips,
  npcBazaarQuotesFromResponse,
  type MarketSnapshot,
  type NpcShopData,
  type NpcStrategy,
} from "@sky-turbo/core";
import npcShopDataJson from "@sky-turbo/core/npc-shop-data";
import { jsonError, jsonOk } from "@/lib/http";
import { getAuctionSevenDaySales, getExactAuctionPrices, getRoughAuctionPrices } from "@/lib/lowest-bin";
import { getEnrichedMarketSnapshot } from "@/lib/market";
import { getBazaarResponse, getNpcMayorContext } from "@/lib/hypixel";

export const dynamic = "force-dynamic";

const npcShopData = npcShopDataJson as NpcShopData;
const strategies = new Set<NpcStrategy>(["bo-so", "ib-so", "bo-is", "ib-is"]);
const exactAuctionTargets = [
  "CELESTE_BOOTS", "CELESTE_CHESTPLATE", "CELESTE_HELMET", "CELESTE_LEGGINGS", "CELESTE_WAND",
  "SERIOUSLY_DAMAGED_AXE", "DECENT_AXE",
  "CANOPY_HELMET", "CANOPY_CHESTPLATE", "CANOPY_LEGGINGS", "CANOPY_BOOTS",
  "VENATOR_GENESIS", "SILVA_DOMINUS",
  "SNORKELING_HELMET", "SNORKELING_CHESTPLATE", "SNORKELING_LEGGINGS", "SNORKELING_BOOTS",
  "SMALL_POCKET_BLACK_HOLE", "MEDIUM_POCKET_BLACK_HOLE",
] as const;

function exactPriceTargets(
  market: MarketSnapshot,
): Set<string> {
  const bazaarIds = new Set(market.items.map((item) => item.productId));
  return new Set(exactAuctionTargets.filter((productId) => !bazaarIds.has(productId)));
}

export async function GET(request: Request) {
  try {
    const strategy = (new URL(request.url).searchParams.get("strategy") ?? "bo-so") as NpcStrategy;
    if (!strategies.has(strategy)) return jsonError("不支援的 NPC Flip 交易策略", 400);
    const [bazaarResponse, roughAh, mayor] = await Promise.all([
      getBazaarResponse(),
      getRoughAuctionPrices(),
      getNpcMayorContext(),
    ]);
    const market = await getEnrichedMarketSnapshot(bazaarResponse);
    const exactAh = await getExactAuctionPrices(exactPriceTargets(market));
    const auctionPrices = Object.fromEntries(Object.entries(roughAh.prices).map(([productId, price]) => [
      productId,
      { lowestBin: price, recentMedian: price, model: "adjusted-estimate" as const },
    ]));
    Object.assign(auctionPrices, exactAh.prices);
    const calculated = calculateNpcFlips(
      npcShopData.offers,
      market,
      auctionPrices,
      npcBazaarQuotesFromResponse(bazaarResponse),
      strategy,
    );
    const sortedFlips = calculated.flips.sort((left, right) => right.profit - left.profit);
    const ahProductIds = sortedFlips.filter((flip) => flip.saleSource === "ah-lowest-bin").map((flip) => flip.productId);
    const activity = await getAuctionSevenDaySales([
      ...exactAuctionTargets,
      ...ahProductIds,
    ]);
    const flips = sortedFlips.map((flip) => flip.saleSource === "ah-lowest-bin" && activity.sales[flip.productId] !== undefined
      ? { ...flip, ahSalesLast7d: activity.sales[flip.productId] }
      : flip);
    return jsonOk({
      flips,
      mayor,
      unpricedCount: calculated.unpricedCount,
      updatedAt: Math.max(market.updatedAt, exactAh.fetchedAt, activity.fetchedAt, mayor.lastUpdated),
      marketUpdatedAt: market.updatedAt,
      auctionUpdatedAt: exactAh.fetchedAt,
      shopDataGeneratedAt: npcShopData.generatedAt,
      priceModel: `${strategy.toUpperCase()}；每日上限自動套用 ${mayor.shoppingSpreeActive ? `${mayor.shoppingSpreeHolder ?? "Diaz"} Shopping Spree ×10` : `現任市長 ${mayor.name}（×1）`}`,
    });
  } catch (error) {
    return jsonError(
      "無法取得 NPC Flip 行情",
      502,
      error instanceof Error ? error.message : undefined,
    );
  }
}
