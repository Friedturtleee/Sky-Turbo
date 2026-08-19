import { jsonError, jsonOk } from "@/lib/http";
import { getBazaarResponse } from "@/lib/hypixel";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await context.params;
    const response = await getBazaarResponse();
    const product = response.products[productId];
    if (!product) return jsonError("找不到此物品", 404);
    return jsonOk({
      productId,
      updatedAt: response.lastUpdated,
      buyOrders: product.sell_summary,
      sellOffers: product.buy_summary,
      partial: product.sell_summary.length >= 30 || product.buy_summary.length >= 30,
    });
  } catch (error) {
    return jsonError("無法取得即時掛單", 502, error instanceof Error ? error.message : undefined);
  }
}
