"use client";

import {
  collectShardRouteMaterials,
  parseCompactNumber,
  scaleShardRouteForOutput,
  type MarketFilterKey,
  type MinProfitThreshold,
  type ShardFlip,
  type ShardRouteNode,
  type ShardStrategy,
} from "@sky-turbo/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import {
  appendMarketFilters,
  createShardVolumeFilters,
  MarketFilterPanel,
  type MarketFilterDrafts,
} from "./market-filter-panel";

type SortKey = "profit" | "profitPerOutput" | "marginPercent" | "maxOutput" | "maxFusions" | "inputCost";
type ShardResponseData = { flips: ShardFlip[]; depthModel: string };

const strategyLabels: Record<ShardStrategy, string> = {
  "bo-so": "Buy Order → Sell Order",
  "ib-so": "Instant Buy → Sell Order",
  "bo-is": "Buy Order → Instant Sell",
  "ib-is": "Instant Buy → Instant Sell",
};
const shardFilterKeys: MarketFilterKey[] = ["sellVolume", "buyVolume", "totalVolume"];

export function ShardDashboard() {
  const [strategy, setStrategy] = useState<ShardStrategy>("bo-so");
  const [level, setLevel] = useState(0);
  const [search, setSearch] = useState("");
  const updateSearch = useCallback((value: string) => setSearch(value), []);
  const [sort, setSort] = useState<SortKey>("profit");
  const [minProfit, setMinProfit] = useState<MinProfitThreshold>({ mode: "percent", value: 0.1 });
  const [minFlipProfit, setMinFlipProfit] = useState<MinProfitThreshold>({ mode: "percent", value: 0 });
  const [filters, setFilters] = useState<MarketFilterDrafts>(createShardVolumeFilters);
  const [flips, setFlips] = useState<ShardFlip[]>([]);
  const [depthModel, setDepthModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedShardId, setSelectedShardId] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const responseCacheRef = useRef(new Map<string, ShardResponseData>());

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      strategy,
      crocodileLevel: String(level),
      minProfitMode: minProfit.mode,
      minProfitValue: String(minProfit.value),
      minFlipProfitMode: minFlipProfit.mode,
      minFlipProfitValue: String(minFlipProfit.value),
    });
    appendMarketFilters(query, filters);
    const requestUrl = `/api/v1/shard-flips?${query}`;
    const cached = responseCacheRef.current.get(requestUrl);
    if (cached) {
      setFlips(cached.flips);
      setDepthModel(cached.depthModel);
      hasLoadedRef.current = true;
    }
    const blocking = !hasLoadedRef.current;
    setLoading(blocking);
    setRefreshing(!blocking);
    setError("");
    void fetch(requestUrl, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: { flips?: ShardFlip[]; depthModel?: string };
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(payload.error?.message ?? "計算失敗");
        const data = {
          flips: payload.data?.flips ?? [],
          depthModel: payload.data?.depthModel ?? "",
        };
        responseCacheRef.current.set(requestUrl, data);
        hasLoadedRef.current = true;
        setFlips(data.flips);
        setDepthModel(data.depthModel);
      })
      .catch((reason: Error) => {
        if (reason.name !== "AbortError") setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => controller.abort();
  }, [filters, level, minFlipProfit, minProfit, strategy]);

  const selectedFlip = useMemo(
    () => selectedShardId ? flips.find((flip) => flip.shardId === selectedShardId) ?? null : null,
    [flips, selectedShardId],
  );

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
        <span className="level-heading">Crocodile 等級：<strong>{level}</strong></span>
        <div className="range-scale"><input aria-label="Crocodile 等級" type="range" min="0" max="10" step="1" value={level} onChange={(event) => setLevel(Number(event.target.value))} /><div className="range-scale-labels" aria-hidden="true"><span>0</span><span>10</span></div></div>
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
      <ProfitThresholdControl label="Min Profit" percentOption="% of cost" value={minProfit} onApply={setMinProfit} />
      <ProfitThresholdControl label="Min Flip Profit" percentOption="% of max" value={minFlipProfit} onApply={setMinFlipProfit} />
      <MarketFilterPanel
        summary="原料＋成品篩選器"
        explanation="只用 Sell / Buy / Total volume 篩選，且預設不限制；條件會同時套用到直接購入的所有葉節點原料與最終成品。"
        applyLabel="套用並重算路徑"
        visibleKeys={shardFilterKeys}
        initialFilters={createShardVolumeFilters()}
        onApply={setFilters}
      />
    </div>
    <div className="depth-note"><span>{displayedFlips.length} 個可用成品路線{refreshing ? <i className="inline-refresh"><span className="spinner" />更新中</i> : null}</span><span className={error && hasLoadedRef.current ? "negative" : undefined}>{error && hasLoadedRef.current ? error : depthModel || "市場深度使用 Hypixel 可見掛單估算。"}</span></div>
    {loading ? <div className="state-card"><span className="spinner" />正在篩選市場並重算替代 Fusion 路徑…</div> : error && !hasLoadedRef.current ? <div className="state-card error-state">{error}</div> :
      <div className="market-table-wrap panel"><table className="market-table shard-table"><thead><tr><th>產出 Shard</th><th className="change-volume-heading">24h / Vol.</th><th>實際市場原料</th><th>單次產出</th><th>成本</th><th>Flip Profit</th><th>可獲利市場深度</th><th>詳細</th></tr></thead><tbody>
        {displayedFlips.slice(0, 300).map((flip) => <tr key={flip.shardId}><td><span className="stack"><strong>{flip.name}</strong><small>{flip.family} · {flip.rarity}</small></span></td>
          <td><span className={`stack change-volume ${tone(flip.change24h)}`}><strong>{formatPercent(flip.change24h)}</strong><small className="neutral">{flip.volatility7d === undefined ? "Vol. 累積中" : `Vol. ${flip.volatility7d.toFixed(2)}%`}</small></span></td>
          <td><span className="stack route-materials">{flip.materials.slice(0, 2).map((material) => <strong key={material.productId}>{integer(material.quantityPerFusion)}× {material.name}</strong>)}{flip.materials.length > 2 ? <small>另有 {flip.materials.length - 2} 種遞迴原料</small> : <small>已展開至直接購入原料</small>}</span></td>
          <td>{flip.expectedOutput.toFixed(2)} {flip.crocodileApplied && flip.crocodileLevel > 0 ? <span className="ev-badge">EV</span> : null}</td>
          <td>{formatCoins(flip.inputCost)}</td>
          <td><span className={`stack ${tone(flip.profit)}`}><strong>{formatCoins(flip.profit)}</strong><small>{formatPercent(flip.marginPercent)} · {formatCoins(flip.profitPerOutput)}/ea</small></span></td>
          <td className="shard-depth">{flip.depth.available ? <span className="stack"><span className="depth-summary-line"><strong className={flip.depth.maxProfitableFusions > 0 ? "positive" : "negative"}>{formatCoins(flip.depth.maxProfitableFusions)} 次 Fusion</strong><strong className={tone(flip.depth.totalProfit)}>總利潤 {formatCoins(flip.depth.totalProfit)}</strong></span><small>≈ {formatCoins(flip.depth.maxProfitableOutput)} 成品 · {flip.depth.limitedBy}{flip.depth.partial ? " · 前 30 檔" : ""}</small></span> : <span className="stack neutral"><strong>無法估算</strong><small>{flip.depth.limitedBy}</small></span>}</td>
          <td><button className="detail-button" type="button" onClick={() => setSelectedShardId(flip.shardId)}>查看詳細</button></td>
        </tr>)}
      </tbody></table>{displayedFlips.length === 0 ? <div className="empty-state">沒有同時符合原料與成品條件的 Fusion 路線。</div> : null}</div>}
    {selectedFlip ? <ShardDetailModal flip={selectedFlip} onClose={() => setSelectedShardId(null)} /> : null}
  </>;
}

function ProfitThresholdControl({
  label,
  percentOption,
  value,
  onApply,
}: {
  label: string;
  percentOption: string;
  value: MinProfitThreshold;
  onApply: (value: MinProfitThreshold) => void;
}) {
  const [draft, setDraft] = useState(String(value.value));
  const parseDraft = (mode: MinProfitThreshold["mode"]): number => {
    const parsed = parseCompactNumber(draft);
    return parsed !== undefined
      ? Math.max(0, mode === "percent" ? Math.min(100, parsed) : parsed)
      : mode === "percent" ? 0.1 : 0;
  };
  const commit = () => {
    const next = parseDraft(value.mode);
    setDraft(String(next));
    onApply({ ...value, value: next });
  };
  return <label className="min-profit-control"><span>{label}</span><span className="min-profit-input"><input aria-label={`${label} 數值`} type="text" inputMode="text" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><select aria-label={`${label} 單位`} value={value.mode} onChange={(event) => { const mode = event.target.value as MinProfitThreshold["mode"]; const next = parseDraft(mode); setDraft(String(next)); onApply({ mode, value: next }); }}><option value="percent">{percentOption}</option><option value="coins">$</option></select></span></label>;
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
    const { route, fusionCount, expectedOutput } = scaleShardRouteForOutput(
      flip.route,
      desiredOutput,
    );
    const materials = collectShardRouteMaterials(route);
    const inputCost = materials.reduce((sum, material) => sum + material.quantity * material.unitCost, 0);
    const revenueAfterTax = flip.revenueAfterTax * fusionCount;
    return { route, fusionCount, expectedOutput, materials, inputCost, profit: revenueAfterTax - inputCost };
  }, [desiredOutput, flip]);
  const minimumProfit = flip.depth.minProfit.mode === "percent"
    ? flip.depth.totalInputCost * (flip.depth.minProfit.value / 100)
    : flip.depth.minProfit.value;
  const minimumProfitLabel = flip.depth.minProfit.mode === "percent"
    ? `${flip.depth.minProfit.value}% × 原料成本`
    : `${formatCoins(flip.depth.minProfit.value)} coins`;
  const minimumFlipProfit = flip.depth.minFlipProfit.mode === "percent"
    ? flip.depth.maxFlipProfit * (flip.depth.minFlipProfit.value / 100)
    : flip.depth.minFlipProfit.value;
  const minimumFlipProfitLabel = flip.depth.minFlipProfit.mode === "percent"
    ? `${flip.depth.minFlipProfit.value}% × 最高單次 ${formatCoins(flip.depth.maxFlipProfit)}`
    : `${formatCoins(flip.depth.minFlipProfit.value)} coins`;
  return <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="shard-detail-modal panel" role="dialog" aria-modal="true" aria-labelledby="shard-detail-title">
    <header><div><span className="eyebrow">Fusion detail</span><h2 id="shard-detail-title">{flip.name}</h2><code>{flip.productId}</code></div><button type="button" aria-label="關閉" onClick={onClose}>×</button></header>
    <div className="detail-profit-grid"><div><span>最大 Fusion</span><strong>{integer(flip.depth.maxProfitableFusions)} 次</strong></div><div><span>預期成品</span><strong>{flip.depth.maxProfitableOutput.toFixed(2)}</strong></div><div><span>原料總成本</span><strong>{formatCoins(flip.depth.totalInputCost)}</strong></div><div><span>深度總 Profit</span><strong className={tone(flip.depth.totalProfit)}>{formatCoins(flip.depth.totalProfit)}</strong></div></div>
    <div className="route-multiplier"><label><span>我需要的成品數量</span><input type="text" inputMode="text" value={desiredOutputText} onChange={(event) => setDesiredOutputText(event.target.value)} /></label><div><span>路徑倍率</span><strong>× {integer(scaled.fusionCount)}</strong></div><div><span>預期實際產出</span><strong>{scaled.expectedOutput.toFixed(2)}</strong></div><div><span>此需求估計 Profit</span><strong className={tone(scaled.profit)}>{formatCoins(scaled.profit)}</strong></div>{scaled.fusionCount > flip.depth.maxProfitableFusions && flip.depth.available ? <p>此需求已超過目前符合 Min Profit 的可見市場深度。</p> : null}</div>
    <div className="detail-columns"><article><div className="modal-section-title"><div><span className="eyebrow">Scaled route for requested output</span><h3>合成路徑</h3></div><small>Crocodile 僅計入最終產量與 Profit</small></div><ul className="route-tree"><RouteTree node={scaled.route} /></ul></article>
      <article><div className="modal-section-title"><div><span className="eyebrow">For requested output</span><h3>本次需求原料</h3></div><small>所有數量均為整數</small></div><div className="material-total-list custom-materials">{scaled.materials.map((material) => <div key={material.productId}><span><strong>{material.name}</strong><code>{material.productId}</code></span><span><strong>{integer(material.quantity)} 個</strong><small>約 {formatCoins(material.quantity * material.unitCost)}</small></span></div>)}</div>
        <div className="modal-section-title depth-material-title"><div><span className="eyebrow">Buy to exhaust profitable depth</span><h3>清空獲利深度原料</h3></div></div><div className="material-total-list">{flip.depth.materialsRequired.length ? flip.depth.materialsRequired.map((material) => <div key={material.productId}><span><strong>{material.name}</strong><code>{material.productId}</code></span><span><strong>{integer(material.quantity)} 個</strong><small>約 {formatCoins(material.estimatedCost)}</small></span></div>) : <p>目前沒有符合 Min Profit 的可執行深度。</p>}</div></article></div>
    <footer><span>Min Profit：{minimumProfitLabel} = {formatCoins(minimumProfit)}</span><span>Min Flip Profit：{minimumFlipProfitLabel} = {formatCoins(minimumFlipProfit)}</span><span>限制：{flip.depth.limitedBy}{flip.depth.partial ? "（Hypixel 前 30 檔）" : ""}</span></footer>
  </section></div>;
}
