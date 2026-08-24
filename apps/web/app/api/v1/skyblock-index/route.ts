import { calculateSkyblockIndex } from "@sky-turbo/core";
import { readDailyMarketHistory } from "@/lib/d1-store";
import { jsonError, jsonOk } from "@/lib/http";
import { getMarketSnapshot } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [snapshot, history] = await Promise.all([getMarketSnapshot(), readDailyMarketHistory()]);
    const index = calculateSkyblockIndex(snapshot, history);
    if (!index) return jsonError("Skyblock Index 歷史資料仍在累積中", 503);
    return jsonOk({ ...index, updatedAt: snapshot.updatedAt, taxRate: snapshot.taxRate });
  } catch (error) {
    return jsonError("無法計算 Skyblock Index", 502, error instanceof Error ? error.message : undefined);
  }
}
