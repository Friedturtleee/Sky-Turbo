import type { AhFlipSnapshot } from "@sky-turbo/core";
import { AhAuctionScanner, type AhScanOptions } from "@sky-turbo/core/ah-server";
import { persistAhFlipSnapshot, readAhHistorySummary, readLatestAhFlipSnapshot } from "./d1-store";

const CHECK_INTERVAL_MS = 10_000;
const scanner = new AhAuctionScanner();
let memorySnapshot: AhFlipSnapshot | null = null;
let lastCheckedAt = 0;
let activeRefresh: Promise<AhFlipSnapshot> | null = null;

function optionalPositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function scanOptions(bootstrap: boolean): AhScanOptions {
  const configuredMaxPages = optionalPositiveInteger(process.env.AH_SCAN_MAX_PAGES);
  const configuredCandidates = optionalPositiveInteger(process.env.AH_CANDIDATE_LIMIT);
  return {
    maxPages: bootstrap
      ? Math.min(configuredMaxPages ?? 2, optionalPositiveInteger(process.env.AH_BOOTSTRAP_MAX_PAGES) ?? 2)
      : configuredMaxPages,
    candidateLimit: bootstrap ? Math.min(configuredCandidates ?? 200, 200) : configuredCandidates,
    resultLimit: bootstrap ? 250 : optionalPositiveInteger(process.env.AH_RESULT_LIMIT),
    coflContact: process.env.COFLNET_CONTACT?.trim() || "Sky-Turbo",
    coflToken: process.env.COFLNET_API_TOKEN?.trim(),
    // The bootstrap scan exists to paint a useful first screen quickly. Exact
    // NBT valuation is added by the complete background scan on the next poll.
    skipExactNbt: bootstrap || process.env.COFLNET_USAGE_APPROVED !== "true",
  };
}

async function scanAndPersist(bootstrap = false): Promise<AhFlipSnapshot> {
  const history = await readAhHistorySummary();
  const snapshot = await scanner.scan({
    ...scanOptions(bootstrap),
    history,
  });
  memorySnapshot = snapshot;
  try {
    await persistAhFlipSnapshot(snapshot);
  } catch (error) {
    console.warn("AH Flip snapshot could not be persisted", error);
  }
  return snapshot;
}

export async function getAhFlipSnapshot(force = false): Promise<AhFlipSnapshot> {
  const now = Date.now();
  let loadedStoredSnapshot = false;
  if (!memorySnapshot) {
    const stored = await readLatestAhFlipSnapshot();
    // Empty snapshots are not useful cache entries: immediately rebuild them.
    if (stored && stored.flips.length > 0) {
      memorySnapshot = stored;
      loadedStoredSnapshot = true;
    }
  }
  if (!force && loadedStoredSnapshot && memorySnapshot) {
    lastCheckedAt = now;
    return memorySnapshot;
  }
  if (!force && memorySnapshot && now - lastCheckedAt < CHECK_INTERVAL_MS) return memorySnapshot;
  if (activeRefresh) return activeRefresh;

  activeRefresh = (async () => {
    lastCheckedAt = Date.now();
    try {
      if (!memorySnapshot) return await scanAndPersist(true);
      const latest = await scanner.latestUpdatedAt();
      // A forced refresh must rebuild the valuation even when Hypixel's auction
      // version did not change (history/price inputs may have changed). Also do
      // not let an accidentally persisted empty snapshot become permanent.
      if (!force && !memorySnapshot.partial && memorySnapshot.auctionUpdatedAt === latest && memorySnapshot.flips.length > 0) {
        return memorySnapshot;
      }
      return await scanAndPersist();
    } catch (error) {
      if (memorySnapshot) return memorySnapshot;
      throw error;
    } finally {
      activeRefresh = null;
    }
  })();
  return activeRefresh;
}
