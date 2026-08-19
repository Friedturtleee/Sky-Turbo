import { jsonError, jsonOk } from "@/lib/http";
import { getProduct } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await context.params;
    const item = await getProduct(productId);
    return item ? jsonOk(item) : jsonError("找不到此物品", 404);
  } catch (error) {
    return jsonError("無法取得物品資料", 502, error instanceof Error ? error.message : undefined);
  }
}
