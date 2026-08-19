import fusionData from "@sky-turbo/core/fusion-data";
import {
  calculateShardFlips,
  parseCompactNumber,
  type FusionData,
  type MarketFilterKey,
  type MarketFilters,
  type ShardOrderBook,
  type ShardStrategy,
} from "@sky-turbo/core";
import { jsonError, jsonOk } from "@/lib/http";
import { getBazaarResponse } from "@/lib/hypixel";
import { getEnrichedMarketSnapshot } from "@/lib/market";

const strategies = new Set<ShardStrategy>(["bo-so", "ib-so", "bo-is", "ib-is"]);
const filterKeys: MarketFilterKey[] = [
  "volatility", "sellVolume", "buyVolume", "totalVolume", "price", "coinsPerHour", "marginCoins", "marginPercent",
];
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseFilters(search: URLSearchParams): MarketFilters {
  return Object.fromEntries(
    filterKeys.flatMap((key) => {
      const minText = search.get(`${key}Min`);
      const maxText = search.get(`${key}Max`);
      const min = parseCompactNumber(minText);
      const max = parseCompactNumber(maxText);
      if (min === undefined && max === undefined) return [];
      return [[key, {
        ...(Number.isFinite(min) ? { min } : {}),
        ...(Number.isFinite(max) ? { max } : {}),
      }]];
    }),
  ) as MarketFilters;
}

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const strategy = (search.get("strategy") ?? "bo-so") as ShardStrategy;
    const crocodileLevel = Number(search.get("crocodileLevel") ?? "0");
    const minProfitPercent = parseCompactNumber(search.get("minProfitPercent") ?? "0.1");
    if (!strategies.has(strategy)) return jsonError("不支援的交易策略", 400);
    if (!Number.isInteger(crocodileLevel) || crocodileLevel < 0 || crocodileLevel > 10) {
      return jsonError("Crocodile 等級必須為 0 到 10", 400);
    }
    if (minProfitPercent === undefined || minProfitPercent < 0 || minProfitPercent > 100) {
      return jsonError("Min Profit 必須為 0% 到 100%", 400);
    }
    const filters = parseFilters(search);
    const [snapshot, bazaar] = await Promise.all([getEnrichedMarketSnapshot(), getBazaarResponse()]);
    const orderBooks = Object.fromEntries(
      Object.entries(bazaar.products).map(([productId, product]) => [
        productId,
        {
          buyOrders: product.sell_summary,
          sellOffers: product.buy_summary,
          partial: product.sell_summary.length >= 30 || product.buy_summary.length >= 30,
        } satisfies ShardOrderBook,
      ]),
    );
    const flips = calculateShardFlips(
      fusionData as unknown as FusionData,
      snapshot.items,
      strategy,
      crocodileLevel,
      undefined,
      { marketFilters: filters, orderBooks, minProfitPercent },
    );
    return jsonOk({
      updatedAt: snapshot.updatedAt,
      strategy,
      crocodileLevel,
      evMultiplier: 1 + crocodileLevel * 0.02,
      minProfitPercent,
      filters,
      depthModel: "依所選策略逐檔模擬 Hypixel 前 30 檔；掛單策略代表目前可見排隊深度估算，不保證成交。",
      flips,
    });
  } catch (error) {
    return jsonError("Shard Flip 計算失敗", 502, error instanceof Error ? error.message : undefined);
  }
}
