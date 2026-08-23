const COFL_NEU_PRICES_URL = "https://sky.coflnet.com/api/prices/neu";
const COFL_BIN_URL = "https://sky.coflnet.com/api/item/price";
const PRICE_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 60_000;

type RoughCache = { fetchedAt: number; prices: Record<string, number> };
export type AuctionPriceQuote = {
  lowestBin: number;
  recentMedian?: number;
  recentVolume?: number;
  model?: "exact-lbin-and-median" | "adjusted-estimate";
};
type ExactCacheEntry = { fetchedAt: number; quote?: AuctionPriceQuote };

let roughCache: RoughCache | undefined;
let roughRequest: Promise<RoughCache> | undefined;
const exactCache = new Map<string, ExactCacheEntry>();

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "Sky-Turbo/0.1" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRoughAuctionPrices(): Promise<RoughCache> {
  const now = Date.now();
  if (roughCache && now - roughCache.fetchedAt < PRICE_TTL_MS) return roughCache;
  if (roughRequest) return roughRequest;

  roughRequest = (async () => {
    try {
      const response = await fetchWithTimeout(COFL_NEU_PRICES_URL, 10_000);
      if (!response.ok) throw new Error(`SkyCofl prices returned ${response.status}`);
      const payload = await response.json() as Record<string, unknown>;
      const prices = Object.fromEntries(Object.entries(payload).flatMap(([productId, value]) => {
        const price = Number(value);
        return Number.isFinite(price) && price > 0 ? [[productId, price]] : [];
      }));
      roughCache = { fetchedAt: Date.now(), prices };
      return roughCache;
    } catch (error) {
      if (roughCache) return roughCache;
      throw error;
    } finally {
      roughRequest = undefined;
    }
  })();
  return roughRequest;
}

async function fetchExactAuctionPrice(productId: string): Promise<void> {
  const previous = exactCache.get(productId);
  const ttl = previous?.quote === undefined ? FAILURE_TTL_MS : PRICE_TTL_MS;
  if (previous && Date.now() - previous.fetchedAt < ttl) return;

  try {
    const encodedId = encodeURIComponent(productId);
    let binResponse: Response | undefined;
    let historyResponse: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      [binResponse, historyResponse] = await Promise.all([
        fetchWithTimeout(`${COFL_BIN_URL}/${encodedId}/bin`, 7_000),
        fetchWithTimeout(`${COFL_BIN_URL}/${encodedId}`, 7_000),
      ]);
      if (binResponse.status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
    if (!binResponse || !historyResponse) throw new Error("SkyCofl did not return a response");
    if (!binResponse.ok) throw new Error(`SkyCofl lowest BIN returned ${binResponse.status}`);
    const binPayload = await binResponse.json() as { lowest?: unknown };
    const historyPayload = historyResponse.ok
      ? await historyResponse.json() as { median?: unknown; volume?: unknown }
      : undefined;
    const lowestBin = Number(binPayload.lowest);
    const recentMedian = Number(historyPayload?.median);
    const recentVolume = Number(historyPayload?.volume);
    exactCache.set(productId, {
      fetchedAt: Date.now(),
      ...(Number.isFinite(lowestBin) && lowestBin > 0 ? {
        quote: {
          lowestBin,
          model: "exact-lbin-and-median",
          ...(Number.isFinite(recentMedian) && recentMedian > 0 ? { recentMedian } : {}),
          ...(Number.isFinite(recentVolume) && recentVolume >= 0 ? { recentVolume } : {}),
        },
      } : {}),
    });
  } catch {
    exactCache.set(productId, previous?.quote === undefined
      ? { fetchedAt: Date.now() }
      : { ...previous, fetchedAt: previous.fetchedAt });
  }
}

export async function getExactAuctionPrices(productIds: Iterable<string>): Promise<{
  fetchedAt: number;
  prices: Record<string, AuctionPriceQuote>;
}> {
  const queue = [...new Set(productIds)];
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const productId = queue[cursor++];
      if (!productId) return;
      await fetchExactAuctionPrice(productId);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));

  const prices: Record<string, AuctionPriceQuote> = {};
  let fetchedAt = 0;
  for (const productId of queue) {
    const cached = exactCache.get(productId);
    if (cached?.quote !== undefined) prices[productId] = cached.quote;
    if (cached) fetchedAt = Math.max(fetchedAt, cached.fetchedAt);
  }
  return { fetchedAt, prices };
}
