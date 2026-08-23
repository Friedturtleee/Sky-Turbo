import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AhHistorySummary,
  AhImportedHistoryRecord,
} from "../packages/core/src/index";
import { retryAfterMilliseconds, SpacedRateLimiter } from "./coflnet-backfill-lib";
import { isAuctionItemFlag, normalizeAhAnalysis } from "./coflnet-ah-history-lib";

const rootEnv = loadEnv({ path: ".env", quiet: true }).parsed;
loadEnv({ path: ".env.local", override: true, quiet: true });
if (process.env.INGEST_SECRET?.trim() === "[SENSITIVE]" && rootEnv?.INGEST_SECRET?.trim()) {
  process.env.INGEST_SECRET = rootEnv.INGEST_SECRET;
}

const ITEMS_URL = "https://sky.coflnet.com/api/items";
const ANALYSIS_URL = "https://sky.coflnet.com/api/item/price";
const PRODUCT_PATH = "/v1/internal/ah-history-import/";
const META_PATH = "/v1/internal/ah-history-import-meta/";

type Options = { dryRun: boolean; refresh: boolean; limit?: number; productId?: string };
type EdgeStorage = { baseUrl: string; secret: string };
type ItemMetadata = { tag?: unknown; flags?: unknown };

function parseOptions(args: string[]): Options {
  const options: Options = { dryRun: false, refresh: false };
  for (const argument of args) {
    if (argument === "--") continue;
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--refresh") options.refresh = true;
    else if (argument.startsWith("--limit=")) options.limit = Number(argument.slice(8));
    else if (argument.startsWith("--product=")) options.productId = argument.slice(10).trim().toUpperCase();
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

function createStorage(): EdgeStorage {
  const baseUrl = process.env.NEXT_PUBLIC_EDGE_API_URL?.trim().replace(/\/$/, "");
  const secretFile = process.env.INGEST_SECRET_FILE?.trim();
  const secret = secretFile ? readFileSync(resolve(secretFile), "utf8").trim() : process.env.INGEST_SECRET?.trim();
  if (!baseUrl || !secret) throw new Error("Configure NEXT_PUBLIC_EDGE_API_URL and INGEST_SECRET together");
  return { baseUrl, secret };
}

async function storageJson<T>(storage: EdgeStorage | null, path: string): Promise<T | null> {
  if (!storage) return null;
  const response = await fetch(`${storage.baseUrl}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${storage.secret}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`D1 Worker read failed (${response.status}) for ${path}`);
  return await response.json() as T;
}

async function putStorage(storage: EdgeStorage, path: string, value: unknown): Promise<void> {
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

async function fetchItems(headers: HeadersInit): Promise<string[]> {
  const response = await fetch(ITEMS_URL, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`SkyCofl item list returned ${response.status}`);
  const payload = await response.json() as ItemMetadata[];
  return [...new Set(payload.flatMap((item) =>
    typeof item.tag === "string" && /^[A-Z0-9_:.-]{1,128}$/.test(item.tag) && isAuctionItemFlag(item.flags)
      ? [item.tag]
      : [],
  ))].sort();
}

async function fetchAnalysis(
  productId: string,
  limiter: SpacedRateLimiter,
  headers: HeadersInit,
): Promise<AhImportedHistoryRecord> {
  const url = `${ANALYSIS_URL}/${encodeURIComponent(productId)}/analysis?days=7`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await limiter.wait();
    const fetchedAt = Date.now();
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (response.status === 400 || response.status === 404) {
        return { schemaVersion: 1, provider: "skycofl", productId, fetchedAt, status: "unavailable" };
      }
      if (response.status === 401 || response.status === 403) throw new Error(`SkyCofl authorization failed (${response.status})`);
      if (response.ok) {
        const stats = normalizeAhAnalysis(productId, fetchedAt, await response.json());
        return stats
          ? { schemaVersion: 1, provider: "skycofl", productId, fetchedAt, status: "ok", stats }
          : { schemaVersion: 1, provider: "skycofl", productId, fetchedAt, status: "unavailable" };
      }
      if (attempt === 5 || (response.status !== 429 && response.status < 500)) {
        throw new Error(`SkyCofl AH analysis failed (${response.status}) for ${productId}`);
      }
      const delay = retryAfterMilliseconds(response.headers.get("retry-after")) ?? Math.min(30_000, 1_000 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delay + 250));
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** attempt)));
    }
  }
  throw new Error("Unreachable SkyCofl retry state");
}

function validRecord(value: AhImportedHistoryRecord | null, productId: string): AhImportedHistoryRecord | null {
  return value?.schemaVersion === 1 && value.provider === "skycofl" && value.productId === productId ? value : null;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (process.env.COFLNET_USAGE_APPROVED !== "true") {
    throw new Error("Set COFLNET_USAGE_APPROVED=true only after SkyCofl has approved this app's storage/use of its data");
  }
  const contact = requiredEnv("COFLNET_CONTACT");
  const requestsPerMinute = Number(process.env.COFLNET_REQUESTS_PER_MINUTE ?? "90");
  const limiter = new SpacedRateLimiter(requestsPerMinute);
  const token = process.env.COFLNET_API_TOKEN?.trim();
  const headers: HeadersInit = {
    Accept: "application/json",
    "User-Agent": `Sky-Turbo/0.1 AH-history (${contact})`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const storage = options.dryRun ? null : createStorage();
  const discovered = await fetchItems(headers);
  let products = options.productId ? discovered.filter((id) => id === options.productId) : discovered;
  if (options.productId && products.length === 0) throw new Error(`Unknown AH product: ${options.productId}`);
  if (options.limit !== undefined) products = products.slice(0, options.limit);
  console.log(`SkyCofl AH backfill: ${products.length}/${discovered.length} products at ${requestsPerMinute} req/min`);
  console.log(options.dryRun ? "Dry run: D1 writes disabled" : `D1 Worker target: ${storage?.baseUrl}`);

  const startedAt = Date.now();
  const existingSummary = await storageJson<AhHistorySummary>(storage, `${META_PATH}summary`);
  const summary: AhHistorySummary = existingSummary?.schemaVersion === 1 && existingSummary.provider === "skycofl"
    ? existingSummary
    : { schemaVersion: 1, provider: "skycofl", generatedAt: startedAt, items: {} };
  const stats = { requested: 0, skipped: 0, unavailable: 0, failed: 0, written: 0 };

  for (let index = 0; index < products.length; index += 1) {
    const productId = products[index]!;
    const path = `${PRODUCT_PATH}${encodeURIComponent(productId)}`;
    const existing = validRecord(await storageJson<AhImportedHistoryRecord>(storage, path), productId);
    let record = existing;
    if (existing && !options.refresh) {
      stats.skipped += 1;
    } else {
      try {
        record = await fetchAnalysis(productId, limiter, headers);
        stats.requested += 1;
        if (record.status === "unavailable") stats.unavailable += 1;
        if (!options.dryRun) {
          await putStorage(storage!, path, record);
          stats.written += 1;
        }
      } catch (error) {
        stats.failed += 1;
        console.error(`[${productId}] ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (record?.stats) summary.items[productId] = record.stats;
    else if (record?.status === "unavailable") delete summary.items[productId];

    const position = index + 1;
    if (position % 25 === 0 || position === products.length) {
      summary.generatedAt = Date.now();
      if (!options.dryRun) await putStorage(storage!, `${META_PATH}summary`, summary);
      console.log(`[${position}/${products.length}] requested=${stats.requested} skipped=${stats.skipped} unavailable=${stats.unavailable} failed=${stats.failed}`);
    }
  }

  const finishedAt = Date.now();
  if (!options.dryRun) await putStorage(storage!, `${META_PATH}manifest`, {
    schemaVersion: 1,
    provider: "skycofl",
    source: ANALYSIS_URL,
    startedAt,
    finishedAt,
    discoveredProducts: discovered.length,
    selectedProducts: products.length,
    requestsPerMinute,
    options,
    stats,
  });
  console.log(`Finished in ${((finishedAt - startedAt) / 60_000).toFixed(1)} minutes: ${JSON.stringify(stats)}`);
  if (stats.failed > 0) process.exitCode = 2;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
