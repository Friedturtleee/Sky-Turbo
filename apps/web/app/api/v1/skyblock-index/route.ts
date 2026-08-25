import { calculateSkyblockIndex } from "@sky-turbo/core";
import { readDailyMarketHistory, readSkyblockIndex } from "@/lib/d1-store";
import { jsonError, jsonOk, sharedCache } from "@/lib/http";
import { getMarketSnapshot } from "@/lib/market";

export const dynamic = "force-dynamic";

const ranges = new Set(["1d", "7d", "1mo"] as const);

export async function GET(request: Request) {
  try {
    const range = new URL(request.url).searchParams.get("range") ?? "7d";
    if (!ranges.has(range as "1d" | "7d" | "1mo")) return jsonError("不支援的 Index 範圍", 400);
    const stored = await readSkyblockIndex(range as "1d" | "7d" | "1mo");
    if (stored) return jsonOk(stored, { headers: sharedCache(60, 180) });
    // Local/no-D1 fallback retains a useful daily index without requiring a
    // massive history transfer from the Worker.
    const [snapshot, history] = await Promise.all([getMarketSnapshot(), readDailyMarketHistory()]);
    const index = calculateSkyblockIndex(snapshot, history);
    if (!index) return jsonError("Skyblock Index 歷史資料仍在累積中", 503);
    return jsonOk(
      { ...index, range: "1mo", resolutionMs: 86_400_000, updatedAt: snapshot.updatedAt, taxRate: snapshot.taxRate },
      { headers: sharedCache(60, 180) },
    );
  } catch (error) {
    return jsonError("無法計算 Skyblock Index", 502, error instanceof Error ? error.message : undefined);
  }
}
