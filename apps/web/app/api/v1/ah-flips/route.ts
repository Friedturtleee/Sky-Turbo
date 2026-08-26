import { jsonError, jsonOk } from "@/lib/http";
import { getAhFlipSnapshot } from "@/lib/ah-market";
import { getNpcMayorContext } from "@/lib/hypixel";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const mayor = await getNpcMayorContext();
    if (mayor.derpyActive) return jsonError("Derpy 當選期間拍賣場關閉，無法計算 AH Flip", 503);
    const url = new URL(request.url);
    // A public cache-bypass switch allowed callers to repeatedly trigger the
    // expensive full AH scan. Refreshes now follow the server-side cadence.
    const snapshot = await getAhFlipSnapshot(false);
    const since = Number(url.searchParams.get("since"));
    if (Number.isFinite(since) && since === snapshot.generatedAt) {
      return jsonOk({
        unchanged: true,
        generatedAt: snapshot.generatedAt,
        auctionUpdatedAt: snapshot.auctionUpdatedAt,
        refreshIntervalMs: 10_000,
        refreshModel: "10 秒檢查 page 0；行情未變時不重送完整 AH 清單",
      });
    }
    return jsonOk({
      ...snapshot,
      unchanged: false,
      refreshIntervalMs: 10_000,
      refreshModel: "10 秒檢查 page 0；lastUpdated 改變後才抓取完整一致快照",
    });
  } catch (error) {
    return jsonError("無法取得 AH Flip 行情", 502, error instanceof Error ? error.message : undefined);
  }
}
