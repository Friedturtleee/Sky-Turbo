import { calculateMarketSnapshot, enrichWithHistory, type HypixelBazaarResponse, type MarketSnapshot, type PricePoint } from "@sky-turbo/core";
import { enrichMarketSummary, readLatestSnapshot, readProductHistory } from "./d1-store";
import { getLiveMarketSnapshot } from "./hypixel";

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  try {
    return await getLiveMarketSnapshot();
  } catch (error) {
    const stored = await readLatestSnapshot();
    if (stored) return stored;
    throw error;
  }
}

export async function getEnrichedMarketSnapshot(response?: HypixelBazaarResponse): Promise<MarketSnapshot> {
  return enrichMarketSummary(response ? calculateMarketSnapshot(response) : await getMarketSnapshot());
}

export async function getProduct(productId: string) {
  const snapshot = await getMarketSnapshot();
  const item = snapshot.items.find((candidate) => candidate.productId === productId);
  if (!item) return null;
  const [recent, longTerm] = await Promise.all([
    getHistory(productId, "1d", item.midpoint, item.updatedAt),
    getHistory(productId, "all", item.midpoint, item.updatedAt),
  ]);
  const history = [...new Map([...recent, ...longTerm].map((point) => [point.time, point])).values()];
  return enrichWithHistory(item, history);
}

export async function getHistory(
  productId: string,
  range: string,
  fallbackPrice?: number,
  fallbackTime?: number,
): Promise<PricePoint[]> {
  const points = await readProductHistory(productId, range);
  if (points.length > 0) return points;
  if (fallbackPrice && fallbackTime) return [{ time: fallbackTime, price: fallbackPrice }];
  const snapshot = await getMarketSnapshot();
  const item = snapshot.items.find((candidate) => candidate.productId === productId);
  return item ? [{ time: item.updatedAt, price: item.midpoint }] : [];
}
