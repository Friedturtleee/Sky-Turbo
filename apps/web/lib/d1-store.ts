import {
  compactMarketSnapshot,
  enrichWithHistory,
  historyRangeConfig,
  importedPointsForRange,
  mergePriceHistory,
  type CompactHistoryPartition,
  type ImportedHistorySummary,
  type ImportedProductHistory,
  type MarketSnapshot,
  type PricePoint,
} from "@sky-turbo/core";

const edgeUrl = process.env.NEXT_PUBLIC_EDGE_API_URL?.replace(/\/$/, "");
const ingestSecret = process.env.INGEST_SECRET;

export function hasD1Storage(): boolean {
  return Boolean(edgeUrl);
}

async function edgeFetch(path: string, init?: RequestInit, internal = false): Promise<Response | null> {
  if (!edgeUrl || (internal && !ingestSecret)) return null;
  const headers = new Headers(init?.headers);
  if (internal) headers.set("Authorization", `Bearer ${ingestSecret}`);
  return fetch(`${edgeUrl}${path}`, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(25_000),
  });
}

async function readOptionalJson<T>(path: string, internal = false): Promise<T | null> {
  try {
    const response = await edgeFetch(path, { cache: "no-store" }, internal);
    if (!response || response.status === 404) return null;
    if (!response.ok) throw new Error(`D1 Worker returned ${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    console.warn(`Optional D1 history could not be read: ${path}`, error);
    return null;
  }
}

export async function readLatestSnapshot(): Promise<MarketSnapshot | null> {
  return readOptionalJson<MarketSnapshot>("/v1/storage/latest");
}

export async function persistSnapshot(snapshot: MarketSnapshot): Promise<boolean> {
  const response = await edgeFetch(
    "/v1/internal/market-snapshot",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, compact: compactMarketSnapshot(snapshot) }),
    },
    true,
  );
  if (!response) return false;
  if (!response.ok) throw new Error(`D1 Worker snapshot write returned ${response.status}: ${await response.text()}`);
  return true;
}

async function readImportedProduct(productId: string): Promise<ImportedProductHistory | null> {
  const value = await readOptionalJson<ImportedProductHistory>(
    `/v1/internal/history-import/${encodeURIComponent(productId)}`,
    true,
  );
  return value?.schemaVersion === 1 && value.provider === "coflnet" && value.productId === productId
    ? value
    : null;
}

export async function readProductHistory(productId: string, range: string): Promise<PricePoint[]> {
  if (!edgeUrl) return [];
  const config = historyRangeConfig(range);
  const cutoff = Number.isFinite(config.duration) ? Date.now() - config.duration : 0;
  const normalizedRange = range === "1h" || range === "1d" || range === "1mo" ? range : "all";
  const [live, imported] = await Promise.all([
    readOptionalJson<PricePoint[]>(
      `/v1/storage/history-live/${encodeURIComponent(productId)}?range=${encodeURIComponent(normalizedRange)}`,
    ),
    readImportedProduct(productId),
  ]);
  const importedPoints = imported ? importedPointsForRange(imported, normalizedRange) : [];
  // Direct Hypixel snapshots take priority over imported data in the same display bucket.
  return mergePriceHistory([importedPoints, live ?? []], config.bucketMs, cutoff);
}

export async function enrichMarketSummary(snapshot: MarketSnapshot): Promise<MarketSnapshot> {
  if (!edgeUrl) return snapshot;
  const cutoff = Date.now() - 31 * 86_400_000;
  const [history, historyAt24h, importedSummary] = await Promise.all([
    readOptionalJson<CompactHistoryPartition[]>("/v1/storage/history-daily"),
    readOptionalJson<CompactHistoryPartition[]>("/v1/storage/history-24h"),
    readOptionalJson<ImportedHistorySummary>("/v1/internal/history-import-meta/summary", true),
  ]);
  const primaryByProduct = new Map<string, PricePoint[]>();
  for (const point of history ?? []) {
    for (const [productId, values] of Object.entries(point.items)) {
      const productHistory = primaryByProduct.get(productId) ?? [];
      productHistory.push({ time: point.updatedAt, price: values[0], source: "hypixel" });
      primaryByProduct.set(productId, productHistory);
    }
  }
  const exactDayAgoByProduct = new Map<string, PricePoint>();
  for (const point of historyAt24h ?? []) {
    for (const [productId, values] of Object.entries(point.items)) {
      exactDayAgoByProduct.set(productId, {
        time: point.updatedAt,
        price: values[0],
        buyOrderPrice: values[1],
        sellOrderPrice: values[2],
        volume: values[3],
        source: "hypixel",
      });
    }
  }

  const validImported =
    importedSummary?.schemaVersion === 1 && importedSummary.provider === "coflnet" ? importedSummary : null;
  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      const imported = (validImported?.items[item.productId] ?? []).map(([time, price]) => ({
        time,
        price,
        source: "coflnet" as const,
      }));
      const summarized = mergePriceHistory(
        [imported, primaryByProduct.get(item.productId) ?? []],
        86_400_000,
        cutoff,
      );
      const exactDayAgo = exactDayAgoByProduct.get(item.productId);
      return enrichWithHistory(item, exactDayAgo ? [...summarized, exactDayAgo] : summarized);
    }),
  };
}
