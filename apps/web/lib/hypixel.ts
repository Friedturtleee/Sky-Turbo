import {
  calculateMarketSnapshot,
  type HypixelBazaarResponse,
  type MarketSnapshot,
} from "@sky-turbo/core";

const BAZAAR_URL = "https://api.hypixel.net/v2/skyblock/bazaar";

export async function getBazaarResponse(): Promise<HypixelBazaarResponse> {
  const response = await fetch(BAZAAR_URL, {
    headers: { Accept: "application/json", "User-Agent": "Sky-Turbo/0.1" },
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Hypixel Bazaar request failed (${response.status})`);
  const payload = (await response.json()) as HypixelBazaarResponse;
  if (!payload.success) throw new Error("Hypixel Bazaar reported success=false");
  return payload;
}

export async function getLiveMarketSnapshot(): Promise<MarketSnapshot> {
  return calculateMarketSnapshot(await getBazaarResponse());
}

