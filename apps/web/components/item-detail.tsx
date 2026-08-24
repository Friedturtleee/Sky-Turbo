"use client";

import type { MarketItem, OrderLevel, PricePoint } from "@sky-turbo/core";
import { useCallback, useState } from "react";
import { BookmarkButton } from "./bookmarks";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { useI18n } from "./i18n";
import { PriceChart } from "./price-chart";
import { RefreshButton } from "./refresh-button";
import { useBackgroundRefresh } from "./use-background-refresh";

type Range = "1h" | "1d" | "1mo" | "all";
type OrderBook = { buyOrders: OrderLevel[]; sellOffers: OrderLevel[]; partial: boolean };

export function ItemDetail({ productId }: { productId: string }) {
  const { localeTag, t, time } = useI18n();
  const [item, setItem] = useState<MarketItem | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [orderbook, setOrderbook] = useState<OrderBook | null>(null);
  const [range, setRange] = useState<Range>("1d");
  const [error, setError] = useState("");

  const loadData = useCallback(async (signal: AbortSignal) => {
    const encodedProductId = encodeURIComponent(productId);
    try {
      const [itemResponse, bookResponse, historyResponse] = await Promise.all([
        fetch(`/api/v1/market/items/${encodedProductId}`, { cache: "no-store", signal }),
        fetch(`/api/v1/market/items/${encodedProductId}/orderbook`, { cache: "no-store", signal }),
        fetch(`/api/v1/market/items/${encodedProductId}/history?range=${range}`, { cache: "no-store", signal }),
      ]);
      const [itemPayload, bookPayload, historyPayload] = await Promise.all([
        itemResponse.json(),
        bookResponse.json(),
        historyResponse.json(),
      ]) as [
        { data?: MarketItem; error?: { message?: string } },
        { data?: OrderBook; error?: { message?: string } },
        { data?: { points?: PricePoint[] }; error?: { message?: string } },
      ];
      if (!itemResponse.ok || !itemPayload.data) throw new Error(itemPayload.error?.message ?? t("item.notFound"));
      if (!bookResponse.ok) throw new Error(bookPayload.error?.message ?? t("item.orderBookFailed"));
      if (!historyResponse.ok) throw new Error(historyPayload.error?.message ?? t("item.historyFailed"));
      setItem(itemPayload.data);
      setOrderbook(bookPayload.data ?? null);
      setHistory(historyPayload.data?.points ?? []);
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : t("market.readFailed"));
    }
  }, [productId, range, t]);
  const { refresh, refreshing } = useBackgroundRefresh(loadData, `${productId}:${range}`);

  if (error && !item) return <div className="state-card error-state">{error}</div>;
  if (!item) return <div className="state-card"><span className="spinner" />{t("item.loading")}</div>;
  const points = history.length ? history : [{
    time: item.updatedAt,
    price: item.midpoint,
    buyOrderPrice: item.buyOrderPrice,
    sellOrderPrice: item.sellOrderPrice,
  }];
  return <>
    <section className="detail-header panel"><div className="item-heading"><ItemIcon name={item.name} productId={item.productId} /><div><span className="eyebrow">{t("item.bazaarItem")}</span><h1>{item.name}</h1><code>{item.productId}</code></div></div><div className="detail-actions"><small className={error ? "negative" : undefined}>{error || t("common.updated", { time: time(item.updatedAt) })}</small><RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} /><BookmarkButton productId={item.productId} /></div></section>
    <section className="summary-grid">
      <article className="summary-card panel"><span>{t("item.currentInstaBuy")}</span><strong>{formatCoins(item.instantBuyPrice, true, localeTag)}</strong><small>Buy Order {formatCoins(item.buyOrderPrice, true, localeTag)} · {t("item.midpoint")} {formatCoins(item.midpoint, true, localeTag)}</small></article>
      <article className="summary-card panel"><span>{t("item.orderMargin")}</span><strong className={tone(item.marginCoins)}>{formatCoins(item.marginCoins, true, localeTag)}</strong><small>{formatPercent(item.marginPercent, t("common.accumulating"))} · 1.125% tax</small></article>
      <article className="summary-card panel"><span>{t("item.buyDepth")}</span><strong>{formatCoins(item.depthWithinFivePercent.buyOrders.quantity, true, localeTag)}</strong><small>{formatCoins(item.depthWithinFivePercent.buyOrders.notional, true, localeTag)} {t("common.coins")}</small></article>
      <article className="summary-card panel"><span>{t("item.sellDepth")}</span><strong>{formatCoins(item.depthWithinFivePercent.sellOffers.quantity, true, localeTag)}</strong><small>{formatCoins(item.depthWithinFivePercent.sellOffers.notional, true, localeTag)} {t("common.coins")}</small></article>
    </section>
    <section className="chart-panel panel"><div className="panel-title"><div><span className="eyebrow">{t("item.marketHistory")}</span><h2>{t("item.priceHistory")}</h2></div><div className="segmented">{(["1h", "1d", "1mo", "all"] as Range[]).map((value) => <button className={range === value ? "active" : ""} key={value} type="button" onClick={() => setRange(value)}>{value}</button>)}</div></div><PriceChart points={points} /></section>
    <section className="change-grid panel"><div><span>{t("item.tenMinutes")}</span><strong className={tone(item.changes?.["10m"])}>{formatPercent(item.changes?.["10m"], t("common.accumulating"))}</strong></div><div><span>{t("item.oneHour")}</span><strong className={tone(item.changes?.["1h"])}>{formatPercent(item.changes?.["1h"], t("common.accumulating"))}</strong></div><div><span>{t("item.oneDay")}</span><strong className={tone(item.changes?.["1d"])}>{formatPercent(item.changes?.["1d"], t("common.accumulating"))}</strong></div><div><span>{t("item.oneMonth")}</span><strong className={tone(item.changes?.["1mo"])}>{formatPercent(item.changes?.["1mo"], t("common.accumulating"))}</strong></div><div><span>{t("item.volatility7d")}</span><strong>{item.volatility?.["7d"]?.toFixed(2) ?? t("common.accumulating")}{item.volatility?.["7d"] === undefined ? "" : "%"}</strong></div><div><span>{t("item.volume7d")}</span><strong>{formatCoins(item.weeklyVolume, true, localeTag)}</strong></div></section>
    <section className="orderbook-grid"><OrderBookSide title={t("item.buyOrders")} levels={orderbook?.buyOrders ?? []} side="buy" /><OrderBookSide title={t("item.sellOffers")} levels={orderbook?.sellOffers ?? []} side="sell" /></section>
    {orderbook?.partial ? <p className="data-note">{t("item.partialNote")}</p> : null}
  </>;
}

function OrderBookSide({ title, levels, side }: { title: string; levels: OrderLevel[]; side: "buy" | "sell" }) {
  const { localeTag, t } = useI18n();
  const max = Math.max(...levels.map((level) => level.amount), 1);
  return <section className="orderbook panel"><div className="panel-title"><h2>{title}</h2><span>{t("item.topLevels", { count: levels.length })}</span></div><div className="orderbook-head"><span>{t("item.price")}</span><span>{t("item.amount")}</span><span>{t("item.orders")}</span></div>{levels.map((level, index) => <div className="orderbook-row" key={`${level.pricePerUnit}-${index}`}><span className={`depth-bar ${side}`} style={{ width: `${(level.amount / max) * 100}%` }} /><strong>{formatCoins(level.pricePerUnit, true, localeTag)}</strong><span>{formatCoins(level.amount, true, localeTag)}</span><span>{level.orders}</span></div>)}</section>;
}
