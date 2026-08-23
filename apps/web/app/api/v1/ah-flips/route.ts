import { jsonError, jsonOk } from "@/lib/http";
import { getAhFlipSnapshot } from "@/lib/ah-market";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("refresh") === "1";
    const snapshot = await getAhFlipSnapshot(force);
    const since = Number(url.searchParams.get("since"));
    if (!force && Number.isFinite(since) && since === snapshot.generatedAt) {
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
