import craftDataJson from "@sky-turbo/core/craft-data";
import {
  calculateCraftFlips,
  calculateMarketSnapshot,
  type CraftData,
  type CraftStrategy,
  type ShardOrderBook,
} from "@sky-turbo/core";
import { jsonError, jsonOk } from "@/lib/http";
import { getBazaarResponse } from "@/lib/hypixel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const craftData = craftDataJson as unknown as CraftData;
const strategies = new Set<CraftStrategy>(["bo-so", "ib-so", "bo-is", "ib-is"]);

export async function GET(request: Request) {
  try {
    const strategy = (new URL(request.url).searchParams.get("strategy") ?? "bo-so") as CraftStrategy;
    if (!strategies.has(strategy)) return jsonError("不支援的 Craft Flip 交易策略", 400);

    const bazaar = await getBazaarResponse();
    const snapshot = calculateMarketSnapshot(bazaar);
    const orderBooks = Object.fromEntries(Object.entries(bazaar.products).map(([productId, product]) => [
      productId,
      {
        buyOrders: product.sell_summary,
        sellOffers: product.buy_summary,
        partial: product.sell_summary.length >= 30 || product.buy_summary.length >= 30,
      } satisfies ShardOrderBook,
    ]));
    const calculated = calculateCraftFlips(
      craftData,
      snapshot.items,
      orderBooks,
      strategy,
      snapshot.taxRate,
    );
    return jsonOk({
      flips: calculated.flips.sort((left, right) => right.profit - left.profit),
      skippedCount: calculated.skippedCount,
      totalRecipes: craftData.recipes.length,
      updatedAt: snapshot.updatedAt,
      recipeGeneratedAt: craftData.generatedAt,
      recipeCommit: craftData.source.commit,
      strategy,
      priceModel: "Instant 逐檔使用 Hypixel 前 30 檔；Order 使用目前最佳掛單價；收入扣 1.125% Bazaar 稅。",
    });
  } catch (error) {
    return jsonError("Craft Flip 計算失敗", 502, error instanceof Error ? error.message : undefined);
  }
}
