"use client";

import type { SkyblockIndex } from "@sky-turbo/core";
import Link from "next/link";
import { useCallback, useState } from "react";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { useI18n } from "./i18n";
import { RefreshButton } from "./refresh-button";
import { SkyblockIndexChart } from "./skyblock-index-chart";
import { useBackgroundRefresh } from "./use-background-refresh";

type IndexRange = "1d" | "7d" | "1mo";
type IndexResponse = SkyblockIndex & { updatedAt: number; taxRate: number; range: IndexRange; resolutionMs: number };

export function SkyblockIndexDashboard() {
  const { localeTag, number, t, time } = useI18n();
  const [data, setData] = useState<IndexResponse | null>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState<IndexRange>("7d");
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch(`/api/v1/skyblock-index?range=${range}`, { cache: "no-store", signal });
      const payload = await response.json() as { data?: IndexResponse; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? t("market.readFailed"));
      setData(payload.data);
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : t("market.readFailed"));
    }
  }, [range, t]);
  const { refresh, refreshing } = useBackgroundRefresh(load, `skyblock-index-${range}`);
  if (error && !data) return <div className="state-card error-state"><strong>{t("index.loadFailed")}</strong><span>{error}</span></div>;
  if (!data) return <div className="state-card"><span className="spinner" />{t("index.loading")}</div>;

  return <>
    <section className="skyblock-index-hero panel">
      <div><span className="eyebrow">{t("index.eyebrow")}</span><h2>{number(data.value, { maximumFractionDigits: 2 })}</h2><p>{t("index.base", { value: number(data.baseValue), count: number(data.constituentCount) })}</p></div>
      <div className="skyblock-index-metrics"><div><span>24h</span><strong className={tone(data.change24h)}>{formatPercent(data.change24h, t("common.accumulating"))}</strong></div><div><span>{t("index.coverage")}</span><strong>{data.coveragePercent.toFixed(1)}%</strong></div><div><span>{t("index.tax")}</span><strong>{(data.taxRate * 100).toFixed(3)}%</strong></div><RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} /></div>
    </section>
    <section className="chart-panel panel skyblock-index-panel"><div className="panel-title"><div><span className="eyebrow">{t("index.history")}</span><h2>{t("index.title")}</h2></div><div className="segmented">{(["1d", "7d", "1mo"] as IndexRange[]).map((value) => <button className={range === value ? "active" : ""} key={value} type="button" onClick={() => setRange(value)}>{value}</button>)}</div></div><SkyblockIndexChart points={data.points} /><p className="data-note">{t(data.resolutionMs === 300_000 ? "index.resolution5m" : data.resolutionMs === 3_600_000 ? "index.resolution1h" : "index.resolution1d")} · {t("index.updated", { time: time(data.updatedAt) })}</p></section>
    <section className="skyblock-index-method panel"><div><span className="eyebrow">{t("index.method")}</span><h2>{t("index.methodTitle")}</h2></div><p>{t("index.methodDescription", { weight: Math.round(data.maxConstituentWeight * 100) })}</p></section>
    <section className="market-table-wrap panel"><table className="market-table skyblock-index-table"><thead><tr><th>{t("index.constituent")}</th><th>{t("index.weight")}</th><th>{t("index.midpoint")}</th><th>{t("index.matchedVolume")}</th></tr></thead><tbody>{data.constituents.slice(0, 20).map((item) => <tr key={item.productId}><td><Link className="item-cell" href={`/items/${encodeURIComponent(item.productId)}`}><ItemIcon name={item.name} productId={item.productId} /><span><strong>{item.name}</strong><code>{item.productId}</code></span></Link></td><td>{(item.weight * 100).toFixed(2)}%</td><td>{formatCoins(item.midpoint, true, localeTag)}</td><td>{formatCoins(item.weeklyMatched, true, localeTag)}</td></tr>)}</tbody></table></section>
    <p className="npc-disclaimer">{t("index.disclaimer")}</p>
  </>;
}
