import type { AhFlipSnapshot } from "@sky-turbo/core";
import { AhAuctionScanner } from "@sky-turbo/core/ah-server";
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

async function scanAndPersist(): Promise<AhFlipSnapshot> {
  const history = await readAhHistorySummary();
  const snapshot = await scanner.scan({
    history,
    maxPages: optionalPositiveInteger(process.env.AH_SCAN_MAX_PAGES),
    candidateLimit: optionalPositiveInteger(process.env.AH_CANDIDATE_LIMIT),
    resultLimit: optionalPositiveInteger(process.env.AH_RESULT_LIMIT),
    coflContact: process.env.COFLNET_CONTACT?.trim() || "Sky-Turbo",
    coflToken: process.env.COFLNET_API_TOKEN?.trim(),
    skipExactNbt: process.env.COFLNET_USAGE_APPROVED !== "true",
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
  if (!memorySnapshot) memorySnapshot = await readLatestAhFlipSnapshot();
  if (!force && memorySnapshot && now - lastCheckedAt < CHECK_INTERVAL_MS) return memorySnapshot;
  if (activeRefresh) return activeRefresh;

  activeRefresh = (async () => {
    lastCheckedAt = Date.now();
    try {
      const latest = await scanner.latestUpdatedAt();
      if (memorySnapshot?.auctionUpdatedAt === latest) return memorySnapshot;
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
