import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AhFlipSnapshot, AhHistorySummary } from "../packages/core/src/index";
import { AhAuctionScanner } from "../packages/core/src/ah-server";

const rootEnv = loadEnv({ path: ".env", quiet: true }).parsed;
loadEnv({ path: ".env.local", override: true, quiet: true });
if (process.env.INGEST_SECRET?.trim() === "[SENSITIVE]" && rootEnv?.INGEST_SECRET?.trim()) {
  process.env.INGEST_SECRET = rootEnv.INGEST_SECRET;
}

type Options = {
  once: boolean;
  dryRun: boolean;
  verbose: boolean;
  skipExactNbt: boolean;
  intervalMs: number;
  maxPages?: number;
  candidateLimit?: number;
};

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseOptions(args: string[]): Options {
  const options: Options = { once: false, dryRun: false, verbose: false, skipExactNbt: false, intervalMs: 10_000 };
  for (const argument of args) {
    if (argument === "--") continue;
    if (argument === "--once") options.once = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--verbose") options.verbose = true;
    else if (argument === "--skip-exact-nbt") options.skipExactNbt = true;
    else if (argument.startsWith("--interval=")) options.intervalMs = positiveInteger(argument.slice(11), "--interval");
    else if (argument.startsWith("--max-pages=")) options.maxPages = positiveInteger(argument.slice(12), "--max-pages");
    else if (argument.startsWith("--candidates=")) options.candidateLimit = positiveInteger(argument.slice(13), "--candidates");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.intervalMs < 2_000) throw new Error("--interval must be at least 2000ms");
  return options;
}

function edgeConfiguration(): { baseUrl: string; secret: string } {
  const baseUrl = process.env.NEXT_PUBLIC_EDGE_API_URL?.trim().replace(/\/$/, "");
  const secretFile = process.env.INGEST_SECRET_FILE?.trim();
  const secret = secretFile ? readFileSync(resolve(secretFile), "utf8").trim() : process.env.INGEST_SECRET?.trim();
  if (!baseUrl || !secret) throw new Error("Configure NEXT_PUBLIC_EDGE_API_URL and INGEST_SECRET together");
  return { baseUrl, secret };
}

async function edgeJson<T>(baseUrl: string, secret: string, path: string): Promise<T | null> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`D1 Worker returned ${response.status} for ${path}`);
  return await response.json() as T;
}

async function publish(baseUrl: string, secret: string, snapshot: AhFlipSnapshot): Promise<void> {
  const response = await fetch(`${baseUrl}/v1/internal/ah-flips`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(snapshot),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`D1 Worker AH publish returned ${response.status}: ${await response.text()}`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options.skipExactNbt && process.env.COFLNET_USAGE_APPROVED !== "true") {
    throw new Error("Set COFLNET_USAGE_APPROVED=true before using SkyCofl NBT valuation");
  }
  const edge = options.dryRun ? null : edgeConfiguration();
  const scanner = new AhAuctionScanner();
  let stopped = false;
  let lastAuctionUpdatedAt = 0;
  let history: AhHistorySummary | null = null;
  let historyFetchedAt = 0;
  process.once("SIGINT", () => { stopped = true; });
  process.once("SIGTERM", () => { stopped = true; });

  console.log(`AH collector: ${options.intervalMs}ms checks${options.once ? ", single scan" : ""}${options.dryRun ? ", dry run" : ""}`);
  while (!stopped) {
    const cycleStartedAt = Date.now();
    try {
      if (edge && Date.now() - historyFetchedAt >= 5 * 60_000) {
        history = await edgeJson<AhHistorySummary>(edge.baseUrl, edge.secret, "/v1/internal/ah-history-import-meta/summary");
        historyFetchedAt = Date.now();
      }
      const latest = await scanner.latestUpdatedAt();
      if (latest !== lastAuctionUpdatedAt || options.once) {
        const snapshot = await scanner.scan({
          history,
          maxPages: options.maxPages,
          candidateLimit: options.candidateLimit,
          coflContact: process.env.COFLNET_CONTACT?.trim() || "Sky-Turbo",
          coflToken: process.env.COFLNET_API_TOKEN?.trim(),
          skipExactNbt: options.skipExactNbt,
        });
        if (edge) await publish(edge.baseUrl, edge.secret, snapshot);
        lastAuctionUpdatedAt = snapshot.auctionUpdatedAt;
        console.log(JSON.stringify({
          event: "ah_snapshot",
          auctionUpdatedAt: snapshot.auctionUpdatedAt,
          totalAuctions: snapshot.totalAuctions,
          parsedAuctions: snapshot.parsedAuctions,
          candidates: snapshot.candidateAuctions,
          exactNbt: snapshot.evaluatedAuctions,
          flips: snapshot.flips.length,
          partial: snapshot.partial,
          durationMs: Date.now() - cycleStartedAt,
        }));
        if (options.verbose) {
          console.table(snapshot.flips.slice(0, 20).map((flip) => ({
            item: flip.name,
            listing: Math.round(flip.listingPrice),
            estimatedValue: Math.round(flip.estimatedValue),
            fees: Math.round(flip.auctionFees),
            profit: Math.round(flip.profit),
            roi: `${flip.roiPercent.toFixed(1)}%`,
            risk: flip.riskLevel,
            source: flip.valuationSource,
            sales7d: flip.history?.totalSales ?? "pending",
          })));
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "ah_collector_error", message: error instanceof Error ? error.message : String(error) }));
      if (options.once) throw error;
    }
    if (options.once) break;
    const delay = Math.max(0, options.intervalMs - (Date.now() - cycleStartedAt));
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
