"use client";

import {
  isCrashingMarketItem,
  parseCompactNumber,
  type MarketItem,
  type MarketSnapshot,
  type PricePoint,
} from "@sky-turbo/core";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookmarkButton } from "./bookmarks";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { useI18n } from "./i18n";
import {
  createCrashingMarketFilters,
  createEmptyMarketFilters,
  MarketFilterPanel,
  type MarketFilterDrafts,
} from "./market-filter-panel";
import { PriceChart } from "./price-chart";
import { RefreshButton } from "./refresh-button";
import { useBackgroundRefresh } from "./use-background-refresh";

type SortKey = "coinsPerHour" | "marginPercent" | "marginCoins" | "volatility" | "buyOrderChange24h";
function inRange(value: number, range: { min: string; max: string }): boolean {
  const min = parseCompactNumber(range.min) ?? -Infinity;
  const max = parseCompactNumber(range.max) ?? Infinity;
  return value >= min && value <= max;
}

function Featured({ item }: { item: MarketItem }) {
  const { localeTag, t } = useI18n();
  const [points, setPoints] = useState<PricePoint[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/market/items/${encodeURIComponent(item.productId)}/history?range=1d`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((payload: { data?: { points?: PricePoint[] } }) => setPoints(payload.data?.points ?? []))
      .catch((error: Error) => {
        if (error.name !== "AbortError") console.warn("Featured history refresh failed", error);
      });
    return () => controller.abort();
  }, [item.productId, item.updatedAt]);
  const chartPoints = points.length ? points : [{
    time: item.updatedAt,
    price: item.midpoint,
    buyOrderPrice: item.buyOrderPrice,
    sellOrderPrice: item.sellOrderPrice,
  }];
  return (
    <section className="featured-card panel">
      <div className="featured-copy">
        <span className="eyebrow">{t("market.featured")}</span>
        <div className="item-heading"><ItemIcon name={item.name} productId={item.productId} /><div><h2>{item.name}</h2><code>{item.productId}</code></div></div>
        <div className="metric-row">
          <div><span>{t("market.buyOrder")}</span><strong>{formatCoins(item.buyOrderPrice, true, localeTag)}</strong></div>
          <div><span>{t("market.sellOrder")}</span><strong>{formatCoins(item.sellOrderPrice, true, localeTag)}</strong></div>
          <div><span>24h</span><strong className={tone(item.changes?.["1d"])}>{formatPercent(item.changes?.["1d"], t("common.accumulating"))}</strong></div>
          <div><span>{t("market.volume7d")}</span><strong>{formatCoins(item.weeklyVolume, true, localeTag)}</strong></div>
        </div>
      </div>
      <div className="featured-chart"><PriceChart points={chartPoints} height={174} compact /></div>
    </section>
  );
}

export function MarketDashboard({
  bookmarksOnly = false,
  crashingOnly = false,
}: {
  bookmarksOnly?: boolean;
  crashingOnly?: boolean;
}) {
  const { localeTag, number, t, time } = useI18n();
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>(crashingOnly ? "buyOrderChange24h" : "coinsPerHour");
  const [filters, setFilters] = useState<MarketFilterDrafts>(
    crashingOnly ? createCrashingMarketFilters : createEmptyMarketFilters,
  );
  const updateSearch = useCallback((value: string) => setSearch(value), []);
  const { bookmarks } = requireBookmarks();

  const loadSnapshot = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/v1/market/items", { cache: "no-store", signal });
      const payload = (await response.json()) as { data?: MarketSnapshot; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? t("market.readFailed"));
      setSnapshot(payload.data);
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : t("market.readFailed"));
    }
  }, [t]);
  const { refresh, refreshing } = useBackgroundRefresh(
    loadSnapshot,
    `market:${bookmarksOnly}:${crashingOnly}`,
  );

  const items = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (snapshot?.items ?? [])
      .filter((item) => !bookmarksOnly || bookmarks.has(item.productId))
      .filter((item) => !crashingOnly || isCrashingMarketItem(item))
      .filter((item) => !query || item.name.toLowerCase().includes(query) || item.productId.toLowerCase().includes(query))
      .filter((item) => inRange(item.volatility?.["7d"] ?? 0, filters.volatility))
      .filter((item) => inRange(item.sellVolume, filters.sellVolume))
      .filter((item) => inRange(item.buyVolume, filters.buyVolume))
      .filter((item) => inRange(item.totalVolume, filters.totalVolume))
      .filter((item) => inRange(item.buyOrderPrice, filters.buyOrderPrice))
      .filter((item) => inRange(item.instantBuyPrice, filters.price))
      .filter((item) => inRange(item.coinsPerHour, filters.coinsPerHour))
      .filter((item) => inRange(item.marginCoins, filters.marginCoins))
      .filter((item) => inRange(item.marginPercent, filters.marginPercent))
      .sort((a, b) => {
        if (sort === "volatility") return (b.volatility?.["7d"] ?? 0) - (a.volatility?.["7d"] ?? 0);
        if (sort === "buyOrderChange24h") {
          return (a.buyOrderChange24h ?? 0) - (b.buyOrderChange24h ?? 0);
        }
        return b[sort] - a[sort];
      });
  }, [bookmarks, bookmarksOnly, crashingOnly, filters, search, snapshot, sort]);

  if (error && !snapshot) return <div className="state-card error-state"><strong>{t("market.loadFailed")}</strong><span>{error}</span></div>;
  if (!snapshot) return <div className="state-card"><span className="spinner" />{t("market.loading")}</div>;

  return (
    <>
      <div className="toolbar panel">
        <DebouncedSearchField onSearch={updateSearch} placeholder={t("market.search")} />
        <label><span>{t("common.sort")}</span><select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="coinsPerHour">{t("market.sort.cph")}</option><option value="marginPercent">{t("market.sort.marginPercent")}</option>
          <option value="marginCoins">{t("market.sort.marginCoins")}</option><option value="volatility">{t("market.sort.volatility")}</option>
          <option value="buyOrderChange24h">{t("market.sort.buyOrderDrop")}</option>
        </select></label>
        <MarketFilterPanel
          initialFilters={crashingOnly ? createCrashingMarketFilters() : undefined}
          onApply={setFilters}
        />
        <RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} />
      </div>
      {items[0] && !bookmarksOnly && !crashingOnly ? <Featured item={items[0]} /> : null}
      <div className="table-meta"><span>{t("common.items", { count: number(items.length) })}</span><span className={error ? "negative" : undefined}>{error || t("common.updated", { time: time(snapshot.updatedAt) })}</span></div>
      <div className="market-table-wrap panel"><table className="market-table"><thead><tr>
        <th>{t("market.item")}</th><th>Insta Buy</th><th>{t("common.margin")}</th><th>CPH <span className="estimated">{t("market.estimated")}</span></th><th className="change-volume-heading">{crashingOnly ? t("market.buyOrderDropVolume") : t("market.changeVolume")}</th><th>{t("market.depth")}</th><th aria-label={t("bookmark.add")} />
      </tr></thead><tbody>{items.slice(0, 250).map((item) => <tr key={item.productId}>
        <td><Link className="item-cell" href={`/items/${encodeURIComponent(item.productId)}`}><ItemIcon name={item.name} productId={item.productId} /><span><strong>{item.name}</strong><code>{item.productId}</code></span></Link></td>
        <td><span className="stack"><strong>{formatCoins(item.instantBuyPrice, true, localeTag)}</strong><small>{t("market.buyOrder")} {formatCoins(item.buyOrderPrice, true, localeTag)}</small></span></td>
        <td><span className={`stack ${tone(item.marginCoins)}`}><strong>{formatCoins(item.marginCoins, true, localeTag)}</strong><small>{formatPercent(item.marginPercent, t("common.accumulating"))}</small></span></td>
        <td className={tone(item.coinsPerHour)}>{formatCoins(item.coinsPerHour, true, localeTag)}</td>
        <td><span className="stack change-volume"><strong className={tone(crashingOnly ? item.buyOrderChange24h : item.changes?.["1d"])}>{formatPercent(crashingOnly ? item.buyOrderChange24h : item.changes?.["1d"], t("common.accumulating"))}</strong><small>{item.volatility?.["7d"]?.toFixed(2) ?? t("common.accumulating")}{item.volatility?.["7d"] === undefined ? "" : "%"}</small></span></td>
        <td><span className="stack"><strong>{formatCoins(item.depthWithinFivePercent.buyOrders.quantity, true, localeTag)} / {formatCoins(item.depthWithinFivePercent.sellOffers.quantity, true, localeTag)}</strong><small>{formatCoins(item.depthWithinFivePercent.buyOrders.notional, true, localeTag)} / {formatCoins(item.depthWithinFivePercent.sellOffers.notional, true, localeTag)}</small></span></td>
        <td><BookmarkButton productId={item.productId} /></td>
      </tr>)}</tbody></table>
      {items.length === 0 ? <div className="empty-state">{t("market.noMatches")}</div> : null}</div>
    </>
  );
}

// Kept separate so the dashboard can stay easy to test and refactor.
import { useBookmarks as requireBookmarks } from "./bookmarks";
