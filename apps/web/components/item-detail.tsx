"use client";

import type { MarketItem, OrderLevel, PricePoint } from "@sky-turbo/core";
import { useCallback, useState } from "react";
import { BookmarkButton } from "./bookmarks";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { PriceChart } from "./price-chart";
import { RefreshButton } from "./refresh-button";
import { useBackgroundRefresh } from "./use-background-refresh";

type Range = "1h" | "1d" | "1mo" | "all";
type OrderBook = { buyOrders: OrderLevel[]; sellOffers: OrderLevel[]; partial: boolean };

export function ItemDetail({ productId }: { productId: string }) {
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
      if (!itemResponse.ok || !itemPayload.data) throw new Error(itemPayload.error?.message ?? "找不到物品");
      if (!bookResponse.ok) throw new Error(bookPayload.error?.message ?? "無法取得即時掛單");
      if (!historyResponse.ok) throw new Error(historyPayload.error?.message ?? "無法取得歷史資料");
      setItem(itemPayload.data);
      setOrderbook(bookPayload.data ?? null);
      setHistory(historyPayload.data?.points ?? []);
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "讀取失敗");
    }
  }, [productId, range]);
  const { refresh, refreshing } = useBackgroundRefresh(loadData, `${productId}:${range}`);

  if (error && !item) return <div className="state-card error-state">{error}</div>;
  if (!item) return <div className="state-card"><span className="spinner" />正在讀取物品市場…</div>;
  const points = history.length ? history : [{
    time: item.updatedAt,
    price: item.midpoint,
    buyOrderPrice: item.buyOrderPrice,
    sellOrderPrice: item.sellOrderPrice,
  }];
  return <>
    <section className="detail-header panel"><div className="item-heading"><ItemIcon name={item.name} productId={item.productId} /><div><span className="eyebrow">Bazaar item</span><h1>{item.name}</h1><code>{item.productId}</code></div></div><div className="detail-actions"><small className={error ? "negative" : undefined}>{error || `更新：${new Date(item.updatedAt).toLocaleTimeString("zh-TW")}`}</small><RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} /><BookmarkButton productId={item.productId} /></div></section>
    <section className="summary-grid">
      <article className="summary-card panel"><span>當前 Insta Buy</span><strong>{formatCoins(item.instantBuyPrice)}</strong><small>Buy Order {formatCoins(item.buyOrderPrice)} · 中間價 {formatCoins(item.midpoint)}</small></article>
      <article className="summary-card panel"><span>Order Margin</span><strong className={tone(item.marginCoins)}>{formatCoins(item.marginCoins)}</strong><small>{formatPercent(item.marginPercent)}，已扣 1.125% 稅</small></article>
      <article className="summary-card panel"><span>±5% Buy 深度</span><strong>{formatCoins(item.depthWithinFivePercent.buyOrders.quantity)}</strong><small>{formatCoins(item.depthWithinFivePercent.buyOrders.notional)} coins</small></article>
      <article className="summary-card panel"><span>±5% Sell 深度</span><strong>{formatCoins(item.depthWithinFivePercent.sellOffers.quantity)}</strong><small>{formatCoins(item.depthWithinFivePercent.sellOffers.notional)} coins</small></article>
    </section>
    <section className="chart-panel panel"><div className="panel-title"><div><span className="eyebrow">Market history</span><h2>價格走勢</h2></div><div className="segmented">{(["1h", "1d", "1mo", "all"] as Range[]).map((value) => <button className={range === value ? "active" : ""} key={value} type="button" onClick={() => setRange(value)}>{value}</button>)}</div></div><PriceChart points={points} /></section>
    <section className="change-grid panel"><div><span>10 mins</span><strong className={tone(item.changes?.["10m"])}>{formatPercent(item.changes?.["10m"])}</strong></div><div><span>1 hour</span><strong className={tone(item.changes?.["1h"])}>{formatPercent(item.changes?.["1h"])}</strong></div><div><span>1 day</span><strong className={tone(item.changes?.["1d"])}>{formatPercent(item.changes?.["1d"])}</strong></div><div><span>1 month</span><strong className={tone(item.changes?.["1mo"])}>{formatPercent(item.changes?.["1mo"])}</strong></div><div><span>7d volatility</span><strong>{item.volatility?.["7d"]?.toFixed(2) ?? "累積中"}%</strong></div><div><span>7d volume</span><strong>{formatCoins(item.weeklyVolume)}</strong></div></section>
    <section className="orderbook-grid"><OrderBookSide title="Buy Orders" levels={orderbook?.buyOrders ?? []} side="buy" /><OrderBookSide title="Sell Offers" levels={orderbook?.sellOffers ?? []} side="sell" /></section>
    {orderbook?.partial ? <p className="data-note">Hypixel API 僅提供前 30 檔；深度與掛單量標示為部分資料。</p> : null}
  </>;
}

function OrderBookSide({ title, levels, side }: { title: string; levels: OrderLevel[]; side: "buy" | "sell" }) {
  const max = Math.max(...levels.map((level) => level.amount), 1);
  return <section className="orderbook panel"><div className="panel-title"><h2>{title}</h2><span>前 {levels.length} 檔</span></div><div className="orderbook-head"><span>Price</span><span>Amount</span><span>Orders</span></div>{levels.map((level, index) => <div className="orderbook-row" key={`${level.pricePerUnit}-${index}`}><span className={`depth-bar ${side}`} style={{ width: `${(level.amount / max) * 100}%` }} /><strong>{formatCoins(level.pricePerUnit)}</strong><span>{formatCoins(level.amount)}</span><span>{level.orders}</span></div>)}</section>;
}
