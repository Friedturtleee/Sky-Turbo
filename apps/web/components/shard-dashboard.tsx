"use client";

import {
  collectShardRouteMaterials,
  parseCompactNumber,
  scaleShardRouteForOutput,
  type ShardFlip,
  type ShardRouteNode,
  type ShardStrategy,
} from "@sky-turbo/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import {
  appendMarketFilters,
  createEmptyMarketFilters,
  MarketFilterPanel,
  type MarketFilterDrafts,
} from "./market-filter-panel";

type SortKey = "profit" | "profitPerOutput" | "marginPercent" | "maxOutput" | "maxFusions" | "inputCost";

const strategyLabels: Record<ShardStrategy, string> = {
  "bo-so": "Buy Order → Sell Order",
  "ib-so": "Instant Buy → Sell Order",
  "bo-is": "Buy Order → Instant Sell",
  "ib-is": "Instant Buy → Instant Sell",
};
export function ShardDashboard() {
  const [strategy, setStrategy] = useState<ShardStrategy>("bo-so");
  const [level, setLevel] = useState(0);
  const [appliedLevel, setAppliedLevel] = useState(0);
  const [search, setSearch] = useState("");
  const updateSearch = useCallback((value: string) => setSearch(value), []);
  const [sort, setSort] = useState<SortKey>("profit");
  const [minProfitPercent, setMinProfitPercent] = useState(0.1);
  const [filters, setFilters] = useState<MarketFilterDrafts>(createEmptyMarketFilters);
  const [flips, setFlips] = useState<ShardFlip[]>([]);
  const [depthModel, setDepthModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedFlip, setSelectedFlip] = useState<ShardFlip | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      strategy,
      crocodileLevel: String(appliedLevel),
      minProfitPercent: String(minProfitPercent),
    });
    appendMarketFilters(query, filters);
    void fetch(`/api/v1/shard-flips?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: { flips?: ShardFlip[]; depthModel?: string };
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(payload.error?.message ?? "計算失敗");
        setFlips(payload.data?.flips ?? []);
        setDepthModel(payload.data?.depthModel ?? "");
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [appliedLevel, filters, minProfitPercent, strategy]);

  const applyCrocodileLevel = (value: string) => {
    const next = Math.min(10, Math.max(0, Number(value)));
    if (Number.isInteger(next)) setAppliedLevel(next);
  };

  const displayedFlips = useMemo(() => {
    const query = search.trim().toLowerCase();
    return flips
      .filter((flip) =>
        !query ||
        flip.name.toLowerCase().includes(query) ||
        flip.productId.toLowerCase().includes(query) ||
        flip.materials.some((material) => material.name.toLowerCase().includes(query)),
      )
      .sort((left, right) => {
        if (sort === "maxOutput") return right.depth.maxProfitableOutput - left.depth.maxProfitableOutput;
        if (sort === "maxFusions") return right.depth.maxProfitableFusions - left.depth.maxProfitableFusions;
        return right[sort] - left[sort];
      });
  }, [flips, search, sort]);

  return <>
    <div className="toolbar panel shard-controls">
      <label><span>交易策略</span><select value={strategy} onChange={(event) => setStrategy(event.target.value as ShardStrategy)}>
        {Object.entries(strategyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="level-control">
        <span className="level-heading">Crocodile 等級：<strong>{level}</strong>{level !== appliedLevel ? <small>放開後套用</small> : null}</span>
        <div className="range-scale"><input aria-label="Crocodile 等級" type="range" min="0" max="10" step="1" value={level} onChange={(event) => setLevel(Number(event.target.value))} onPointerUp={(event) => applyCrocodileLevel(event.currentTarget.value)} onPointerCancel={(event) => applyCrocodileLevel(event.currentTarget.value)} onKeyUp={(event) => applyCrocodileLevel(event.currentTarget.value)} onBlur={(event) => applyCrocodileLevel(event.currentTarget.value)} /><div className="range-scale-labels" aria-hidden="true"><span>0</span><span>10</span></div></div>
      </label>
      <div className="ev-note"><span>Reptile 路線預期產量</span><strong>× {(1 + level * 0.02).toFixed(2)}</strong><small>期望值，不保證單次結果</small></div>
    </div>
    <div className="toolbar panel shard-filter-toolbar">
      <DebouncedSearchField onSearch={updateSearch} placeholder="成品、原料或 ID" />
      <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
        <option value="profit">Flip Profit</option>
        <option value="profitPerOutput">Profit / 成品</option>
        <option value="marginPercent">Margin (%)</option>
        <option value="maxOutput">最大可獲利成品</option>
        <option value="maxFusions">最大 Fusion 次數</option>
        <option value="inputCost">投入成本</option>
      </select></label>
      <MinProfitControl value={minProfitPercent} onApply={setMinProfitPercent} />
      <MarketFilterPanel
        summary="原料＋成品篩選器"
        explanation="條件同時套用到直接購入的所有葉節點原料與最終成品；原料不合格時會重新尋找其他 Fusion 路線。"
        applyLabel="套用並重算路徑"
        onApply={setFilters}
      />
    </div>
    <div className="depth-note"><span>{displayedFlips.length} 個可用成品路線</span><span>{depthModel || "市場深度使用 Hypixel 可見掛單估算。"}</span></div>
    {loading ? <div className="state-card"><span className="spinner" />正在篩選市場並重算替代 Fusion 路徑…</div> : error ? <div className="state-card error-state">{error}</div> :
      <div className="market-table-wrap panel"><table className="market-table shard-table"><thead><tr><th>產出 Shard</th><th className="change-volume-heading">24h / Vol.</th><th>實際市場原料</th><th>單次產出</th><th>成本</th><th>Flip Profit</th><th>可獲利市場深度</th><th>詳細</th></tr></thead><tbody>
        {displayedFlips.slice(0, 300).map((flip) => <tr key={flip.shardId}><td><span className="stack"><strong>{flip.name}</strong><small>{flip.family} · {flip.rarity}</small></span></td>
          <td><span className={`stack change-volume ${tone(flip.change24h)}`}><strong>{formatPercent(flip.change24h)}</strong><small className="neutral">{flip.volatility7d === undefined ? "Vol. 累積中" : `Vol. ${flip.volatility7d.toFixed(2)}%`}</small></span></td>
          <td><span className="stack route-materials">{flip.materials.slice(0, 2).map((material) => <strong key={material.productId}>{integer(material.quantityPerFusion)}× {material.name}</strong>)}{flip.materials.length > 2 ? <small>另有 {flip.materials.length - 2} 種遞迴原料</small> : <small>已展開至直接購入原料</small>}</span></td>
          <td>{flip.expectedOutput.toFixed(2)} {flip.crocodileApplied && flip.crocodileLevel > 0 ? <span className="ev-badge">EV</span> : null}</td>
          <td>{formatCoins(flip.inputCost)}</td>
          <td><span className={`stack ${tone(flip.profit)}`}><strong>{formatCoins(flip.profit)}</strong><small>{formatPercent(flip.marginPercent)} · {formatCoins(flip.profitPerOutput)}/ea</small></span></td>
          <td className="shard-depth">{flip.depth.available ? <span className="stack"><span className="depth-summary-line"><strong className={flip.depth.maxProfitableFusions > 0 ? "positive" : "negative"}>{formatCoins(flip.depth.maxProfitableFusions)} 次 Fusion</strong><strong className={tone(flip.depth.totalProfit)}>總利潤 {formatCoins(flip.depth.totalProfit)}</strong></span><small>≈ {formatCoins(flip.depth.maxProfitableOutput)} 成品 · {flip.depth.limitedBy}{flip.depth.partial ? " · 前 30 檔" : ""}</small></span> : <span className="stack neutral"><strong>無法估算</strong><small>{flip.depth.limitedBy}</small></span>}</td>
          <td><button className="detail-button" type="button" onClick={() => setSelectedFlip(flip)}>查看詳細</button></td>
        </tr>)}
      </tbody></table>{displayedFlips.length === 0 ? <div className="empty-state">沒有同時符合原料與成品條件的 Fusion 路線。</div> : null}</div>}
    {selectedFlip ? <ShardDetailModal flip={selectedFlip} onClose={() => setSelectedFlip(null)} /> : null}
  </>;
}

function MinProfitControl({ value, onApply }: { value: number; onApply: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const parsed = parseCompactNumber(draft);
    const next = parsed !== undefined ? Math.min(100, Math.max(0, parsed)) : 0.1;
    setDraft(String(next));
    onApply(next);
  };
  return <label className="min-profit-control"><span>Min Profit</span><span className="min-profit-input"><input type="text" inputMode="text" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><i>%</i></span><small>預設為原料成本的 0.1%</small></label>;
}

function integer(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function RouteTree({ node }: { node: ShardRouteNode }) {
  if (node.kind === "market") {
    return <li className="route-node market-node"><span>購買</span><strong>{integer(node.quantity)}× {node.name}</strong><small>{formatCoins(node.unitCost)} / ea</small></li>;
  }
  return <li className="route-node fusion-node"><span>Fusion</span><strong>{node.fusionCount} 次 · {node.name}</strong><small>基礎 {integer(node.fusionCount * node.baseOutput)}，預期 {node.expectedOutput.toFixed(2)} 成品</small><ul>{node.inputs.map((input, index) => <RouteTree node={input} key={`${input.shardId}-${index}`} />)}</ul></li>;
}

function ShardDetailModal({ flip, onClose }: { flip: ShardFlip; onClose: () => void }) {
  const [desiredOutputText, setDesiredOutputText] = useState(String(Math.max(1, Math.ceil(flip.expectedOutput))));
  const desiredOutput = Math.max(1, Math.ceil(parseCompactNumber(desiredOutputText) ?? 1));
  const scaled = useMemo(() => {
    if (flip.route.kind !== "fusion") {
      return { route: flip.route, fusionCount: 1, expectedOutput: flip.expectedOutput, materials: collectShardRouteMaterials(flip.route), inputCost: flip.inputCost, profit: flip.profit };
    }
    const { route, fusionCount, expectedOutput } = scaleShardRouteForOutput(flip.route, desiredOutput);
    const materials = collectShardRouteMaterials(route);
    const inputCost = materials.reduce((sum, material) => sum + material.quantity * material.unitCost, 0);
    const revenueAfterTax = flip.revenueAfterTax * fusionCount;
    return { route, fusionCount, expectedOutput, materials, inputCost, profit: revenueAfterTax - inputCost };
  }, [desiredOutput, flip]);
  const minimumProfit = flip.depth.totalInputCost * (flip.depth.minProfitPercent / 100);
  return <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="shard-detail-modal panel" role="dialog" aria-modal="true" aria-labelledby="shard-detail-title">
    <header><div><span className="eyebrow">Fusion detail</span><h2 id="shard-detail-title">{flip.name}</h2><code>{flip.productId}</code></div><button type="button" aria-label="關閉" onClick={onClose}>×</button></header>
    <div className="detail-profit-grid"><div><span>最大 Fusion</span><strong>{integer(flip.depth.maxProfitableFusions)} 次</strong></div><div><span>預期成品</span><strong>{flip.depth.maxProfitableOutput.toFixed(2)}</strong></div><div><span>原料總成本</span><strong>{formatCoins(flip.depth.totalInputCost)}</strong></div><div><span>深度總 Profit</span><strong className={tone(flip.depth.totalProfit)}>{formatCoins(flip.depth.totalProfit)}</strong></div></div>
    <div className="route-multiplier"><label><span>我需要的成品數量</span><input type="text" inputMode="text" value={desiredOutputText} onChange={(event) => setDesiredOutputText(event.target.value)} /></label><div><span>路徑倍率</span><strong>× {integer(scaled.fusionCount)}</strong></div><div><span>預期實際產出</span><strong>{scaled.expectedOutput.toFixed(2)}</strong></div><div><span>此需求估計 Profit</span><strong className={tone(scaled.profit)}>{formatCoins(scaled.profit)}</strong></div>{scaled.fusionCount > flip.depth.maxProfitableFusions && flip.depth.available ? <p>此需求已超過目前符合 Min Profit 的可見市場深度。</p> : null}</div>
    <div className="detail-columns"><article><div className="modal-section-title"><div><span className="eyebrow">Scaled route for requested output</span><h3>合成路徑</h3></div><small>Crocodile 僅計入最終產量與 Profit</small></div><ul className="route-tree"><RouteTree node={scaled.route} /></ul></article>
      <article><div className="modal-section-title"><div><span className="eyebrow">For requested output</span><h3>本次需求原料</h3></div><small>所有數量均為整數</small></div><div className="material-total-list custom-materials">{scaled.materials.map((material) => <div key={material.productId}><span><strong>{material.name}</strong><code>{material.productId}</code></span><span><strong>{integer(material.quantity)} 個</strong><small>約 {formatCoins(material.quantity * material.unitCost)}</small></span></div>)}</div>
        <div className="modal-section-title depth-material-title"><div><span className="eyebrow">Buy to exhaust profitable depth</span><h3>清空獲利深度原料</h3></div></div><div className="material-total-list">{flip.depth.materialsRequired.length ? flip.depth.materialsRequired.map((material) => <div key={material.productId}><span><strong>{material.name}</strong><code>{material.productId}</code></span><span><strong>{integer(material.quantity)} 個</strong><small>約 {formatCoins(material.estimatedCost)}</small></span></div>) : <p>目前沒有符合 Min Profit 的可執行深度。</p>}</div></article></div>
    <footer><span>Min Profit：{flip.depth.minProfitPercent}% × 原料成本 = {formatCoins(minimumProfit)}</span><span>限制：{flip.depth.limitedBy}{flip.depth.partial ? "（Hypixel 前 30 檔）" : ""}</span></footer>
  </section></div>;
}
