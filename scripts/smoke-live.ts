import { readFile } from "node:fs/promises";
import {
  calculateMarketSnapshot,
  calculateShardFlips,
  type FusionData,
  type HypixelBazaarResponse,
  type ShardOrderBook,
} from "../packages/core/src/index";

async function main() {
  const response = await fetch("https://api.hypixel.net/v2/skyblock/bazaar", {
    headers: { Accept: "application/json", "User-Agent": "Sky-Turbo-Smoke-Test/0.1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Hypixel returned ${response.status}`);
  const bazaar = (await response.json()) as HypixelBazaarResponse;
  const snapshot = calculateMarketSnapshot(bazaar);
  if (snapshot.items.length < 100) throw new Error(`Only ${snapshot.items.length} market items were normalized`);

  const data = JSON.parse(
    await readFile(new URL("../packages/core/data/fusion-data.json", import.meta.url), "utf8"),
  ) as FusionData;
  const startedAt = performance.now();
  const orderBooks = Object.fromEntries(Object.entries(bazaar.products).map(([productId, product]) => [
    productId,
    {
      buyOrders: product.sell_summary,
      sellOffers: product.buy_summary,
      partial: product.sell_summary.length >= 30 || product.buy_summary.length >= 30,
    } satisfies ShardOrderBook,
  ]));
  const flips = calculateShardFlips(data, snapshot.items, "bo-so", 5, undefined, { orderBooks });
  const elapsed = Math.round(performance.now() - startedAt);
  if (flips.length === 0) throw new Error("No Shard flips were calculated from the live market");

  console.log(JSON.stringify({
    marketItems: snapshot.items.length,
    shardFlips: flips.length,
    calculationMs: elapsed,
    topShard: flips[0]?.name,
    topProfit: Math.round(flips[0]?.profit ?? 0),
    topDepthOutput: flips[0]?.depth.maxProfitableOutput ?? 0,
  }, null, 2));
}

void main();
