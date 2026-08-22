"use client";

import { parseCompactNumber, type MarketFilterKey } from "@sky-turbo/core";
import { useState } from "react";

export type FilterRangeDraft = { min: string; max: string };
export type MarketFilterDrafts = Record<MarketFilterKey, FilterRangeDraft>;

const labels: Record<MarketFilterKey, string> = {
  volatility: "Volatility %",
  sellVolume: "Sell volume",
  buyVolume: "Buy volume",
  totalVolume: "Total volume",
  buyOrderPrice: "Min Cost / Buy Order ($)",
  price: "Insta Buy Price",
  coinsPerHour: "Coins / Hour",
  marginCoins: "Margin ($)",
  marginPercent: "Margin (%)",
};
const allKeys = Object.keys(labels) as MarketFilterKey[];
const emptyRange = (): FilterRangeDraft => ({ min: "", max: "" });

function createBlankMarketFilters(): MarketFilterDrafts {
  return {
    volatility: emptyRange(),
    sellVolume: emptyRange(),
    buyVolume: emptyRange(),
    totalVolume: emptyRange(),
    buyOrderPrice: emptyRange(),
    price: emptyRange(),
    coinsPerHour: emptyRange(),
    marginCoins: emptyRange(),
    marginPercent: emptyRange(),
  };
}

export function createEmptyMarketFilters(): MarketFilterDrafts {
  return createBlankMarketFilters();
}

export function createShardVolumeFilters(): MarketFilterDrafts {
  return createBlankMarketFilters();
}

export function createCrashingMarketFilters(): MarketFilterDrafts {
  const filters = createBlankMarketFilters();
  filters.buyOrderPrice.min = "1000";
  return filters;
}

export function appendMarketFilters(query: URLSearchParams, filters: MarketFilterDrafts): void {
  for (const key of allKeys) {
    const min = parseCompactNumber(filters[key].min);
    const max = parseCompactNumber(filters[key].max);
    if (min !== undefined) query.set(`${key}Min`, String(min));
    if (max !== undefined) query.set(`${key}Max`, String(max));
  }
}

export function MarketFilterPanel({
  onApply,
  summary = "篩選器",
  explanation,
  applyLabel = "套用篩選",
  visibleKeys = allKeys,
  initialFilters,
}: {
  onApply: (filters: MarketFilterDrafts) => void;
  summary?: string;
  explanation?: string;
  applyLabel?: string;
  visibleKeys?: readonly MarketFilterKey[];
  initialFilters?: MarketFilterDrafts;
}) {
  // Drafts intentionally live inside this small component. Typing therefore
  // never re-renders hundreds of market rows or restarts the Shard solver.
  const [drafts, setDrafts] = useState<MarketFilterDrafts>(() => initialFilters ?? createEmptyMarketFilters());
  return <details className="filters"><summary>{summary}</summary><div className="filter-grid">
    {explanation ? <p className="filter-explanation">{explanation}</p> : null}
    {visibleKeys.map((key) => <fieldset key={key}><legend>{labels[key]}</legend>
      <input type="text" inputMode="text" placeholder="最小 / 100k" value={drafts[key].min} onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...current[key], min: event.target.value } }))} />
      <input type="text" inputMode="text" placeholder="最大 / 10m" value={drafts[key].max} onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...current[key], max: event.target.value } }))} />
    </fieldset>)}
    <div className="filter-actions"><button className="button" type="button" onClick={() => onApply(drafts)}>{applyLabel}</button>
      <button className="button subtle" type="button" onClick={() => { const empty = createBlankMarketFilters(); setDrafts(empty); onApply(empty); }}>清除篩選</button></div>
  </div></details>;
}
