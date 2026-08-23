"use client";

import {
  calculateCraftProfitPlan,
  type CraftFlip,
  type CraftProfitPlan,
  type CraftStrategy,
} from "@sky-turbo/core";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { RefreshButton } from "./refresh-button";
import { useBackgroundRefresh } from "./use-background-refresh";

type SortKey = "maxProfit" | "profit" | "profitPerOutput" | "marginPercent" | "inputCost" | "matchedVolume7d";
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
  const [sort, setSort] = useState<SortKey>("maxProfit");
  const [minProfit, setMinProfit] = useState(0);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
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
    ).sort((left, right) => sort === "maxProfit"
      ? right.depth.maxProfit - left.depth.maxProfit
      : right[sort] - left[sort]);
  }, [data.flips, minProfit, search, sort]);

  const selectedFlip = useMemo(() => selectedRecipeId
    ? data.flips.find((flip) => flip.recipeId === selectedRecipeId) ?? null
    : null, [data.flips, selectedRecipeId]);

  return <>
    <div className="toolbar panel craft-toolbar">
      <DebouncedSearchField onSearch={setSearch} placeholder="成品、原料或 ID" />
      <label><span>交易策略</span><select value={strategy} onChange={(event) => setStrategy(event.target.value as CraftStrategy)}>
        {Object.entries(strategyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
        <option value="maxProfit">Max Profit</option>
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
          <th>合成成品</th><th>原料</th><th>單次產出</th><th>投入成本</th><th>稅後收入</th><th>Craft Profit</th><th>7日成交量</th><th>Max Profit</th>
        </tr></thead><tbody>{displayed.slice(0, 300).map((flip) => {
          const plan = calculateCraftProfitPlan(flip);
          return <tr key={flip.recipeId}>
          <td><button className="craft-item-button" type="button" onClick={() => setSelectedRecipeId(flip.recipeId)}><span className="item-cell"><ItemIcon name={flip.name} productId={flip.productId} /><span><strong>{flip.name}</strong><small>{flip.productId}</small></span></span></button></td>
          <td><span className="stack craft-materials">{flip.ingredients.map((ingredient) => <span key={ingredient.productId}><strong>{ingredient.amount.toLocaleString("zh-TW")}× {ingredient.name}</strong><small>{formatCoins(ingredient.unitCost)}/ea · {formatCoins(ingredient.totalCost)}</small></span>)}</span></td>
          <td><span className="stack"><strong>{flip.outputAmount.toLocaleString("zh-TW")}</strong>{flip.requirement ? <small>{flip.requirement}</small> : null}</span></td>
          <td>{formatCoins(flip.inputCost)}</td>
          <td><span className="stack"><strong>{formatCoins(flip.revenueAfterTax)}</strong><small>稅前 {formatCoins(flip.grossRevenue)}</small></span></td>
          <td><span className={`stack ${tone(flip.profit)}`}><strong>{formatCoins(flip.profit)}</strong><small>{formatCoins(flip.profitPerOutput)}/ea · {formatPercent(flip.marginPercent)}</small></span></td>
          <td><span className="stack"><strong>{flip.matchedVolume7d.toLocaleString("zh-TW")}</strong><small>近 7 天 BZ 成交</small></span></td>
          <td>{plan ? <span className="stack craft-max-profit"><strong className={tone(plan.totalProfit)}>{formatCoins(plan.totalProfit)}</strong><small>{plan.craftCount.toLocaleString("zh-TW")} Crafts · {plan.outputQuantity.toLocaleString("zh-TW")} 成品 · 7日流動性</small><CraftPlanMaterials plan={plan} compact /><button className="detail-button" type="button" onClick={() => setSelectedRecipeId(flip.recipeId)}>查看詳細</button></span> : <span className="stack"><strong>無法估算</strong><small>{flip.depth.limitedBy}</small><button className="detail-button" type="button" onClick={() => setSelectedRecipeId(flip.recipeId)}>查看詳細</button></span>}</td>
        </tr>;
        })}</tbody></table>{displayed.length === 0 ? <div className="empty-state">目前沒有符合條件且可由 Bazaar 完整定價的 Craft Flip。</div> : null}</div>}
    {selectedFlip ? <CraftFlipDetailModal flip={selectedFlip} onClose={() => setSelectedRecipeId(null)} /> : null}
    <p className="npc-disclaimer">Max Profit 會依所選策略計算：Instant 逐檔消耗 Hypixel 可見掛單，Order 使用目前最佳掛單價，並以原料與成品近 7 日成交量限制最大 Craft 次數。標示「前 30 檔」時，實際可執行深度可能更高。僅顯示原料與成品全部可在 Bazaar 交易的 crafting recipes。配方來自固定 commit 的 <a href="https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO" target="_blank" rel="noreferrer">NotEnoughUpdates Recipe Repository</a>；可執行 <code>pnpm sync:flip-data</code> 更新全部 Flip 資料與圖示。</p>
  </>;
}

function CraftPlanMaterials({ plan, compact = false }: { plan: CraftProfitPlan; compact?: boolean }) {
  return <span className={`stack craft-materials${compact ? " compact" : ""}`}>{plan.ingredients.map((ingredient) => <span key={ingredient.productId}><strong>{ingredient.amount.toLocaleString("zh-TW")}× {ingredient.name}</strong>{compact ? null : <small>{formatCoins(ingredient.unitCost)}/ea · {formatCoins(ingredient.totalCost)}</small>}</span>)}</span>;
}

function CraftFlipDetailModal({ flip, onClose }: { flip: CraftFlip; onClose: () => void }) {
  const [fraction, setFraction] = useState<1 | 0.8>(1);
  const plan = calculateCraftProfitPlan(flip, fraction);
  return <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="shard-detail-modal npc-detail-modal craft-detail-modal panel" role="dialog" aria-modal="true" aria-labelledby="craft-detail-title">
    <header><div><span className="eyebrow">Craft Max Profit detail</span><h2 id="craft-detail-title">{flip.name}</h2><code>{flip.productId} · {strategyLabels[flip.strategy]}</code></div><button type="button" aria-label="關閉" onClick={onClose}>×</button></header>
    {plan ? <><div className="detail-profit-grid"><div><span>需要合成</span><strong>{plan.craftCount.toLocaleString("zh-TW")} 次</strong></div><div><span>取得成品</span><strong>{plan.outputQuantity.toLocaleString("zh-TW")} 個</strong></div><div><span>原料總成本</span><strong>{formatCoins(plan.inputCost)}</strong></div><div><span>{fraction === 1 ? "Max Profit" : "80% Target Profit"}</span><strong className={tone(plan.totalProfit)}>{formatCoins(plan.totalProfit)}</strong></div></div>
      <div className="route-multiplier npc-plan-controls craft-plan-controls"><label><span>成本規劃目標</span><select value={fraction} onChange={(event) => setFraction(Number(event.target.value) as 1 | 0.8)}><option value={1}>最大可獲利數量（100% Max Profit）</option><option value={0.8}>Max Profit 的至少 80%</option></select></label><div><span>交易策略</span><strong>{strategyLabels[flip.strategy]}</strong></div><div><span>稅前總收入</span><strong>{formatCoins(plan.grossRevenue)}</strong></div><div><span>稅後總收入</span><strong>{formatCoins(plan.revenueAfterTax)}</strong></div></div>
      <div className="detail-columns"><article><div className="modal-section-title"><div><span className="eyebrow">Required materials</span><h3>{fraction === 1 ? "最大獲利所需原料" : "達到 80% Max Profit 所需原料"}</h3></div><small>Instant 價格已計入跨檔深度</small></div><div className="material-total-list">{plan.ingredients.map((ingredient) => <div key={ingredient.productId}><span><strong>{ingredient.name}</strong><code>{ingredient.productId} · 每次 {ingredient.amount / plan.craftCount}</code></span><span><strong>{ingredient.amount.toLocaleString("zh-TW")} 個</strong><small>{formatCoins(ingredient.totalCost)} · 平均 {formatCoins(ingredient.unitCost)}/ea</small></span></div>)}</div></article>
        <article><div className="modal-section-title"><div><span className="eyebrow">Depth and profit audit</span><h3>上限與收益</h3></div></div><div className="material-total-list"><div><span><strong>最大 Craft 次數</strong><small>{flip.depth.limitedBy}</small></span><span><strong>{flip.depth.maxCrafts.toLocaleString("zh-TW")} 次</strong><small>{flip.depth.partial ? "Instant 使用 Hypixel 前 30 檔" : "目前深度完整可見"}</small></span></div><div><span><strong>單次 Craft Profit</strong><small>{formatPercent(flip.marginPercent)} Margin</small></span><span><strong className={tone(flip.profit)}>{formatCoins(flip.profit)}</strong><small>{formatCoins(flip.profitPerOutput)}/成品</small></span></div><div><span><strong>此方案 Total Profit</strong><small>{plan.outputQuantity.toLocaleString("zh-TW")} 個成品</small></span><span><strong className={tone(plan.totalProfit)}>{formatCoins(plan.totalProfit)}</strong><small>成本 {formatCoins(plan.inputCost)}</small></span></div></div><p className="npc-detail-source">配方來源：<a className="source-link" href={flip.source.url} target="_blank" rel="noreferrer">NEU recipe</a><br /><Link className="source-link" href={`/items/${encodeURIComponent(flip.productId)}`}>查看 Bazaar 商品行情</Link></p></article></div></>
    : <div className="empty-state">目前成交量或可見掛單不足，無法可靠估算 Max Profit。單次 Craft Profit 仍可作為參考。</div>}
    <footer><span>80% 模式會選擇第一個達到 80% 最高總利潤的完整 Craft 次數。</span><span>市場成交量與掛單深度不保證立即成交。</span></footer>
  </section></div>;
}
