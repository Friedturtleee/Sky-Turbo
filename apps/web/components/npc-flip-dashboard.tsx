"use client";

import {
  calculateNpcProfitPlan,
  type NpcFlip,
  type NpcMayorContext,
  type NpcStrategy,
} from "@sky-turbo/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { useI18n } from "./i18n";
import { localizeMarketLimit } from "./localized-market-text";
import { RefreshButton } from "./refresh-button";
import { useBackgroundRefresh } from "./use-background-refresh";

type SortKey = "maxDailyProfit" | "profit" | "marginPercent" | "salePriceNet" | "totalCost";
type MarketFilter = "all" | "bazaar" | "ah-lowest-bin";
type NpcFlipResponse = {
  flips: NpcFlip[];
  unpricedCount: number;
  updatedAt: number;
  shopDataGeneratedAt: string;
  priceModel: string;
  mayor: NpcMayorContext;
};

const unknownMayor: NpcMayorContext = {
  name: "Unknown",
  lastUpdated: 0,
  shoppingSpreeActive: false,
  derpyActive: false,
  bazaarTaxMultiplier: 1,
};

function strategyLabel(flip: NpcFlip, t: ReturnType<typeof useI18n>["t"]): string {
  if (flip.saleSource === "bazaar") return t(`strategy.${flip.strategy}`);
  return `${flip.strategy.startsWith("ib") ? "Instant Buy" : "Buy Order"} → AH`;
}

function bazaarCostLabel(strategy: NpcStrategy): string {
  return strategy.startsWith("ib") ? "BZ insta buy" : "BZ buy order";
}

function productReference(productId: string, t: ReturnType<typeof useI18n>["t"]): string {
  if (productId === "INK_SACK:3") return t("npc.cocoaLegacy");
  return productId;
}

function limitSourceLabel(source: NpcFlip["dailyLimitSource"], t: ReturnType<typeof useI18n>["t"]): string {
  if (source === "shop-stock") return t("npc.shopStock");
  if (source === "standard-shop-limit") return t("npc.standardLimit");
  if (source === "manual-wiki") return t("npc.wikiData");
  return t("npc.noLimitSource");
}

export function NpcFlipDashboard() {
  const { locale, localeTag, number, t, time } = useI18n();
  const [data, setData] = useState<NpcFlipResponse>({
    flips: [], unpricedCount: 0, updatedAt: 0, shopDataGeneratedAt: "", priceModel: "", mayor: unknownMayor,
  });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("maxDailyProfit");
  const [strategy, setStrategy] = useState<NpcStrategy>("bo-so");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [conditionalBonusActive, setConditionalBonusActive] = useState(true);
  const [minProfit, setMinProfit] = useState(0);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const response = await fetch(`/api/v1/npc-flips?strategy=${strategy}&locale=${locale}`, { cache: "no-store", signal });
      const payload = await response.json() as { data?: Partial<NpcFlipResponse>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? t("npc.loadFailed"));
      setData({
        flips: payload.data?.flips ?? [],
        unpricedCount: payload.data?.unpricedCount ?? 0,
        updatedAt: payload.data?.updatedAt ?? Date.now(),
        shopDataGeneratedAt: payload.data?.shopDataGeneratedAt ?? "",
        priceModel: payload.data?.priceModel ?? "",
        mayor: payload.data?.mayor ?? unknownMayor,
      });
      hasLoadedRef.current = true;
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : t("npc.loadFailed"));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [locale, strategy, t]);
  const { refresh, refreshing } = useBackgroundRefresh(load, `npc-flips-${strategy}-${locale}`);
  const diazActive = data.mayor.shoppingSpreeActive;

  const planFor = useCallback((flip: NpcFlip, fraction: 1 | 0.8 = 1) => calculateNpcProfitPlan(flip, {
    diazActive,
    conditionalBonusActive,
    fraction,
  }), [conditionalBonusActive, diazActive]);

  const displayedFlips = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.flips.filter((flip) =>
      flip.maxProfitPerPurchase >= minProfit
      && (marketFilter === "all" || flip.saleSource === marketFilter)
      && (!query || flip.name.toLowerCase().includes(query) || flip.productId.toLowerCase().includes(query)
        || flip.npc.toLowerCase().includes(query) || flip.costs.some((cost) => cost.name.toLowerCase().includes(query))),
    ).sort((left, right) => {
      if (sort === "maxDailyProfit") return (planFor(right)?.totalProfit ?? Number.NEGATIVE_INFINITY)
        - (planFor(left)?.totalProfit ?? Number.NEGATIVE_INFINITY);
      if (sort === "profit") return right.maxProfitPerPurchase - left.maxProfitPerPurchase;
      return right[sort] - left[sort];
    });
  }, [data.flips, marketFilter, minProfit, planFor, search, sort]);

  const selectedFlip = useMemo(() => selectedOfferId
    ? data.flips.find((flip) => flip.offerId === selectedOfferId) ?? null
    : null, [data.flips, selectedOfferId]);

  return <>
    <div className="toolbar panel npc-flip-toolbar">
      <DebouncedSearchField onSearch={setSearch} placeholder={t("npc.search")} />
      <label><span>{t("common.sort")}</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
        <option value="maxDailyProfit">{t("common.maxProfit")}</option><option value="profit">{t("npc.singleProfit")}</option>
        <option value="marginPercent">{t("common.margin")} (%)</option><option value="salePriceNet">{t("npc.netSale")}</option><option value="totalCost">{t("npc.singleCost")}</option>
      </select></label>
      <label><span>{t("common.strategy")}</span><select value={strategy} onChange={(event) => setStrategy(event.target.value as NpcStrategy)}>
        <option value="bo-so">{t("strategy.bo-so")}</option><option value="ib-so">{t("strategy.ib-so")}</option><option value="bo-is">{t("strategy.bo-is")}</option><option value="ib-is">{t("strategy.ib-is")}</option>
      </select></label>
      <label><span>{t("npc.marketFilter")}</span><select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value as MarketFilter)}>
        <option value="all">{t("npc.allMarkets")}</option><option value="bazaar">Bazaar</option><option value="ah-lowest-bin">Auction House</option>
      </select></label>
      <label><span>Min {t("npc.singleProfit")}</span><input type="number" min="0" step="100" value={minProfit} onChange={(event) => setMinProfit(Math.max(0, Number(event.target.value) || 0))} /></label>
      <label className="npc-bonus-toggle"><input type="checkbox" checked={conditionalBonusActive} onChange={(event) => setConditionalBonusActive(event.target.checked)} /><span>{t("npc.kiara")}</span></label>
      <RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} />
    </div>
    <div className="depth-note npc-price-note"><span>{t("npc.priced", { count: number(displayedFlips.length) })} · {t("npc.unpriced", { count: number(data.unpricedCount) })}{data.updatedAt ? ` · ${t("common.updated", { time: time(data.updatedAt) })}` : ""}</span><span className={error && hasLoadedRef.current ? "negative" : undefined}>{error && hasLoadedRef.current ? error : data.priceModel || t("npc.priceModel")}</span></div>
    {loading && !hasLoadedRef.current
      ? <div className="state-card"><span className="spinner" />{t("npc.loading")}</div>
      : error && !hasLoadedRef.current
        ? <div className="state-card error-state">{error}</div>
        : <div className="market-table-wrap panel npc-table-panel"><table className="market-table npc-flip-table"><thead><tr>
          <th>{t("npc.product")}</th><th>NPC</th><th>{t("npc.purchaseNeeds")}</th><th>{t("npc.singleCost")}</th><th>{t("npc.netSale")}</th><th>{t("npc.sales7d")}</th><th>{t("npc.singleProfit")}</th><th>{t("npc.executionLimit")}</th><th>{t("common.maxProfit")}</th>
        </tr></thead><tbody>{displayedFlips.slice(0, 300).map((flip) => {
          const plan = planFor(flip);
          return <tr key={flip.offerId}>
            <td data-label={t("npc.product")}><button className="npc-item-button" type="button" onClick={() => setSelectedOfferId(flip.offerId)}><span className="item-cell"><ItemIcon name={flip.name} productId={flip.productId} /><span><strong>{flip.quantity > 1 ? `${flip.quantity}× ` : ""}{flip.name}</strong><small>{productReference(flip.productId, t)}</small></span></span></button></td>
            <td data-label="NPC"><span className="stack"><strong>{flip.npc}</strong>{flip.requirement ? <small>{flip.requirement}</small> : null}</span></td>
            <td data-label={t("npc.purchaseNeeds")}><CostList costs={flip.costs.map((cost) => ({ name: cost.name, amount: cost.amount, totalPrice: cost.totalPrice, priceSource: cost.priceSource }))} bazaarLabel={bazaarCostLabel(flip.strategy)} localeTag={localeTag} /></td>
            <td data-label={t("npc.singleCost")}>{formatCoins(flip.totalCost, true, localeTag)}</td>
            <td data-label={t("npc.netSale")}><SalePrice flip={flip} /></td>
            <td data-label={t("npc.sales7d")}>{flip.saleSource === "bazaar"
              ? <span className="stack"><strong>{number(flip.bazaarMatchedVolume7d ?? 0)}</strong><small>{t("npc.bazaarSales")}</small></span>
              : flip.ahSalesLast7d === undefined ? <span className="neutral">{t("common.accumulating")}</span> : <span className="stack"><strong>{number(flip.ahSalesLast7d)} {t("common.times")}</strong><small>{t("npc.ahSales")}</small></span>}</td>
            <td data-label={t("npc.singleProfit")}><span className={`stack ${tone(flip.maxProfitPerPurchase)}`}><strong>{formatCoins(flip.maxProfitPerPurchase, true, localeTag)}</strong><small>{strategyLabel(flip, t)} · {formatPercent(flip.totalCost > 0 ? flip.maxProfitPerPurchase / flip.totalCost * 100 : 0, t("common.accumulating"))}</small>{flip.saleSource === "bazaar" ? <small>{t("npc.instaProfit", { value: formatCoins(flip.bazaarInstaSellProfit ?? 0, true, localeTag), order: formatCoins(flip.bazaarSellOrderProfit ?? 0, true, localeTag) })}</small> : null}</span></td>
            <td data-label={t("npc.executionLimit")}>{plan ? <span className="stack"><strong>{number(plan.maxProfitPurchaseCount)} {t("common.times")} · {number(plan.maxProfitPurchaseCount * flip.quantity)} {t("common.pieces")}</strong><small>{localizeMarketLimit(plan.limitedBy, locale)}{plan.depthPartial ? ` · ${t("common.first30")}` : ""}</small></span> : <span className="stack neutral"><strong>{t("npc.unknown")}</strong><small>{t("npc.noLimitData")}</small></span>}</td>
            <td data-label={t("common.maxProfit")}>{plan ? <span className="stack npc-max-profit"><strong className={tone(plan.totalProfit)}>{formatCoins(plan.totalProfit, true, localeTag)}</strong><CostList costs={plan.costs.map((cost) => ({ name: cost.name, amount: cost.requiredAmount, totalPrice: cost.totalPrice, priceSource: cost.priceSource }))} bazaarLabel={bazaarCostLabel(flip.strategy)} compact localeTag={localeTag} /><button className="detail-button" type="button" onClick={() => setSelectedOfferId(flip.offerId)}>{t("common.viewDetail")}</button></span> : <span className="stack"><strong>{t("npc.notEstimated")}</strong><small>{formatCoins(flip.maxProfitPerPurchase, true, localeTag)} {t("npc.perPurchase")}</small><button className="detail-button" type="button" onClick={() => setSelectedOfferId(flip.offerId)}>{t("common.viewDetail")}</button></span>}</td>
          </tr>;
        })}</tbody></table>{displayedFlips.length === 0 ? <div className="empty-state">{t("npc.noMatches")}</div> : null}</div>}
    {selectedFlip ? <NpcFlipDetailModal flip={selectedFlip} diazActive={diazActive} conditionalBonusActive={conditionalBonusActive} onConditionalBonusChange={setConditionalBonusActive} onClose={() => setSelectedOfferId(null)} mayorLabel={t("npc.autoMayor", { name: data.mayor.name })} /> : null}
    <p className="npc-disclaimer">{t("npc.disclaimer")}</p>
  </>;
}

function SalePrice({ flip }: { flip: NpcFlip }) {
  const { localeTag, t } = useI18n();
  return <span className="stack"><strong>{formatCoins(flip.salePriceNet, true, localeTag)}</strong>{flip.saleSource === "bazaar"
    ? <small><span className="market-source-badge">{flip.maxProfitStrategy === "sell-order" ? "BZ sell order" : "BZ insta sell"}</span> · {t("common.afterTax")}</small>
    : <><small><span className="market-source-badge">{t("npc.saleEstimate")}</span> · {t("common.afterTax")}</small><small className={flip.auctionPriceCapped ? "price-warning" : undefined}>{flip.auctionPriceCapped ? t("npc.lbinCapped") : flip.auctionPriceModel === "adjusted-estimate" ? t("npc.adjustedEstimate") : t("npc.crossEstimate")}</small></>}
  </span>;
}

function CostList({ costs, bazaarLabel, compact = false, localeTag }: {
  costs: Array<{ name: string; amount: number; totalPrice: number; priceSource: "coins" | "bazaar" | "ah-lowest-bin" }>;
  bazaarLabel: string;
  compact?: boolean;
  localeTag: string;
}) {
  const { number } = useI18n();
  return <span className={`stack npc-cost-list${compact ? " compact" : ""}`}>{costs.map((cost, index) => <span key={`${cost.name}-${index}`}><strong>{number(cost.amount)}× {cost.name}</strong>{compact ? null : <small>{cost.priceSource === "coins" ? formatCoins(cost.totalPrice, true, localeTag) : `${cost.priceSource === "bazaar" ? bazaarLabel : "AH LBIN"} · ${formatCoins(cost.totalPrice, true, localeTag)}`}</small>}</span>)}</span>;
}

function NpcFlipDetailModal({ flip, diazActive, conditionalBonusActive, onConditionalBonusChange, mayorLabel, onClose }: {
  flip: NpcFlip;
  diazActive: boolean;
  conditionalBonusActive: boolean;
  onConditionalBonusChange: (active: boolean) => void;
  mayorLabel: string;
  onClose: () => void;
}) {
  const { locale, localeTag, number, t } = useI18n();
  const [fraction, setFraction] = useState<1 | 0.8>(1);
  const plan = calculateNpcProfitPlan(flip, { diazActive, conditionalBonusActive, fraction });
  return <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="shard-detail-modal npc-detail-modal panel" role="dialog" aria-modal="true" aria-labelledby="npc-detail-title">
    <header><div><span className="eyebrow">{t("npc.detail")}</span><h2 id="npc-detail-title">{flip.name}</h2><code>{flip.npc} · {productReference(flip.productId, t)}</code></div><button type="button" aria-label={t("common.close")} onClick={onClose}>×</button></header>
    {plan ? <><div className="detail-profit-grid"><div><span>{t("npc.buyRequired")}</span><strong>{number(plan.purchaseCount)} {t("common.times")}</strong></div><div><span>{t("common.output")}</span><strong>{number(plan.outputQuantity)} {t("common.pieces")}</strong></div><div><span>{t("npc.totalCost")}</span><strong>{formatCoins(plan.totalCost, true, localeTag)}</strong></div><div><span>{fraction === 1 ? t("common.maxProfit") : "80% Target Profit"}</span><strong className={tone(plan.totalProfit)}>{formatCoins(plan.totalProfit, true, localeTag)}</strong></div></div>
      <div className="route-multiplier npc-plan-controls"><label><span>{t("craft.planTarget")}</span><select value={fraction} onChange={(event) => setFraction(Number(event.target.value) as 1 | 0.8)}><option value={1}>{t("craft.fullTarget")}</option><option value={0.8}>{t("craft.eightyTarget")}</option></select></label><div><span>{t("npc.mayor")}</span><strong>{mayorLabel}{plan.diazApplied ? " · ×10" : " · ×1"}</strong></div><div><span>{t("common.strategy")}</span><strong>{strategyLabel(flip, t)}</strong></div><div><span>{t("npc.revenueAfterTax")}</span><strong>{formatCoins(plan.revenueAfterTax, true, localeTag)}</strong></div>{flip.conditionalDailyLimitBonus ? <label className="npc-modal-checkbox"><span>{flip.conditionalLimitRequirement}</span><span><input type="checkbox" checked={conditionalBonusActive} onChange={(event) => onConditionalBonusChange(event.target.checked)} /> {t("npc.applyStock", { count: flip.conditionalDailyLimitBonus })}</span></label> : null}</div>
      <div className="detail-columns"><article><div className="modal-section-title"><div><span className="eyebrow">{t("common.required")}</span><h3>{fraction === 1 ? t("npc.requiredCosts") : t("npc.requiredCostsEighty")}</h3></div><small>{t("npc.instantCosts")}</small></div><div className="material-total-list">{plan.costs.map((cost) => <div key={cost.productId ?? cost.name}><span><strong>{cost.name}</strong><code>{cost.productId ? productReference(cost.productId, t) : "COINS"} · {t("common.perEach")} {number(cost.amountPerPurchase)}</code></span><span><strong>{number(cost.requiredAmount)} {t("common.pieces")}</strong><small>{formatCoins(cost.totalPrice, true, localeTag)} · {cost.priceSource === "bazaar" ? bazaarCostLabel(flip.strategy) : cost.priceSource === "ah-lowest-bin" ? "AH LBIN" : "Coins"}</small></span></div>)}</div></article>
        <article><div className="modal-section-title"><div><span className="eyebrow">{t("npc.limitAudit")}</span><h3>{t("craft.limitRevenue")}</h3></div></div><div className="material-total-list"><div><span><strong>{t("npc.baseStock")}</strong><small>{limitSourceLabel(flip.dailyLimitSource, t)}</small></span><span><strong>{number(flip.dailyLimit ?? 0)} {t("common.pieces")}</strong><small>{flip.diazEligible ? t("npc.diazAvailable") : t("npc.diazUnavailable")}</small></span></div>{flip.conditionalDailyLimitBonus ? <div><span><strong>{t("npc.conditionalStock")}</strong><small>{flip.conditionalLimitRequirement}</small></span><span><strong>+{flip.conditionalDailyLimitBonus}</strong><small>{plan.conditionalBonusApplied ? t("npc.applied") : t("npc.notApplied")}</small></span></div> : null}<div><span><strong>{t("npc.effectiveStock")}</strong><small>{t("npc.purchases", { count: number(plan.stockPurchaseLimit) })}</small></span><span><strong>{number(plan.effectiveDailyLimit)} {t("common.pieces")}</strong><small>{plan.diazApplied ? "Shopping Spree ×10" : "×1"}</small></span></div><div><span><strong>{t("npc.marketLimit")}</strong><small>{localizeMarketLimit(plan.limitedBy, locale)}</small></span><span><strong>{number(plan.executionPurchaseLimit)} {t("common.times")}</strong><small>{plan.depthPartial ? t("common.first30") : plan.depthLimited ? t("npc.depthLimited") : t("npc.stockLimited")}</small></span></div><div><span><strong>{t("npc.maxProfitQuantity")}</strong><small>{strategyLabel(flip, t)}</small></span><span><strong>{number(plan.maxProfitPurchaseCount)} {t("common.times")}</strong><small>{t("npc.outputs", { count: number(plan.maxProfitPurchaseCount * flip.quantity) })}</small></span></div><div><span><strong>{t("npc.singleProfit")}</strong><small>{t("common.currentPrice")}</small></span><span><strong className={tone(flip.maxProfitPerPurchase)}>{formatCoins(flip.maxProfitPerPurchase, true, localeTag)}</strong><small>{t("common.cost")} {formatCoins(flip.totalCost, true, localeTag)}</small></span></div></div><p className="npc-detail-source">{t("item.price")}: <a className="source-link" href={flip.source.url} target="_blank" rel="noreferrer">{flip.source.label}</a></p></article></div></>
    : <div className="empty-state">{t("npc.noPlan")}</div>}
    <footer><span>{t("npc.dailyLimitNote")}</span><span>{t("npc.first30Note")}</span></footer>
  </section></div>;
}
