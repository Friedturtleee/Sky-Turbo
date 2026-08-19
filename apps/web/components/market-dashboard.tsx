"use client";

import type { MarketItem, MarketSnapshot, PricePoint } from "@sky-turbo/core";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookmarkButton } from "./bookmarks";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { createEmptyMarketFilters, MarketFilterPanel, type MarketFilterDrafts } from "./market-filter-panel";
import { PriceChart } from "./price-chart";

type SortKey = "coinsPerHour" | "marginPercent" | "marginCoins" | "volatility";
function inRange(value: number, range: { min: string; max: string }): boolean {
  const min = range.min === "" ? -Infinity : Number(range.min);
  const max = range.max === "" ? Infinity : Number(range.max);
  return value >= min && value <= max;
}

function Featured({ item }: { item: MarketItem }) {
  const [points, setPoints] = useState<PricePoint[]>([]);
  useEffect(() => {
    setPoints([]);
    void fetch(`/api/v1/market/items/${encodeURIComponent(item.productId)}/history?range=1d`)
      .then((response) => response.json())
      .then((payload: { data?: { points?: PricePoint[] } }) => setPoints(payload.data?.points ?? []));
  }, [item.productId]);
  const chartPoints = points.length ? points : [{
    time: item.updatedAt,
    price: item.midpoint,
    buyOrderPrice: item.buyOrderPrice,
    sellOrderPrice: item.sellOrderPrice,
  }];
  return (
    <section className="featured-card panel">
      <div className="featured-copy">
        <span className="eyebrow">目前排序第一</span>
        <div className="item-heading"><ItemIcon name={item.name} productId={item.productId} /><div><h2>{item.name}</h2><code>{item.productId}</code></div></div>
        <div className="metric-row">
          <div><span>Buy Order</span><strong>{formatCoins(item.buyOrderPrice)}</strong></div>
          <div><span>Sell Order</span><strong>{formatCoins(item.sellOrderPrice)}</strong></div>
          <div><span>24h</span><strong className={tone(item.changes?.["1d"])}>{formatPercent(item.changes?.["1d"])}</strong></div>
          <div><span>7d Volume</span><strong>{formatCoins(item.weeklyVolume)}</strong></div>
        </div>
      </div>
      <div className="featured-chart"><PriceChart points={chartPoints} height={174} compact /></div>
    </section>
  );
}

export function MarketDashboard({ bookmarksOnly = false }: { bookmarksOnly?: boolean }) {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("coinsPerHour");
  const [filters, setFilters] = useState<MarketFilterDrafts>(createEmptyMarketFilters);
  const updateSearch = useCallback((value: string) => setSearch(value), []);
  const { bookmarks } = requireBookmarks();

  useEffect(() => {
    void fetch("/api/v1/market/items")
      .then(async (response) => {
        const payload = (await response.json()) as { data?: MarketSnapshot; error?: { message?: string } };
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "讀取失敗");
        setSnapshot(payload.data);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const items = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (snapshot?.items ?? [])
      .filter((item) => !bookmarksOnly || bookmarks.has(item.productId))
      .filter((item) => !query || item.name.toLowerCase().includes(query) || item.productId.toLowerCase().includes(query))
      .filter((item) => inRange(item.volatility?.["7d"] ?? 0, filters.volatility))
      .filter((item) => inRange(item.sellVolume, filters.sellVolume))
      .filter((item) => inRange(item.buyVolume, filters.buyVolume))
      .filter((item) => inRange(item.totalVolume, filters.totalVolume))
      .filter((item) => inRange(item.midpoint, filters.price))
      .filter((item) => inRange(item.coinsPerHour, filters.coinsPerHour))
      .filter((item) => inRange(item.marginCoins, filters.marginCoins))
      .filter((item) => inRange(item.marginPercent, filters.marginPercent))
      .sort((a, b) => {
        if (sort === "volatility") return (b.volatility?.["7d"] ?? 0) - (a.volatility?.["7d"] ?? 0);
        return b[sort] - a[sort];
      });
  }, [bookmarks, bookmarksOnly, filters, search, snapshot, sort]);

  if (error) return <div className="state-card error-state"><strong>行情暫時無法載入</strong><span>{error}</span></div>;
  if (!snapshot) return <div className="state-card"><span className="spinner" />正在同步 Hypixel Bazaar…</div>;

  return (
    <>
      <div className="toolbar panel">
        <DebouncedSearchField onSearch={updateSearch} placeholder="物品名稱或 ID" />
        <label><span>排序</span><select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="coinsPerHour">Coins per Hour</option><option value="marginPercent">Margin (%)</option>
          <option value="marginCoins">Margin ($)</option><option value="volatility">Volatility (7d)</option>
        </select></label>
        <MarketFilterPanel onApply={setFilters} />
      </div>
      {items[0] && !bookmarksOnly ? <Featured item={items[0]} /> : null}
      <div className="table-meta"><span>{items.length.toLocaleString()} 個物品</span><span>更新：{new Date(snapshot.updatedAt).toLocaleTimeString("zh-TW")}</span></div>
      <div className="market-table-wrap panel"><table className="market-table"><thead><tr>
        <th>物品</th><th>價格</th><th>Margin</th><th>CPH <span className="estimated">估算</span></th><th className="change-volume-heading">24h / Vol.</th><th>±5% 深度</th><th aria-label="書籤" />
      </tr></thead><tbody>{items.slice(0, 250).map((item) => <tr key={item.productId}>
        <td><Link className="item-cell" href={`/items/${encodeURIComponent(item.productId)}`}><ItemIcon name={item.name} productId={item.productId} /><span><strong>{item.name}</strong><code>{item.productId}</code></span></Link></td>
        <td><span className="stack"><strong>{formatCoins(item.midpoint)}</strong><small>{formatCoins(item.buyOrderPrice)} → {formatCoins(item.sellOrderPrice)}</small></span></td>
        <td><span className={`stack ${tone(item.marginCoins)}`}><strong>{formatCoins(item.marginCoins)}</strong><small>{formatPercent(item.marginPercent)}</small></span></td>
        <td className={tone(item.coinsPerHour)}>{formatCoins(item.coinsPerHour)}</td>
        <td><span className="stack change-volume"><strong className={tone(item.changes?.["1d"])}>{formatPercent(item.changes?.["1d"])}</strong><small>{item.volatility?.["7d"]?.toFixed(2) ?? "累積中"}%</small></span></td>
        <td><span className="stack"><strong>{formatCoins(item.depthWithinFivePercent.buyOrders.quantity)} / {formatCoins(item.depthWithinFivePercent.sellOffers.quantity)}</strong><small>{formatCoins(item.depthWithinFivePercent.buyOrders.notional)} / {formatCoins(item.depthWithinFivePercent.sellOffers.notional)}</small></span></td>
        <td><BookmarkButton productId={item.productId} /></td>
      </tr>)}</tbody></table>
      {items.length === 0 ? <div className="empty-state">沒有符合條件的物品。</div> : null}</div>
    </>
  );
}

// Kept separate so the dashboard can stay easy to test and refactor.
import { useBookmarks as requireBookmarks } from "./bookmarks";
