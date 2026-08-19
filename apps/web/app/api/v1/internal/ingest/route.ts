import { createHash, timingSafeEqual } from "node:crypto";
import { jsonError, jsonOk } from "@/lib/http";
import { hasD1Storage, persistSnapshot } from "@/lib/d1-store";
import { getLiveMarketSnapshot } from "@/lib/hypixel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function secretMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export async function POST(request: Request) {
  const expected = process.env.INGEST_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secretMatches(provided, expected)) return jsonError("未授權", 401);

  try {
    const snapshot = await getLiveMarketSnapshot();
    const persisted = await persistSnapshot(snapshot);
    return jsonOk({ updatedAt: snapshot.updatedAt, itemCount: snapshot.items.length, persisted, storage: hasD1Storage() ? "d1" : "none" });
  } catch (error) {
    return jsonError("行情擷取失敗", 502, error instanceof Error ? error.message : undefined);
  }
}
