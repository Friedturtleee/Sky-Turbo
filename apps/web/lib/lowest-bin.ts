const COFL_NEU_PRICES_URL = "https://sky.coflnet.com/api/prices/neu";
const COFL_BIN_URL = "https://sky.coflnet.com/api/item/price";
const PRICE_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 60_000;

type RoughCache = { fetchedAt: number; prices: Record<string, number> };
type ExactCacheEntry = { fetchedAt: number; price?: number };

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

async function fetchExactLowestBin(productId: string): Promise<void> {
  const previous = exactCache.get(productId);
  const ttl = previous?.price === undefined ? FAILURE_TTL_MS : PRICE_TTL_MS;
  if (previous && Date.now() - previous.fetchedAt < ttl) return;

  try {
    const response = await fetchWithTimeout(
      `${COFL_BIN_URL}/${encodeURIComponent(productId)}/bin`,
      7_000,
    );
    if (!response.ok) throw new Error(`SkyCofl lowest BIN returned ${response.status}`);
    const payload = await response.json() as { lowest?: unknown };
    const price = Number(payload.lowest);
    exactCache.set(productId, {
      fetchedAt: Date.now(),
      ...(Number.isFinite(price) && price > 0 ? { price } : {}),
    });
  } catch {
    exactCache.set(productId, previous?.price === undefined
      ? { fetchedAt: Date.now() }
      : { ...previous, fetchedAt: previous.fetchedAt });
  }
}

export async function getExactLowestBins(productIds: Iterable<string>): Promise<{
  fetchedAt: number;
  prices: Record<string, number>;
}> {
  const queue = [...new Set(productIds)];
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const productId = queue[cursor++];
      if (!productId) return;
      await fetchExactLowestBin(productId);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));

  const prices: Record<string, number> = {};
  let fetchedAt = 0;
  for (const productId of queue) {
    const cached = exactCache.get(productId);
    if (cached?.price !== undefined) prices[productId] = cached.price;
    if (cached) fetchedAt = Math.max(fetchedAt, cached.fetchedAt);
  }
  return { fetchedAt, prices };
}
