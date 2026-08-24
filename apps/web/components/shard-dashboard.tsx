"use client";

import {
  collectShardRouteMaterials,
  defaultShardDesiredOutput,
  parseCompactNumber,
  scaleShardRouteForOutput,
  type MarketFilterKey,
  type MinProfitThreshold,
  type ShardFlip,
  type ShardRouteNode,
  type ShardStrategy,
} from "@sky-turbo/core";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { useI18n } from "./i18n";
import { localizeMarketLimit } from "./localized-market-text";
import {
  appendMarketFilters,
  createShardVolumeFilters,
  MarketFilterPanel,
  type MarketFilterDrafts,
} from "./market-filter-panel";
import { RefreshButton } from "./refresh-button";
import { useBackgroundRefresh } from "./use-background-refresh";

type SortKey = "fusionCoins" | "profitPerOutput" | "marginPercent" | "maxOutput" | "maxFusions" | "inputCost";
type ShardResponseData = { flips: ShardFlip[]; depthModel: string; updatedAt: number };

const strategyLabels: Record<ShardStrategy, string> = {
  "bo-so": "Buy Order → Sell Order",
  "ib-so": "Instant Buy → Sell Order",
  "bo-is": "Buy Order → Instant Sell",
  "ib-is": "Instant Buy → Instant Sell",
};
const shardFilterKeys: MarketFilterKey[] = ["sellVolume", "buyVolume", "totalVolume"];

function coinsPerFusion(flip: ShardFlip): number {
  return flip.depth.maxProfitableFusions > 0
    ? flip.depth.totalProfit / flip.depth.maxProfitableFusions
    : 0;
}

export function ShardDashboard() {
  const { locale, localeTag, number, t, time } = useI18n();
  const [strategy, setStrategy] = useState<ShardStrategy>("bo-so");
  const [level, setLevel] = useState(10);
  const [search, setSearch] = useState("");
  const updateSearch = useCallback((value: string) => setSearch(value), []);
  const [sort, setSort] = useState<SortKey>("fusionCoins");
  const [minProfit, setMinProfit] = useState<MinProfitThreshold>({ mode: "percent", value: 0.1 });
  const [minFlipProfit, setMinFlipProfit] = useState<MinProfitThreshold>({ mode: "percent", value: 80 });
  const [maxFusions, setMaxFusions] = useState<number | undefined>(undefined);
  const [filters, setFilters] = useState<MarketFilterDrafts>(createShardVolumeFilters);
  const [flips, setFlips] = useState<ShardFlip[]>([]);
  const [depthModel, setDepthModel] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedShardId, setSelectedShardId] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  const responseCacheRef = useRef(new Map<string, ShardResponseData>());

  const requestUrl = useMemo(() => {
    const query = new URLSearchParams({
      strategy,
      crocodileLevel: String(level),
      minProfitMode: minProfit.mode,
      minProfitValue: String(minProfit.value),
      minFlipProfitMode: minFlipProfit.mode,
      minFlipProfitValue: String(minFlipProfit.value),
      locale,
    });
    if (maxFusions !== undefined) query.set("maxFusions", String(maxFusions));
    appendMarketFilters(query, filters);
    return `/api/v1/shard-flips?${query}`;
  }, [filters, level, locale, maxFusions, minFlipProfit, minProfit, strategy]);

  const loadFlips = useCallback(async (signal: AbortSignal) => {
    const cached = responseCacheRef.current.get(requestUrl);
    if (cached) {
      setFlips(cached.flips);
      setDepthModel(cached.depthModel);
      setUpdatedAt(cached.updatedAt);
      hasLoadedRef.current = true;
    }
    const blocking = !hasLoadedRef.current;
    setLoading(blocking);
    try {
      const response = await fetch(requestUrl, { cache: "no-store", signal });
      const payload = (await response.json()) as {
          data?: { flips?: ShardFlip[]; depthModel?: string; updatedAt?: number };
          error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? t("shard.loadFailed"));
      const data = {
        flips: payload.data?.flips ?? [],
        depthModel: payload.data?.depthModel ?? "",
        updatedAt: payload.data?.updatedAt ?? Date.now(),
      };
      responseCacheRef.current.set(requestUrl, data);
      hasLoadedRef.current = true;
      setFlips(data.flips);
      setDepthModel(data.depthModel);
      setUpdatedAt(data.updatedAt);
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : t("shard.loadFailed"));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [requestUrl, t]);
  const { refresh, refreshing } = useBackgroundRefresh(loadFlips, requestUrl);

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
        if (sort === "fusionCoins") return coinsPerFusion(right) - coinsPerFusion(left);
        if (sort === "maxOutput") return right.depth.maxProfitableOutput - left.depth.maxProfitableOutput;
        if (sort === "maxFusions") return right.depth.maxProfitableFusions - left.depth.maxProfitableFusions;
        return right[sort] - left[sort];
      });
  }, [flips, search, sort]);

  return <>
    <div className="toolbar panel shard-controls">
      <label><span>{t("common.strategy")}</span><select value={strategy} onChange={(event) => setStrategy(event.target.value as ShardStrategy)}>
        {Object.entries(strategyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="level-control">
        <span className="level-heading">{t("shard.crocodileLevel")}: <strong>{level}</strong></span>
        <div className="range-scale"><input aria-label={t("shard.crocodileLevel")} type="range" min="0" max="10" step="1" value={level} onChange={(event) => setLevel(Number(event.target.value))} /><div className="range-scale-labels" aria-hidden="true"><span>0</span><span>10</span></div></div>
      </label>
      <div className="ev-note"><span>{t("shard.reptileEv")}</span><strong>× {(1 + level * 0.02).toFixed(2)}</strong><small>{t("shard.evNote")}</small></div>
    </div>
    <div className="toolbar panel shard-filter-toolbar">
      <DebouncedSearchField onSearch={updateSearch} placeholder={t("shard.search")} />
      <label><span>{t("common.sort")}</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
        <option value="fusionCoins">Fusion / coins</option>
        <option value="profitPerOutput">{t("craft.profitPerOutput")}</option>
        <option value="marginPercent">{t("common.margin")} (%)</option>
        <option value="maxOutput">{t("shard.maxOutput")}</option>
        <option value="maxFusions">{t("shard.maxFusions")}</option>
        <option value="inputCost">{t("craft.inputCost")}</option>
      </select></label>
      <MaxFusionControl value={maxFusions} onApply={setMaxFusions} />
      <ProfitThresholdControl label="Min Profit" percentOption="% of cost" value={minProfit} onApply={setMinProfit} />
      <ProfitThresholdControl label="Min Flip Profit" percentOption="% of max" value={minFlipProfit} onApply={setMinFlipProfit} />
      <MarketFilterPanel
        summary={t("shard.filterSummary")}
        explanation={t("shard.filterExplanation")}
        applyLabel={t("shard.applyFilters")}
        visibleKeys={shardFilterKeys}
        initialFilters={createShardVolumeFilters()}
        onApply={setFilters}
      />
      <RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} />
    </div>
    <div className="depth-note"><span>{t("shard.routes", { count: number(displayedFlips.length) })}{updatedAt > 0 ? ` · ${t("common.updated", { time: time(updatedAt) })}` : ""}</span><span className={error && hasLoadedRef.current ? "negative" : undefined}>{error && hasLoadedRef.current ? error : depthModel || t("shard.depthModel")}</span></div>
    {loading ? <div className="state-card"><span className="spinner" />{t("shard.loading")}</div> : error && !hasLoadedRef.current ? <div className="state-card error-state">{error}</div> :
      <div className="market-table-wrap panel"><table className="market-table shard-table"><thead><tr><th>{t("shard.outputShard")}</th><th className="change-volume-heading">{t("market.changeVolume")}</th><th>{t("shard.materials")}</th><th>{t("craft.output")}</th><th>{t("common.cost")}</th><th>Fusion / coins</th><th>{t("common.totalProfit")}</th><th>{t("common.viewDetail")}</th></tr></thead><tbody>
        {displayedFlips.slice(0, 300).map((flip) => <tr key={flip.shardId}><td><Link className="item-cell" href={`/items/${encodeURIComponent(flip.productId)}`}><ItemIcon name={flip.name} productId={flip.productId} /><span><strong>{flip.name}</strong><small>{flip.family} · {flip.rarity}</small></span></Link></td>
          <td><span className={`stack change-volume ${tone(flip.change24h)}`}><strong>{formatPercent(flip.change24h, t("common.accumulating"))}</strong><small className="neutral">{flip.volatility7d === undefined ? t("common.accumulating") : t("shard.volatility", { value: `${flip.volatility7d.toFixed(2)}%` })}</small></span></td>
          <td><span className="stack route-materials">{flip.materials.slice(0, 2).map((material) => <strong key={material.productId}>{number(material.quantityPerFusion)}× {material.name}</strong>)}{flip.materials.length > 2 ? <small>{t("shard.moreMaterials", { count: number(flip.materials.length - 2) })}</small> : <small>{t("shard.directMaterials")}</small>}</span></td>
          <td>{flip.expectedOutput.toFixed(2)} {flip.crocodileApplied && flip.crocodileLevel > 0 ? <span className="ev-badge">EV</span> : null}</td>
          <td>{formatCoins(flip.inputCost, true, localeTag)}</td>
          <td>{flip.depth.available ? <span className={`stack ${tone(coinsPerFusion(flip))}`}><strong>{number(flip.depth.maxProfitableFusions)} {t("shard.fusionCoins")} {formatCoins(coinsPerFusion(flip), true, localeTag)} {t("common.coins")}</strong><small>{t("shard.perFusion")}</small></span> : <span className="stack neutral"><strong>{t("common.unavailable")}</strong><small>{localizeMarketLimit(flip.depth.limitedBy, locale)}</small></span>}</td>
          <td className="shard-depth">{flip.depth.available ? <span className="stack"><strong className={tone(flip.depth.totalProfit)}>{formatCoins(flip.depth.totalProfit, true, localeTag)}</strong><small>≈ {formatCoins(flip.depth.maxProfitableOutput, true, localeTag)} {t("common.output")} · {localizeMarketLimit(flip.depth.limitedBy, locale)}{flip.depth.partial ? " · Top 30" : ""}</small></span> : <span className="stack neutral"><strong>{t("common.unavailable")}</strong><small>{localizeMarketLimit(flip.depth.limitedBy, locale)}</small></span>}</td>
          <td><button className="detail-button" type="button" onClick={() => setSelectedShardId(flip.shardId)}>{t("common.viewDetail")}</button></td>
        </tr>)}
      </tbody></table>{displayedFlips.length === 0 ? <div className="empty-state">{t("shard.noRoutes")}</div> : null}</div>}
    {selectedFlip ? <ShardDetailModal flip={selectedFlip} onClose={() => setSelectedShardId(null)} /> : null}
  </>;
}

function MaxFusionControl({
  value,
  onApply,
}: {
  value: number | undefined;
  onApply: (value: number | undefined) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const commit = () => {
    const parsed = parseCompactNumber(draft);
    const next = parsed === undefined ? undefined : Math.max(0, Math.floor(parsed));
    setDraft(next === undefined ? "" : String(next));
    onApply(next);
  };
  return <label className="max-fusion-control"><span>{t("shard.maxFusionLimit")}</span><input aria-label={t("shard.maxFusionLimit")} type="text" inputMode="numeric" placeholder={t("shard.unlimited")} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
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
  const { t } = useI18n();
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
  return <label className="min-profit-control"><span>{label}</span><span className="min-profit-input"><input aria-label={`${label} ${t("item.amount")}`} type="text" inputMode="text" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><select aria-label={`${label} unit`} value={value.mode} onChange={(event) => { const mode = event.target.value as MinProfitThreshold["mode"]; const next = parseDraft(mode); setDraft(String(next)); onApply({ mode, value: next }); }}><option value="percent">{percentOption}</option><option value="coins">$</option></select></span></label>;
}

function RouteTree({ node }: { node: ShardRouteNode }) {
  const { locale, localeTag, number, t } = useI18n();
  if (node.kind === "market") {
    return <li className="route-node market-node"><span>{t("shard.buy")}</span><strong>{number(node.quantity)}× {node.name}</strong><small>{formatCoins(node.unitCost, true, localeTag)} {t("common.perEach")}</small></li>;
  }
  return <li className="route-node fusion-node"><span>Fusion</span><strong>{number(node.fusionCount)} {t("common.times")} · {node.name}</strong><small>{t("shard.baseExpectedOutput", { base: number(node.fusionCount * node.baseOutput), expected: node.expectedOutput.toFixed(2) })}</small><ul>{node.inputs.map((input, index) => <RouteTree node={input} key={`${input.shardId}-${index}`} />)}</ul></li>;
}

function ShardDetailModal({ flip, onClose }: { flip: ShardFlip; onClose: () => void }) {
  const { locale, localeTag, number, t } = useI18n();
  const defaultDesiredOutput = defaultShardDesiredOutput(flip);
  const [desiredOutputText, setDesiredOutputText] = useState(String(defaultDesiredOutput));
  const desiredOutput = Math.max(
    0,
    Math.ceil(parseCompactNumber(desiredOutputText) ?? defaultDesiredOutput),
  );
  const scaled = useMemo(() => {
    if (flip.route.kind !== "fusion") {
      return { route: flip.route, fusionCount: 0, totalFusionCount: 0, expectedOutput: flip.expectedOutput, materials: collectShardRouteMaterials(flip.route), inputCost: flip.inputCost, profit: flip.profit };
    }
    const { route, fusionCount, totalFusionCount, expectedOutput } = scaleShardRouteForOutput(
      flip.route,
      desiredOutput,
    );
    const materials = collectShardRouteMaterials(route);
    const inputCost = materials.reduce((sum, material) => sum + material.quantity * material.unitCost, 0);
    const revenueAfterTax = flip.revenueAfterTax * fusionCount;
    return { route, fusionCount, totalFusionCount, expectedOutput, materials, inputCost, profit: revenueAfterTax - inputCost };
  }, [desiredOutput, flip]);
  const minimumProfit = flip.depth.minProfit.mode === "percent"
    ? flip.depth.totalInputCost * (flip.depth.minProfit.value / 100)
    : flip.depth.minProfit.value;
  const minimumProfitLabel = flip.depth.minProfit.mode === "percent"
    ? `${flip.depth.minProfit.value}% × ${t("shard.totalMaterialCost")}`
    : `${formatCoins(flip.depth.minProfit.value, true, localeTag)} ${t("common.coins")}`;
  const minimumFlipProfit = flip.depth.minFlipProfit.mode === "percent"
    ? flip.depth.maxFlipProfit * (flip.depth.minFlipProfit.value / 100)
    : flip.depth.minFlipProfit.value;
  const minimumFlipProfitLabel = flip.depth.minFlipProfit.mode === "percent"
    ? `${flip.depth.minFlipProfit.value}% × ${t("npc.singleProfit")} ${formatCoins(flip.depth.maxFlipProfit, true, localeTag)}`
    : `${formatCoins(flip.depth.minFlipProfit.value, true, localeTag)} ${t("common.coins")}`;
  return <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="shard-detail-modal panel" role="dialog" aria-modal="true" aria-labelledby="shard-detail-title">
    <header><div><span className="eyebrow">{t("shard.detail")}</span><h2 id="shard-detail-title">{flip.name}</h2><code>{flip.productId}</code></div><button type="button" aria-label={t("common.close")} onClick={onClose}>×</button></header>
    <div className="detail-profit-grid"><div><span>{t("shard.actualMaxFusions")}</span><strong>{number(flip.depth.maxProfitableFusions)} {t("common.times")}</strong></div><div><span>{t("shard.expectedOutput")}</span><strong>{flip.depth.maxProfitableOutput.toFixed(2)}</strong></div><div><span>{t("shard.totalMaterialCost")}</span><strong>{formatCoins(flip.depth.totalInputCost, true, localeTag)}</strong></div><div><span>{t("shard.depthTotalProfit")}</span><strong className={tone(flip.depth.totalProfit)}>{formatCoins(flip.depth.totalProfit, true, localeTag)}</strong></div></div>
    <div className="route-multiplier"><label><span>{t("shard.desiredOutput")}</span><input type="text" inputMode="text" value={desiredOutputText} onChange={(event) => setDesiredOutputText(event.target.value)} /></label><div><span>{t("shard.totalFusions")}</span><strong>{number(scaled.totalFusionCount)} {t("common.times")}</strong></div><div><span>{t("shard.actualOutput")}</span><strong>{scaled.expectedOutput.toFixed(2)}</strong></div><div><span>{t("shard.requestProfit")}</span><strong className={tone(scaled.profit)}>{formatCoins(scaled.profit, true, localeTag)}</strong></div>{scaled.totalFusionCount > flip.depth.maxProfitableFusions && flip.depth.available ? <p>{t("shard.overDepth")}</p> : null}</div>
    <div className="detail-columns"><article><div className="modal-section-title"><div><span className="eyebrow">{t("shard.desiredOutput")}</span><h3>{t("shard.route")}</h3></div><small>{t("shard.crocodileNote")}</small></div><ul className="route-tree"><RouteTree node={scaled.route} /></ul></article>
      <article><div className="modal-section-title"><div><span className="eyebrow">{t("shard.desiredOutput")}</span><h3>{t("shard.requestMaterials")}</h3></div><small>{t("shard.integerOnly")}</small></div><div className="material-total-list custom-materials">{scaled.materials.map((material) => <div key={material.productId}><span><strong>{material.name}</strong><code>{material.productId}</code></span><span><strong>{number(material.quantity)} {t("common.pieces")}</strong><small>{t("common.estimated", { value: formatCoins(material.quantity * material.unitCost, true, localeTag) })}</small></span></div>)}</div>
        <div className="modal-section-title depth-material-title"><div><span className="eyebrow">{t("common.marketDepth")}</span><h3>{t("shard.exhaustMaterials")}</h3></div></div><div className="material-total-list">{flip.depth.materialsRequired.length ? flip.depth.materialsRequired.map((material) => <div key={material.productId}><span><strong>{material.name}</strong><code>{material.productId}</code></span><span><strong>{number(material.quantity)} {t("common.pieces")}</strong><small>{t("common.estimated", { value: formatCoins(material.estimatedCost, true, localeTag) })}</small></span></div>) : <p>{t("shard.noDepth")}</p>}</div></article></div>
    <footer><span>{t("shard.maxFusionLimit")}: {flip.depth.maxFusionLimit === undefined ? t("shard.unlimited") : `${number(flip.depth.maxFusionLimit)} ${t("common.times")}`}</span><span>{t("shard.minProfit")}: {minimumProfitLabel} = {formatCoins(minimumProfit, true, localeTag)}</span><span>{t("shard.minFlipProfit")}: {minimumFlipProfitLabel} = {formatCoins(minimumFlipProfit, true, localeTag)}</span><span>{t("common.limit")}: {localizeMarketLimit(flip.depth.limitedBy, locale)}{flip.depth.partial ? ` (${t("common.first30")})` : ""}</span></footer>
  </section></div>;
}
