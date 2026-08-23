import {
  calculateMarketSnapshot,
  type HypixelBazaarResponse,
  type MarketSnapshot,
  type NpcMayorContext,
} from "@sky-turbo/core";

const BAZAAR_URL = "https://api.hypixel.net/v2/skyblock/bazaar";
const ELECTION_URL = "https://api.hypixel.net/v2/resources/skyblock/election";

type ElectionPerk = { name?: string };
type ElectionResponse = {
  success?: boolean;
  lastUpdated?: number;
  mayor?: {
    name?: string;
    perks?: ElectionPerk[];
    minister?: { name?: string; perk?: ElectionPerk };
  };
};

export async function getBazaarResponse(): Promise<HypixelBazaarResponse> {
  const response = await fetch(BAZAAR_URL, {
    headers: { Accept: "application/json", "User-Agent": "Sky-Turbo/0.1" },
    cache: "no-store",
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

export async function getNpcMayorContext(): Promise<NpcMayorContext> {
  try {
    const response = await fetch(ELECTION_URL, {
      headers: { Accept: "application/json", "User-Agent": "Sky-Turbo/0.1" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Hypixel election request failed (${response.status})`);
    const payload = await response.json() as ElectionResponse;
    if (!payload.success || !payload.mayor?.name) throw new Error("Hypixel election response was invalid");
    const mayorHasShoppingSpree = payload.mayor.perks?.some((perk) => perk.name === "Shopping Spree") ?? false;
    const ministerHasShoppingSpree = payload.mayor.minister?.perk?.name === "Shopping Spree";
    return {
      name: payload.mayor.name,
      lastUpdated: payload.lastUpdated ?? Date.now(),
      shoppingSpreeActive: mayorHasShoppingSpree || ministerHasShoppingSpree,
      ...((mayorHasShoppingSpree || ministerHasShoppingSpree) ? {
        shoppingSpreeHolder: mayorHasShoppingSpree
          ? payload.mayor.name
          : payload.mayor.minister?.name ?? "Minister",
      } : {}),
    };
  } catch {
    return { name: "Unknown", lastUpdated: Date.now(), shoppingSpreeActive: false };
  }
}
