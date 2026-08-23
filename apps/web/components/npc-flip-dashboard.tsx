"use client";

import type { NpcFlip } from "@sky-turbo/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { RefreshButton } from "./refresh-button";
import { useBackgroundRefresh } from "./use-background-refresh";

type SortKey = "profit" | "marginPercent" | "salePriceGross" | "maxDailyProfit" | "totalCost";
type MarketFilter = "all" | "bazaar" | "ah-lowest-bin";
type NpcFlipResponse = {
  flips: NpcFlip[];
  unpricedCount: number;
  updatedAt: number;
  shopDataGeneratedAt: string;
  priceModel: string;
};

export function NpcFlipDashboard() {
  const [data, setData] = useState<NpcFlipResponse>({
    flips: [],
    unpricedCount: 0,
    updatedAt: 0,
    shopDataGeneratedAt: "",
    priceModel: "",
  });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("profit");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [minProfit, setMinProfit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const response = await fetch("/api/v1/npc-flips", { cache: "no-store", signal });
      const payload = await response.json() as {
        data?: Partial<NpcFlipResponse>;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? "NPC Flip 計算失敗");
      setData({
        flips: payload.data?.flips ?? [],
        unpricedCount: payload.data?.unpricedCount ?? 0,
        updatedAt: payload.data?.updatedAt ?? Date.now(),
        shopDataGeneratedAt: payload.data?.shopDataGeneratedAt ?? "",
        priceModel: payload.data?.priceModel ?? "",
      });
      hasLoadedRef.current = true;
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "NPC Flip 計算失敗");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);
  const { refresh, refreshing } = useBackgroundRefresh(load, "npc-flips");

  const displayedFlips = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.flips
      .filter((flip) =>
        flip.profit >= minProfit &&
        (marketFilter === "all" || flip.saleSource === marketFilter) &&
        (!query ||
          flip.name.toLowerCase().includes(query) ||
          flip.productId.toLowerCase().includes(query) ||
          flip.npc.toLowerCase().includes(query) ||
          flip.costs.some((cost) => cost.name.toLowerCase().includes(query))),
      )
      .sort((left, right) => {
        if (sort === "maxDailyProfit") {
          return (right.maxDailyProfit ?? Number.NEGATIVE_INFINITY)
            - (left.maxDailyProfit ?? Number.NEGATIVE_INFINITY);
        }
        return right[sort] - left[sort];
      });
  }, [data.flips, marketFilter, minProfit, search, sort]);

  return <>
    <div className="toolbar panel npc-flip-toolbar">
      <DebouncedSearchField onSearch={setSearch} placeholder="物品、NPC、成本材料或 ID" />
      <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
        <option value="profit">Profit</option>
        <option value="marginPercent">Margin (%)</option>
        <option value="maxDailyProfit">每日上限 Profit</option>
        <option value="salePriceGross">出售價格</option>
        <option value="totalCost">購買成本</option>
      </select></label>
      <label><span>市場分類</span><select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value as MarketFilter)}>
        <option value="all">全部（BZ + AH）</option>
        <option value="bazaar">Bazaar</option>
        <option value="ah-lowest-bin">Auction House</option>
      </select></label>
      <label><span>Min Profit</span><input type="number" min="0" step="100" value={minProfit} onChange={(event) => setMinProfit(Math.max(0, Number(event.target.value) || 0))} /></label>
      <RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} />
    </div>
    <div className="depth-note npc-price-note">
      <span>{displayedFlips.length} 筆可定價交易 · {data.unpricedCount} 筆因缺少市場價格略過{data.updatedAt ? ` · 更新：${new Date(data.updatedAt).toLocaleTimeString("zh-TW")}` : ""}</span>
      <span className={error && hasLoadedRef.current ? "negative" : undefined}>{error && hasLoadedRef.current ? error : data.priceModel || "Bazaar 與 AH 行情載入中"}</span>
    </div>
    {loading && !hasLoadedRef.current
      ? <div className="state-card"><span className="spinner" />正在取得 Bazaar 與 lowest BIN…</div>
      : error && !hasLoadedRef.current
        ? <div className="state-card error-state">{error}</div>
        : <div className="market-table-wrap panel"><table className="market-table npc-flip-table"><thead><tr>
          <th>NPC 商品</th><th>NPC</th><th>購買需求</th><th>總成本</th><th>出售價格</th><th>7日成交量</th><th>Profit</th><th>每日上限</th><th>資料來源</th>
        </tr></thead><tbody>{displayedFlips.slice(0, 300).map((flip) => <tr key={flip.offerId}>
          <td><span className="item-cell"><ItemIcon name={flip.name} productId={flip.productId} /><span><strong>{flip.quantity > 1 ? `${flip.quantity}× ` : ""}{flip.name}</strong><small>{flip.productId}</small></span></span></td>
          <td><span className="stack"><strong>{flip.npc}</strong>{flip.requirement ? <small>{flip.requirement}</small> : null}</span></td>
          <td><span className="stack npc-cost-list">{flip.costs.map((cost, index) => <span key={`${cost.productId ?? "coins"}-${index}`}><strong>{formatCoins(cost.amount)}× {cost.name}</strong><small>{cost.priceSource === "coins" ? "固定 coins" : `${cost.priceSource === "bazaar" ? "BZ insta buy" : "AH LBIN"} · ${formatCoins(cost.totalPrice)}`}</small></span>)}</span></td>
          <td>{formatCoins(flip.totalCost)}</td>
          <td><span className="stack"><strong>{formatCoins(flip.salePriceGross)}</strong>{flip.saleSource === "bazaar"
            ? <small><span className="market-source-badge">BZ insta sell</span> · 稅後 {formatCoins(flip.salePriceNet)}</small>
            : <><small><span className="market-source-badge">AH 成交估價</span> · 稅後 {formatCoins(flip.salePriceNet)}</small>{flip.auctionPriceModel === "exact-lbin-and-median"
              ? <small className={flip.auctionPriceCapped ? "price-warning" : undefined}>LBIN {formatCoins(flip.auctionLowestBin ?? 0)}{flip.auctionRecentMedian ? ` · 近期中位 ${formatCoins(flip.auctionRecentMedian)}` : " · 無近期成交價"}</small>
              : <small>SkyCofl 批次調整估價 · {formatCoins(flip.salePriceGross)}</small>}</>}
          </span></td>
          <td>{flip.saleSource === "bazaar"
            ? <span className="stack"><strong>{(flip.bazaarMatchedVolume7d ?? 0).toLocaleString("zh-TW")}</strong><small>近 7 天 BZ 成交</small></span>
            : flip.ahSalesLast7d === undefined
            ? <span className="neutral">累積中</span>
            : <span className="stack"><strong>{flip.ahSalesLast7d.toLocaleString("zh-TW")} 筆</strong><small>近 7 天 AH 成交</small></span>}</td>
          <td>{flip.saleSource === "bazaar"
            ? <span className="stack"><strong className={tone(flip.profit)}>Insta Sell {formatCoins(flip.profit)}</strong><small className={tone(flip.bazaarSellOrderProfit)}>Sell Order {formatCoins(flip.bazaarSellOrderProfit ?? 0)}</small></span>
            : <span className={`stack ${tone(flip.profit)}`}><strong>{formatCoins(flip.profit)}</strong><small>{formatPercent(flip.marginPercent)}</small></span>}</td>
          <td>{flip.maxPurchases === undefined ? <span className="neutral">未標示</span> : <span className="stack"><strong>{formatCoins(flip.maxPurchases)} 次</strong><small className={tone(flip.maxDailyProfit)}>{formatCoins(flip.maxDailyProfit ?? 0)} Profit</small></span>}</td>
          <td><a className="source-link" href={flip.source.url} target="_blank" rel="noreferrer">{flip.source.label}</a></td>
        </tr>)}</tbody></table>{displayedFlips.length === 0 ? <div className="empty-state">目前沒有符合條件且可完整定價的 NPC Flip。</div> : null}</div>}
    <p className="npc-disclaimer">Bazaar Profit 以 insta buy 成本計算：Insta Sell 為立即賣給 Buy Order 的利潤，Sell Order 為掛 Sell Offer 後的預估利潤；BZ 7 日成交量取買入與賣出移動週量中較低者，避免雙邊重複計算。AH 大量項目使用 SkyCofl 批次調整估價，Celeste 系列另以 active lowest BIN 和近期實際成交中位數取較低者。AH 手續費依價格區間估算，商店解鎖條件、活動期間與未標示的購買限制仍需在遊戲內確認。AH 價格由 <a href="https://sky.coflnet.com/data" target="_blank" rel="noreferrer">SkyCofl</a> 提供。</p>
  </>;
}
