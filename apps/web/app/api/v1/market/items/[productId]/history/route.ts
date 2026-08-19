import { jsonError, jsonOk } from "@/lib/http";
import { getHistory } from "@/lib/market";

const ranges = new Set(["1h", "1d", "1mo", "all"]);
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await context.params;
    const requested = new URL(request.url).searchParams.get("range") ?? "1d";
    if (!ranges.has(requested)) return jsonError("不支援的時間範圍", 400);
    return jsonOk({ productId, range: requested, points: await getHistory(productId, requested) });
  } catch (error) {
    return jsonError("無法取得歷史資料", 502, error instanceof Error ? error.message : undefined);
  }
}
