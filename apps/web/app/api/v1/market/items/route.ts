import { jsonError, jsonOk } from "@/lib/http";
import { getEnrichedMarketSnapshot } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonOk(await getEnrichedMarketSnapshot());
  } catch (error) {
    return jsonError("無法取得 Bazaar 行情", 502, error instanceof Error ? error.message : undefined);
  }
}
