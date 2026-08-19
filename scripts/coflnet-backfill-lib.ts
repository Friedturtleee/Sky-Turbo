import {
  compactPricePoint,
  type CompactPricePoint,
  type PricePoint,
} from "../packages/core/src/index";

export const COFLNET_RANGE_ENDPOINTS = {
  day: "history/day",
  week: "history/week",
  history: "history",
} as const;

export type CoflnetRangeKey = keyof typeof COFLNET_RANGE_ENDPOINTS;

type CoflnetRawPoint = {
  buy?: unknown;
  sell?: unknown;
  buyVolume?: unknown;
  sellVolume?: unknown;
  timestamp?: unknown;
};

function finiteNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function parseCoflnetTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  // SkyCofl emits UTC timestamps without an offset. Appending Z avoids parsing
  // them in the machine's local timezone (for example Asia/Taipei).
  const explicitOffset = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  const timestamp = Date.parse(explicitOffset ? value : `${value}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizeCoflnetPayload(payload: unknown): CompactPricePoint[] {
  if (!Array.isArray(payload)) throw new Error("SkyCofl history response is not an array");
  const points: PricePoint[] = [];
  for (const candidate of payload as CoflnetRawPoint[]) {
    const time = parseCoflnetTimestamp(candidate.timestamp);
    // SkyCofl's buy is the current sell offer (instant-buy price), while sell
    // is the current buy order (instant-sell price).
    const sellOrderPrice = finiteNumber(candidate.buy);
    const buyOrderPrice = finiteNumber(candidate.sell);
    if (time === null || sellOrderPrice <= 0 || buyOrderPrice <= 0) continue;
    points.push({
      time,
      price: (sellOrderPrice + buyOrderPrice) / 2,
      buyOrderPrice,
      sellOrderPrice,
      volume: finiteNumber(candidate.buyVolume) + finiteNumber(candidate.sellVolume),
      source: "coflnet",
    });
  }

  const unique = new Map<number, PricePoint>();
  for (const point of points.sort((a, b) => a.time - b.time)) unique.set(point.time, point);
  return [...unique.values()].map(compactPricePoint);
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export class SpacedRateLimiter {
  private lastStartedAt = Number.NEGATIVE_INFINITY;

  readonly intervalMs: number;

  constructor(readonly requestsPerMinute: number) {
    if (!Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 90) {
      throw new Error("COFLNET_REQUESTS_PER_MINUTE must be an integer from 1 to 90");
    }
    this.intervalMs = Math.ceil(60_000 / requestsPerMinute);
  }

  async wait(): Promise<void> {
    const delay = this.lastStartedAt + this.intervalMs - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastStartedAt = Date.now();
  }
}
