"use client";

import type { CraftFlip, CraftStrategy } from "@sky-turbo/core";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { RefreshButton } from "./refresh-button";
import { useBackgroundRefresh } from "./use-background-refresh";

type SortKey = "profit" | "profitPerOutput" | "marginPercent" | "inputCost" | "matchedVolume7d";
type CraftResponse = {
  flips: CraftFlip[];
  skippedCount: number;
  totalRecipes: number;
  updatedAt: number;
  recipeGeneratedAt: string;
  recipeCommit: string;
  priceModel: string;
};

const strategyLabels: Record<CraftStrategy, string> = {
  "bo-so": "Buy Order → Sell Order",
  "ib-so": "Instant Buy → Sell Order",
  "bo-is": "Buy Order → Instant Sell",
  "ib-is": "Instant Buy → Instant Sell",
};

export function CraftDashboard() {
  const [strategy, setStrategy] = useState<CraftStrategy>("bo-so");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("profit");
  const [minProfit, setMinProfit] = useState(0);
  const [data, setData] = useState<CraftResponse>({
    flips: [], skippedCount: 0, totalRecipes: 0, updatedAt: 0,
    recipeGeneratedAt: "", recipeCommit: "", priceModel: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoadedRef = useRef(false);
  const cacheRef = useRef(new Map<CraftStrategy, CraftResponse>());

  const load = useCallback(async (signal: AbortSignal) => {
    const cached = cacheRef.current.get(strategy);
    if (cached) {
      setData(cached);
      hasLoadedRef.current = true;
    }
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const response = await fetch(`/api/v1/craft-flips?strategy=${strategy}`, { cache: "no-store", signal });
      const payload = await response.json() as { data?: Partial<CraftResponse>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Craft Flip 計算失敗");
      const next: CraftResponse = {
        flips: payload.data?.flips ?? [],
        skippedCount: payload.data?.skippedCount ?? 0,
        totalRecipes: payload.data?.totalRecipes ?? 0,
        updatedAt: payload.data?.updatedAt ?? Date.now(),
        recipeGeneratedAt: payload.data?.recipeGeneratedAt ?? "",
        recipeCommit: payload.data?.recipeCommit ?? "",
        priceModel: payload.data?.priceModel ?? "",
      };
      cacheRef.current.set(strategy, next);
      setData(next);
      hasLoadedRef.current = true;
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Craft Flip 計算失敗");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [strategy]);
  const { refresh, refreshing } = useBackgroundRefresh(load, `craft-${strategy}`);

  const displayed = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.flips.filter((flip) =>
      flip.profit >= minProfit &&
      (!query || flip.name.toLowerCase().includes(query) || flip.productId.toLowerCase().includes(query) ||
        flip.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(query) || ingredient.productId.toLowerCase().includes(query))),
    ).sort((left, right) => right[sort] - left[sort]);
  }, [data.flips, minProfit, search, sort]);

  return <>
    <div className="toolbar panel craft-toolbar">
      <DebouncedSearchField onSearch={setSearch} placeholder="成品、原料或 ID" />
      <label><span>交易策略</span><select value={strategy} onChange={(event) => setStrategy(event.target.value as CraftStrategy)}>
        {Object.entries(strategyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
        <option value="profit">單次 Craft Profit</option>
        <option value="profitPerOutput">Profit / 成品</option>
        <option value="marginPercent">Margin (%)</option>
        <option value="matchedVolume7d">7 日成交量</option>
        <option value="inputCost">投入成本</option>
      </select></label>
      <label><span>Min Profit</span><input type="number" min="0" step="100" value={minProfit} onChange={(event) => setMinProfit(Math.max(0, Number(event.target.value) || 0))} /></label>
      <RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} />
    </div>
    <div className="depth-note"><span>{displayed.length} 筆有利可圖的 Bazaar 合成配方 · 共同步 {data.totalRecipes.toLocaleString("zh-TW")} 筆</span><span className={error && hasLoadedRef.current ? "negative" : undefined}>{error && hasLoadedRef.current ? error : data.priceModel || "載入合成配方與 Bazaar 掛單中"}</span></div>
    {loading && !hasLoadedRef.current
      ? <div className="state-card"><span className="spinner" />正在計算四種 Craft 策略…</div>
      : error && !hasLoadedRef.current
        ? <div className="state-card error-state">{error}</div>
        : <div className="market-table-wrap panel"><table className="market-table craft-table"><thead><tr>
          <th>合成成品</th><th>原料</th><th>單次產出</th><th>投入成本</th><th>稅後收入</th><th>Craft Profit</th><th>7日成交量</th><th>資料來源</th>
        </tr></thead><tbody>{displayed.slice(0, 300).map((flip) => <tr key={flip.recipeId}>
          <td><Link className="item-cell" href={`/items/${encodeURIComponent(flip.productId)}`}><ItemIcon name={flip.name} productId={flip.productId} /><span><strong>{flip.name}</strong><small>{flip.productId}</small></span></Link></td>
          <td><span className="stack craft-materials">{flip.ingredients.map((ingredient) => <span key={ingredient.productId}><strong>{ingredient.amount.toLocaleString("zh-TW")}× {ingredient.name}</strong><small>{formatCoins(ingredient.unitCost)}/ea · {formatCoins(ingredient.totalCost)}</small></span>)}</span></td>
          <td><span className="stack"><strong>{flip.outputAmount.toLocaleString("zh-TW")}</strong>{flip.requirement ? <small>{flip.requirement}</small> : null}</span></td>
          <td>{formatCoins(flip.inputCost)}</td>
          <td><span className="stack"><strong>{formatCoins(flip.revenueAfterTax)}</strong><small>稅前 {formatCoins(flip.grossRevenue)}</small></span></td>
          <td><span className={`stack ${tone(flip.profit)}`}><strong>{formatCoins(flip.profit)}</strong><small>{formatCoins(flip.profitPerOutput)}/ea · {formatPercent(flip.marginPercent)}</small></span></td>
          <td><span className="stack"><strong>{flip.matchedVolume7d.toLocaleString("zh-TW")}</strong><small>近 7 天 BZ 成交</small></span></td>
          <td><a className="source-link" href={flip.source.url} target="_blank" rel="noreferrer">NEU recipe</a></td>
        </tr>)}</tbody></table>{displayed.length === 0 ? <div className="empty-state">目前沒有符合條件且可由 Bazaar 完整定價的 Craft Flip。</div> : null}</div>}
    <p className="npc-disclaimer">僅顯示原料與成品全部可在 Bazaar 交易的 crafting recipes，確保四種 Buy/Instant 與 Sell/Instant 策略都有實際市場語意。配方來自固定 commit 的 <a href="https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO" target="_blank" rel="noreferrer">NotEnoughUpdates Recipe Repository</a>；可執行 <code>pnpm sync:flip-data</code> 更新全部 Flip 資料與圖示。</p>
  </>;
}
