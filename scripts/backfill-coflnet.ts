import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  importedPointsForRange,
  mergePriceHistory,
  type ImportedHistoryRange,
  type ImportedHistoryRangeKey,
  type ImportedHistorySummary,
  type ImportedProductHistory,
} from "../packages/core/src/index";
import {
  COFLNET_RANGE_ENDPOINTS,
  normalizeCoflnetPayload,
  retryAfterMilliseconds,
  SpacedRateLimiter,
  type CoflnetRangeKey,
} from "./coflnet-backfill-lib";

const rootEnv = loadEnv({ path: ".env", quiet: true }).parsed;
loadEnv({ path: ".env.local", override: true, quiet: true });

// `vercel env pull` cannot export sensitive values and writes this placeholder.
// Do not let it replace the usable local secret from the repository root.
if (process.env.INGEST_SECRET?.trim() === "[SENSITIVE]" && rootEnv?.INGEST_SECRET?.trim()) {
  process.env.INGEST_SECRET = rootEnv.INGEST_SECRET;
}

const HYPIXEL_BAZAAR_URL = "https://api.hypixel.net/v2/skyblock/bazaar";
const COFLNET_BASE_URL = "https://sky.coflnet.com/api/bazaar";
const PRODUCT_PATH = "/v1/internal/history-import/";
const META_PATH = "/v1/internal/history-import-meta/";
const REQUIRED_RANGES = Object.keys(COFLNET_RANGE_ENDPOINTS) as CoflnetRangeKey[];
const DAY_MS = 86_400_000;

type Options = {
  dryRun: boolean;
  refresh: boolean;
  limit?: number;
  productId?: string;
};

type BackfillStats = {
  requests: number;
  retries: number;
  fetchedRanges: number;
  skippedRanges: number;
  unavailableRanges: number;
  failedRanges: number;
  writtenProducts: number;
};

type EdgeStorage = {
  baseUrl: string;
  secret: string;
};

class FatalApiError extends Error {}

function parseOptions(args: string[]): Options {
  const options: Options = { dryRun: false, refresh: false };
  for (const argument of args) {
    if (argument === "--") continue;
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--refresh") options.refresh = true;
    else if (argument.startsWith("--limit=")) options.limit = Number(argument.slice(8));
    else if (argument.startsWith("--product=")) options.productId = argument.slice(10).toUpperCase();
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  return options;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function createEdgeStorage(): EdgeStorage {
  const baseUrl = process.env.NEXT_PUBLIC_EDGE_API_URL?.trim().replace(/\/$/, "");
  const secretFile = process.env.INGEST_SECRET_FILE?.trim();
  const secret = secretFile
    ? readFileSync(resolve(secretFile), "utf8").trim()
    : process.env.INGEST_SECRET?.trim();
  if (baseUrl && secret) return { baseUrl, secret };
  throw new Error("Configure NEXT_PUBLIC_EDGE_API_URL and INGEST_SECRET together");
}

function productPath(productId: string): string {
  return `${PRODUCT_PATH}${encodeURIComponent(productId)}`;
}

async function readJson<T>(storage: EdgeStorage | null, path: string): Promise<T | null> {
  if (!storage) return null;
  const response = await fetch(`${storage.baseUrl}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${storage.secret}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`D1 Worker read failed (${response.status}) for ${path}`);
  return await response.json() as T;
}

async function putJson(storage: EdgeStorage, path: string, value: unknown): Promise<void> {
  const response = await fetch(`${storage.baseUrl}${path}`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${storage.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`D1 Worker write failed (${response.status}) for ${path}: ${await response.text()}`);
}

function validExisting(value: ImportedProductHistory | null, productId: string): ImportedProductHistory | null {
  return value?.schemaVersion === 1 && value.provider === "coflnet" && value.productId === productId
    ? value
    : null;
}

async function listBazaarProducts(userAgent: string): Promise<string[]> {
  const response = await fetch(HYPIXEL_BAZAAR_URL, {
    headers: { Accept: "application/json", "User-Agent": userAgent },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Hypixel Bazaar request failed (${response.status})`);
  const payload = await response.json() as { success?: boolean; products?: Record<string, unknown> };
  if (!payload.success || !payload.products) throw new Error("Hypixel Bazaar returned invalid product data");
  return Object.keys(payload.products).sort();
}

async function fetchRange(
  productId: string,
  range: CoflnetRangeKey,
  limiter: SpacedRateLimiter,
  headers: HeadersInit,
  stats: BackfillStats,
): Promise<ImportedHistoryRange> {
  const url = `${COFLNET_BASE_URL}/${encodeURIComponent(productId)}/${COFLNET_RANGE_ENDPOINTS[range]}`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await limiter.wait();
    stats.requests += 1;
    const requestLabel = `[request ${stats.requests}] ${productId}/${range} attempt=${attempt + 1}`;
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (response.status === 400 || response.status === 404) {
        console.log(`${requestLabel} NO_DATA HTTP ${response.status}`);
        return { fetchedAt: Date.now(), status: "unavailable", points: [] };
      }
      if (response.status === 401 || response.status === 403) {
        console.error(`${requestLabel} FAILED HTTP ${response.status}`);
        throw new FatalApiError(`SkyCofl authorization failed (${response.status}); check COFLNET_API_TOKEN and usage permission`);
      }
      if (response.ok) {
        const points = normalizeCoflnetPayload(await response.json());
        console.log(`${requestLabel} SUCCESS HTTP ${response.status} points=${points.length}`);
        return {
          fetchedAt: Date.now(),
          status: "ok",
          points,
        };
      }

      if (response.status !== 429 && response.status < 500) {
        console.error(`${requestLabel} FAILED HTTP ${response.status}`);
        throw new FatalApiError(`SkyCofl request failed (${response.status}) for ${productId}/${range}`);
      }
      if (attempt === 5) {
        console.error(`${requestLabel} FAILED HTTP ${response.status} retries_exhausted`);
        throw new Error(`SkyCofl request exhausted retries (${response.status})`);
      }
      stats.retries += 1;
      const retryAfter = retryAfterMilliseconds(response.headers.get("retry-after"));
      const delay = retryAfter ?? Math.min(30_000, 1_000 * (2 ** attempt));
      console.warn(`${requestLabel} RETRY HTTP ${response.status} wait=${delay + 250}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay + 250));
    } catch (error) {
      if (error instanceof FatalApiError || attempt === 5) throw error;
      stats.retries += 1;
      const delay = Math.min(30_000, 1_000 * (2 ** attempt));
      console.warn(`${requestLabel} RETRY network_error wait=${delay}ms error=${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable retry state");
}

function updateSummary(summary: ImportedHistorySummary, record: ImportedProductHistory, now: number): void {
  const daily = mergePriceHistory(
    [importedPointsForRange(record, "all")],
    DAY_MS,
    now - 31 * DAY_MS,
  );
  if (daily.length > 0) summary.items[record.productId] = daily.map((point) => [point.time, point.price]);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (process.env.COFLNET_USAGE_APPROVED !== "true") {
    throw new Error("Set COFLNET_USAGE_APPROVED=true only after SkyCofl has approved this app's storage/use of its data");
  }

  const contact = requiredEnv("COFLNET_CONTACT");
  const userAgent = `Sky-Turbo/0.1 historical-backfill (${contact})`;
  const requestsPerMinute = Number(process.env.COFLNET_REQUESTS_PER_MINUTE ?? "90");
  const limiter = new SpacedRateLimiter(requestsPerMinute);
  const storage = options.dryRun ? null : createEdgeStorage();
  const token = process.env.COFLNET_API_TOKEN?.trim();
  const headers: HeadersInit = {
    Accept: "application/json",
    "User-Agent": userAgent,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const discovered = await listBazaarProducts(userAgent);
  let products = options.productId ? discovered.filter((id) => id === options.productId) : discovered;
  if (options.productId && products.length === 0) throw new Error(`Unknown Bazaar product: ${options.productId}`);
  if (options.limit !== undefined) products = products.slice(0, options.limit);

  const maximumRequests = products.length * REQUIRED_RANGES.length;
  const theoreticalMinutes = maximumRequests / requestsPerMinute;
  console.log(`SkyCofl backfill: ${products.length}/${discovered.length} products, up to ${maximumRequests} requests`);
  console.log(`Rate: ${requestsPerMinute} req/min (${limiter.intervalMs} ms spacing), theoretical maximum ${theoreticalMinutes.toFixed(1)} minutes`);
  console.log(options.dryRun ? "Dry run: D1 writes are disabled" : `D1 Worker target: ${storage?.baseUrl}`);

  const startedAt = Date.now();
  const stats: BackfillStats = {
    requests: 0,
    retries: 0,
    fetchedRanges: 0,
    skippedRanges: 0,
    unavailableRanges: 0,
    failedRanges: 0,
    writtenProducts: 0,
  };
  console.log("Loading existing D1 import progress...");
  const priorSummary = await readJson<ImportedHistorySummary>(storage, `${META_PATH}summary`);
  const summary: ImportedHistorySummary = priorSummary?.schemaVersion === 1 && priorSummary.provider === "coflnet"
    ? priorSummary
    : { schemaVersion: 1, provider: "coflnet", generatedAt: startedAt, items: {} };

  for (let index = 0; index < products.length; index += 1) {
    const productId = products[index]!;
    const position = index + 1;
    const percent = ((position / products.length) * 100).toFixed(1);
    console.log(`[${position}/${products.length} ${percent}%] Processing ${productId}`);
    const existing = validExisting(
      await readJson<ImportedProductHistory>(storage, productPath(productId)),
      productId,
    );
    const record: ImportedProductHistory = existing ?? {
      schemaVersion: 1,
      provider: "coflnet",
      productId,
      fetchedAt: 0,
      ranges: {},
    };
    const missingRanges = options.refresh
      ? REQUIRED_RANGES
      : REQUIRED_RANGES.filter((range) => !record.ranges[range]);
    if (missingRanges.length === 0) {
      stats.skippedRanges += REQUIRED_RANGES.length;
      console.log(`[skip] ${productId} all history ranges already stored in D1`);
      continue;
    }
    let changed = false;

    for (const range of missingRanges) {
      try {
        const result = await fetchRange(productId, range, limiter, headers, stats);
        record.ranges[range as ImportedHistoryRangeKey] = result;
        record.fetchedAt = Math.max(record.fetchedAt, result.fetchedAt);
        stats.fetchedRanges += 1;
        if (result.status === "unavailable") stats.unavailableRanges += 1;
        changed = true;
      } catch (error) {
        if (error instanceof FatalApiError) throw error;
        stats.failedRanges += 1;
        console.error(`[${productId}/${range}] ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    updateSummary(summary, record, Date.now());
    if (changed && !options.dryRun) {
      await putJson(storage!, productPath(productId), record);
      stats.writtenProducts += 1;
    }
    const completed = position;
    if (completed === products.length || completed % 25 === 0) {
      if (!options.dryRun) {
        summary.generatedAt = Date.now();
        await putJson(storage!, `${META_PATH}summary`, summary);
      }
      console.log(`[${completed}/${products.length}] requests=${stats.requests}, fetched=${stats.fetchedRanges}, skipped=${stats.skippedRanges}, failed=${stats.failedRanges}`);
    }
  }

  const finishedAt = Date.now();
  summary.generatedAt = finishedAt;
  if (!options.dryRun) {
    await putJson(storage!, `${META_PATH}summary`, summary);
    await putJson(storage!, `${META_PATH}manifest`, {
      schemaVersion: 1,
      provider: "coflnet",
      source: COFLNET_BASE_URL,
      discoveredProducts: discovered.length,
      selectedProducts: products.length,
      requestsPerMinute,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      options,
      stats,
    });
  }
  console.log(`Finished in ${((finishedAt - startedAt) / 60_000).toFixed(1)} minutes: ${JSON.stringify(stats)}`);
  if (stats.failedRanges > 0) process.exitCode = 2;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
