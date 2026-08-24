"use client";

import {
  calculateCraftProfitPlan,
  meetsCraftRequirement,
  type CraftFlip,
  type CraftProfitPlan,
  type CraftStrategy,
} from "@sky-turbo/core";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { DebouncedSearchField } from "./debounced-search-field";
import { CraftRequirementFilter } from "./craft-requirement-filter";
import { useCraftRequirementPreferences } from "./craft-requirement-preferences";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { useI18n } from "./i18n";
import { localizeMarketLimit } from "./localized-market-text";
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
  requirements: string[];
};

const strategyLabels: Record<CraftStrategy, string> = {
  "bo-so": "Buy Order → Sell Order",
  "ib-so": "Instant Buy → Sell Order",
  "bo-is": "Buy Order → Instant Sell",
  "ib-is": "Instant Buy → Instant Sell",
};

export function CraftDashboard() {
  const { locale, localeTag, number, t } = useI18n();
  const [strategy, setStrategy] = useState<CraftStrategy>("bo-so");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("maxProfit");
  const [minProfit, setMinProfit] = useState(0);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [data, setData] = useState<CraftResponse>({
    flips: [], skippedCount: 0, totalRecipes: 0, updatedAt: 0,
    recipeGeneratedAt: "", recipeCommit: "", priceModel: "", requirements: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoadedRef = useRef(false);
  const cacheRef = useRef(new Map<CraftStrategy, CraftResponse>());
  const { requirementLevels } = useCraftRequirementPreferences();

  const load = useCallback(async (signal: AbortSignal) => {
    const cached = cacheRef.current.get(strategy);
    if (cached) {
      setData(cached);
      hasLoadedRef.current = true;
    }
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const response = await fetch(`/api/v1/craft-flips?strategy=${strategy}&locale=${locale}`, { cache: "no-store", signal });
      const payload = await response.json() as { data?: Partial<CraftResponse>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? t("craft.loadFailed"));
      const next: CraftResponse = {
        flips: payload.data?.flips ?? [],
        skippedCount: payload.data?.skippedCount ?? 0,
        totalRecipes: payload.data?.totalRecipes ?? 0,
        updatedAt: payload.data?.updatedAt ?? Date.now(),
        recipeGeneratedAt: payload.data?.recipeGeneratedAt ?? "",
        recipeCommit: payload.data?.recipeCommit ?? "",
        priceModel: payload.data?.priceModel ?? "",
        requirements: payload.data?.requirements ?? [],
      };
      cacheRef.current.set(strategy, next);
      setData(next);
      hasLoadedRef.current = true;
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : t("craft.loadFailed"));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [locale, strategy, t]);
  const { refresh, refreshing } = useBackgroundRefresh(load, `craft-${strategy}-${locale}`);

  const displayed = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.flips.filter((flip) =>
      flip.profit >= minProfit &&
      meetsCraftRequirement(flip.requirement, requirementLevels) &&
      (!query || flip.name.toLowerCase().includes(query) || flip.productId.toLowerCase().includes(query) ||
        flip.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(query) || ingredient.productId.toLowerCase().includes(query))),
    ).sort((left, right) => sort === "maxProfit"
      ? right.depth.maxProfit - left.depth.maxProfit
      : right[sort] - left[sort]);
  }, [data.flips, minProfit, requirementLevels, search, sort]);

  const excludedFlipCount = useMemo(() => data.flips.reduce((count, flip) =>
    count + Number(!meetsCraftRequirement(flip.requirement, requirementLevels)), 0),
  [data.flips, requirementLevels]);

  const selectedFlip = useMemo(() => selectedRecipeId
    ? data.flips.find((flip) => flip.recipeId === selectedRecipeId) ?? null
    : null, [data.flips, selectedRecipeId]);

  return <>
    <div className="toolbar panel craft-toolbar">
      <DebouncedSearchField onSearch={setSearch} placeholder={t("craft.search")} />
      <label><span>{t("common.strategy")}</span><select value={strategy} onChange={(event) => setStrategy(event.target.value as CraftStrategy)}>
        {Object.entries(strategyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><span>{t("common.sort")}</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
        <option value="maxProfit">{t("common.maxProfit")}</option>
        <option value="profit">{t("craft.singleProfit")}</option>
        <option value="profitPerOutput">{t("craft.profitPerOutput")}</option>
        <option value="marginPercent">{t("common.margin")} (%)</option>
        <option value="matchedVolume7d">{t("craft.volume")}</option>
        <option value="inputCost">{t("craft.inputCost")}</option>
      </select></label>
      <label><span>Min Profit</span><input type="number" min="0" step="100" value={minProfit} onChange={(event) => setMinProfit(Math.max(0, Number(event.target.value) || 0))} /></label>
      <RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} />
      <CraftRequirementFilter requirements={data.requirements} />
    </div>
    <div className="depth-note"><span>{t("craft.profitable", { count: number(displayed.length), total: number(data.totalRecipes), excluded: excludedFlipCount > 0 ? t("craft.excluded", { count: number(excludedFlipCount) }) : "" })}</span><span className={error && hasLoadedRef.current ? "negative" : undefined}>{error && hasLoadedRef.current ? error : data.priceModel || t("craft.loading")}</span></div>
    {loading && !hasLoadedRef.current
      ? <div className="state-card"><span className="spinner" />{t("craft.loading")}</div>
      : error && !hasLoadedRef.current
        ? <div className="state-card error-state">{error}</div>
        : <div className="market-table-wrap panel"><table className="market-table craft-table"><thead><tr>
          <th>{t("common.output")}</th><th>{t("craft.materials")}</th><th>{t("craft.output")}</th><th>{t("craft.inputCost")}</th><th>{t("craft.afterTaxRevenue")}</th><th>{t("craft.singleProfit")}</th><th>{t("craft.volume")}</th><th>{t("common.maxProfit")}</th>
        </tr></thead><tbody>{displayed.slice(0, 300).map((flip) => {
          const plan = calculateCraftProfitPlan(flip);
          return <tr key={flip.recipeId}>
          <td><button className="craft-item-button" type="button" onClick={() => setSelectedRecipeId(flip.recipeId)}><span className="item-cell"><ItemIcon name={flip.name} productId={flip.productId} /><span><strong>{flip.name}</strong><small>{flip.productId}</small></span></span></button></td>
          <td><span className="stack craft-materials">{flip.ingredients.map((ingredient) => <span key={ingredient.productId}><strong>{number(ingredient.amount)}× {ingredient.name}</strong><small>{formatCoins(ingredient.unitCost, true, localeTag)}/ea · {formatCoins(ingredient.totalCost, true, localeTag)}</small></span>)}</span></td>
          <td><span className="stack"><strong>{number(flip.outputAmount)}</strong>{flip.requirement ? <small>{flip.requirement}</small> : null}</span></td>
          <td>{formatCoins(flip.inputCost, true, localeTag)}</td>
          <td><span className="stack"><strong>{formatCoins(flip.revenueAfterTax, true, localeTag)}</strong><small>{t("craft.afterBazaarTax")}</small></span></td>
          <td><span className={`stack ${tone(flip.profit)}`}><strong>{formatCoins(flip.profit, true, localeTag)}</strong><small>{formatCoins(flip.profitPerOutput, true, localeTag)}/ea · {formatPercent(flip.marginPercent, t("common.accumulating"))}</small></span></td>
          <td><span className="stack"><strong>{number(flip.matchedVolume7d)}</strong><small>{t("market.volume7d")}</small></span></td>
          <td>{plan ? <span className="stack craft-max-profit"><strong className={tone(plan.totalProfit)}>{formatCoins(plan.totalProfit, true, localeTag)}</strong><small>{number(plan.craftCount)} Crafts · {number(plan.outputQuantity)} {t("common.output")} · {t("market.volume7d")}</small><CraftPlanMaterials plan={plan} compact localeTag={localeTag} /><button className="detail-button" type="button" onClick={() => setSelectedRecipeId(flip.recipeId)}>{t("common.viewDetail")}</button></span> : <span className="stack"><strong>{t("common.unavailable")}</strong><small>{localizeMarketLimit(flip.depth.limitedBy, locale)}</small><button className="detail-button" type="button" onClick={() => setSelectedRecipeId(flip.recipeId)}>{t("common.viewDetail")}</button></span>}</td>
        </tr>;
        })}</tbody></table>{displayed.length === 0 ? <div className="empty-state">{t("craft.noMatches")}</div> : null}</div>}
    {selectedFlip ? <CraftFlipDetailModal flip={selectedFlip} onClose={() => setSelectedRecipeId(null)} /> : null}
    <p className="npc-disclaimer">{t("craft.disclaimer")}</p>
  </>;
}

function CraftPlanMaterials({ plan, compact = false, localeTag }: { plan: CraftProfitPlan; compact?: boolean; localeTag: string }) {
  return <span className={`stack craft-materials${compact ? " compact" : ""}`}>{plan.ingredients.map((ingredient) => <span key={ingredient.productId}><strong>{new Intl.NumberFormat(localeTag).format(ingredient.amount)}× {ingredient.name}</strong>{compact ? null : <small>{formatCoins(ingredient.unitCost, true, localeTag)}/ea · {formatCoins(ingredient.totalCost, true, localeTag)}</small>}</span>)}</span>;
}

function CraftFlipDetailModal({ flip, onClose }: { flip: CraftFlip; onClose: () => void }) {
  const { locale, localeTag, number, t } = useI18n();
  const [fraction, setFraction] = useState<1 | 0.8>(1);
  const plan = calculateCraftProfitPlan(flip, fraction);
  return <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="shard-detail-modal npc-detail-modal craft-detail-modal panel" role="dialog" aria-modal="true" aria-labelledby="craft-detail-title">
    <header><div><span className="eyebrow">{t("craft.details")}</span><h2 id="craft-detail-title">{flip.name}</h2><code>{flip.productId} · {strategyLabels[flip.strategy]}</code></div><button type="button" aria-label={t("common.close")} onClick={onClose}>×</button></header>
    {plan ? <><div className="detail-profit-grid"><div><span>{t("craft.craftsRequired")}</span><strong>{number(plan.craftCount)} {t("common.times")}</strong></div><div><span>{t("common.output")}</span><strong>{number(plan.outputQuantity)} {t("common.pieces")}</strong></div><div><span>{t("craft.materialCost")}</span><strong>{formatCoins(plan.inputCost, true, localeTag)}</strong></div><div><span>{fraction === 1 ? t("common.maxProfit") : "80% Target Profit"}</span><strong className={tone(plan.totalProfit)}>{formatCoins(plan.totalProfit, true, localeTag)}</strong></div></div>
      <div className="route-multiplier npc-plan-controls craft-plan-controls"><label><span>{t("craft.planTarget")}</span><select value={fraction} onChange={(event) => setFraction(Number(event.target.value) as 1 | 0.8)}><option value={1}>{t("craft.fullTarget")}</option><option value={0.8}>{t("craft.eightyTarget")}</option></select></label><div><span>{t("common.strategy")}</span><strong>{strategyLabels[flip.strategy]}</strong></div><div><span>{t("npc.revenueAfterTax")}</span><strong>{formatCoins(plan.revenueAfterTax, true, localeTag)}</strong></div></div>
      <div className="detail-columns"><article><div className="modal-section-title"><div><span className="eyebrow">{t("craft.requiredMaterials")}</span><h3>{fraction === 1 ? t("craft.requiredMaterials") : t("npc.requiredCostsEighty")}</h3></div><small>{t("craft.instantDepth")}</small></div><div className="material-total-list">{plan.ingredients.map((ingredient) => <div key={ingredient.productId}><span><strong>{ingredient.name}</strong><code>{ingredient.productId} · {t("common.perEach")} {number(ingredient.amount / plan.craftCount)}</code></span><span><strong>{number(ingredient.amount)} {t("common.pieces")}</strong><small>{formatCoins(ingredient.totalCost, true, localeTag)} · {formatCoins(ingredient.unitCost, true, localeTag)}{t("common.perEach")}</small></span></div>)}</div></article>
        <article><div className="modal-section-title"><div><span className="eyebrow">{t("craft.depthAudit")}</span><h3>{t("craft.limitRevenue")}</h3></div></div><div className="material-total-list"><div><span><strong>{t("craft.maxCrafts")}</strong><small>{localizeMarketLimit(flip.depth.limitedBy, locale)}</small></span><span><strong>{number(flip.depth.maxCrafts)} {t("common.times")}</strong><small>{flip.depth.partial ? t("craft.depthPartial") : t("craft.depthComplete")}</small></span></div><div><span><strong>{t("craft.singleProfitDetail")}</strong><small>{formatPercent(flip.marginPercent)} {t("common.margin")}</small></span><span><strong className={tone(flip.profit)}>{formatCoins(flip.profit, true, localeTag)}</strong><small>{formatCoins(flip.profitPerOutput, true, localeTag)} {t("craft.profitPerOutput")}</small></span></div><div><span><strong>{t("craft.planProfit")}</strong><small>{number(plan.outputQuantity)} {t("common.output")}</small></span><span><strong className={tone(plan.totalProfit)}>{formatCoins(plan.totalProfit, true, localeTag)}</strong><small>{t("common.cost")} {formatCoins(plan.inputCost, true, localeTag)}</small></span></div></div><p className="npc-detail-source">{t("craft.recipeSource")} <a className="source-link" href={flip.source.url} target="_blank" rel="noreferrer">NEU recipe</a><br /><Link className="source-link" href={`/items/${encodeURIComponent(flip.productId)}`}>{t("craft.viewItem")}</Link></p></article></div></>
    : <div className="empty-state">{t("craft.noPlan")}</div>}
    <footer><span>{t("craft.eightyNote")}</span><span>{t("craft.liquidityNote")}</span></footer>
  </section></div>;
}
