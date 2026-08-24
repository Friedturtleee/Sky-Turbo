import {
  BAZAAR_TAX_RATE,
  calculateMarketSnapshot,
  type HypixelBazaarResponse,
  type MarketSnapshot,
  type NpcMayorContext,
} from "@sky-turbo/core";

const BAZAAR_URL = "https://api.hypixel.net/v2/skyblock/bazaar";
const ELECTION_URL = "https://api.hypixel.net/v2/resources/skyblock/election";
const MAYOR_CACHE_TTL_MS = 20_000;

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
  const [bazaar, mayor] = await Promise.all([getBazaarResponse(), getNpcMayorContext()]);
  return calculateMarketSnapshot(bazaar, BAZAAR_TAX_RATE * mayor.bazaarTaxMultiplier);
}

type MayorCacheEntry = { context: NpcMayorContext; fetchedAt: number };

let mayorCache: MayorCacheEntry | undefined;
let mayorRequest: Promise<NpcMayorContext> | undefined;

export async function getNpcMayorContext(): Promise<NpcMayorContext> {
  if (mayorCache && Date.now() - mayorCache.fetchedAt < MAYOR_CACHE_TTL_MS) return mayorCache.context;
  if (mayorRequest) return mayorRequest;
  mayorRequest = (async () => {
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
      const derpyActive = payload.mayor.name.trim().toLowerCase() === "derpy";
      const context: NpcMayorContext = {
        name: payload.mayor.name,
        lastUpdated: payload.lastUpdated ?? Date.now(),
        shoppingSpreeActive: mayorHasShoppingSpree || ministerHasShoppingSpree,
        derpyActive,
        bazaarTaxMultiplier: derpyActive ? 4 : 1,
        ...((mayorHasShoppingSpree || ministerHasShoppingSpree) ? {
          shoppingSpreeHolder: mayorHasShoppingSpree
            ? payload.mayor.name
            : payload.mayor.minister?.name ?? "Minister",
        } : {}),
      };
      mayorCache = { context, fetchedAt: Date.now() };
      return context;
    } catch {
      // Never apply Derpy's tax unless the Election API positively confirms it.
      const context: NpcMayorContext = {
        name: "Unknown", lastUpdated: Date.now(), shoppingSpreeActive: false, derpyActive: false, bazaarTaxMultiplier: 1,
      };
      mayorCache = { context, fetchedAt: Date.now() };
      return context;
    } finally {
      mayorRequest = undefined;
    }
  })();
  return mayorRequest;
}
