import { jsonError, jsonOk } from "@/lib/http";
import { getAhFlipSnapshot } from "@/lib/ah-market";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const snapshot = await getAhFlipSnapshot(url.searchParams.get("refresh") === "1");
    return jsonOk({
      ...snapshot,
      refreshIntervalMs: 10_000,
      refreshModel: "10 秒檢查 page 0；lastUpdated 改變後才抓取完整一致快照",
    });
  } catch (error) {
    return jsonError("無法取得 AH Flip 行情", 502, error instanceof Error ? error.message : undefined);
  }
}
