import type { AhHistoryStats } from "../packages/core/src/index";

type AnalysisPayload = {
  totalSales?: unknown;
  salesPerDay?: unknown;
  avgPrice?: unknown;
  medianPrice?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  avgSellTimeSeconds?: unknown;
  medianSellTimeSeconds?: unknown;
  binPercentage?: unknown;
  priceStdDev?: unknown;
  priceCoeffVariation?: unknown;
};

function finite(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function isAuctionItemFlag(flags: unknown): boolean {
  if (typeof flags === "string") return flags === "AUCTION";
  if (typeof flags === "number" && Number.isInteger(flags)) return (flags & 4) === 4;
  return false;
}

export function normalizeAhAnalysis(
  productId: string,
  fetchedAt: number,
  payload: unknown,
): AhHistoryStats | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const candidate = payload as AnalysisPayload;
  const totalSales = finite(candidate.totalSales);
  const medianPrice = finite(candidate.medianPrice);
  if (totalSales === undefined || totalSales < 0 || medianPrice === undefined || medianPrice <= 0) return null;
  return {
    productId,
    fetchedAt,
    days: 7,
    totalSales: Math.floor(totalSales),
    salesPerDay: Math.max(0, finite(candidate.salesPerDay) ?? totalSales / 7),
    averagePrice: Math.max(0, finite(candidate.avgPrice) ?? medianPrice),
    medianPrice,
    minimumPrice: Math.max(0, finite(candidate.minPrice) ?? medianPrice),
    maximumPrice: Math.max(0, finite(candidate.maxPrice) ?? medianPrice),
    averageSellTimeSeconds: Math.max(0, finite(candidate.avgSellTimeSeconds) ?? 0),
    medianSellTimeSeconds: Math.max(0, finite(candidate.medianSellTimeSeconds) ?? 0),
    binPercentage: Math.min(100, Math.max(0, finite(candidate.binPercentage) ?? 0)),
    priceStdDev: Math.max(0, finite(candidate.priceStdDev) ?? 0),
    priceCoefficientVariation: Math.max(0, finite(candidate.priceCoeffVariation) ?? 0),
  };
}
