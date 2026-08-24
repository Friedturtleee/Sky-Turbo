import fusionData from "@sky-turbo/core/fusion-data";
import {
  calculateMarketSnapshot,
  BAZAAR_TAX_RATE,
  calculateShardFlips,
  parseCompactNumber,
  type FusionData,
  type MarketFilterKey,
  type MarketFilters,
  type MinProfitThreshold,
  type ShardOrderBook,
  type ShardStrategy,
} from "@sky-turbo/core";
import { jsonError, jsonOk } from "@/lib/http";
import { enrichMarketSummary } from "@/lib/d1-store";
import { getBazaarResponse, getNpcMayorContext } from "@/lib/hypixel";

const strategies = new Set<ShardStrategy>(["bo-so", "ib-so", "bo-is", "ib-is"]);
const filterKeys: MarketFilterKey[] = ["sellVolume", "buyVolume", "totalVolume"];
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
    const english = search.get("locale") === "en";
    const strategy = (search.get("strategy") ?? "bo-so") as ShardStrategy;
    const crocodileLevel = Number(search.get("crocodileLevel") ?? "10");
    const minProfitMode = search.get("minProfitMode") ?? "percent";
    const minProfitValue = parseCompactNumber(
      search.get("minProfitValue") ?? search.get("minProfitPercent") ?? "0.1",
    );
    const minFlipProfitMode = search.get("minFlipProfitMode") ?? "percent";
    const minFlipProfitValue = parseCompactNumber(search.get("minFlipProfitValue") ?? "80");
    const maxFusions = parseCompactNumber(search.get("maxFusions"));
    if (!strategies.has(strategy)) return jsonError("不支援的交易策略", 400);
    if (!Number.isInteger(crocodileLevel) || crocodileLevel < 0 || crocodileLevel > 10) {
      return jsonError("Crocodile 等級必須為 0 到 10", 400);
    }
    if (minProfitMode !== "percent" && minProfitMode !== "coins") {
      return jsonError("Min Profit 單位必須為 % 或 coins", 400);
    }
    if (
      minProfitValue === undefined ||
      minProfitValue < 0 ||
      (minProfitMode === "percent" && minProfitValue > 100)
    ) {
      return jsonError(
        minProfitMode === "percent" ? "Min Profit 必須為 0% 到 100%" : "Min Profit 金額必須大於或等於 0",
        400,
      );
    }
    if (minFlipProfitMode !== "percent" && minFlipProfitMode !== "coins") {
      return jsonError("Min Flip Profit 單位必須為 % 或 coins", 400);
    }
    if (
      minFlipProfitValue === undefined ||
      minFlipProfitValue < 0 ||
      (minFlipProfitMode === "percent" && minFlipProfitValue > 100)
    ) {
      return jsonError(
        minFlipProfitMode === "percent"
          ? "Min Flip Profit 必須為最高單次 Flip Profit 的 0% 到 100%"
          : "Min Flip Profit 金額必須大於或等於 0",
        400,
      );
    }
    if (maxFusions !== undefined && (!Number.isInteger(maxFusions) || maxFusions < 0)) {
      return jsonError("Max Fusion 總次數必須為大於或等於 0 的整數", 400);
    }
    const minProfit: MinProfitThreshold = { mode: minProfitMode, value: minProfitValue };
    const minFlipProfit: MinProfitThreshold = { mode: minFlipProfitMode, value: minFlipProfitValue };
    const filters = parseFilters(search);
    const [bazaar, mayor] = await Promise.all([getBazaarResponse(), getNpcMayorContext()]);
    const snapshot = await enrichMarketSummary(calculateMarketSnapshot(
      bazaar,
      BAZAAR_TAX_RATE * mayor.bazaarTaxMultiplier,
    ));
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
      { marketFilters: filters, orderBooks, minProfit, minFlipProfit, maxFusions },
    );
    return jsonOk({
      updatedAt: snapshot.updatedAt,
      strategy,
      crocodileLevel,
      evMultiplier: 1 + crocodileLevel * 0.02,
      minProfit,
      minFlipProfit,
      maxFusions,
      filters,
      depthModel: english
        ? `Instant Buy / Sell consumes Hypixel's first 30 levels one by one. Buy / Sell Order uses the current best order price; depth estimates visible queued volume only. Bazaar tax: ${snapshot.taxRate * 100}%${mayor.derpyActive ? " (Derpy ×4)" : ""}.`
        : `Instant Buy / Sell 逐檔吃 Hypixel 前 30 檔；Buy / Sell Order 固定使用目前最佳掛單價，深度僅代表可見排隊量估算；Bazaar 稅 ${snapshot.taxRate * 100}%${mayor.derpyActive ? "（Derpy ×4）" : ""}。`,
      flips,
    });
  } catch (error) {
    return jsonError("Shard Flip 計算失敗", 502, error instanceof Error ? error.message : undefined);
  }
}
