"use client";

import type { SkyblockIndex } from "@sky-turbo/core";
import Link from "next/link";
import { useCallback, useState } from "react";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { RefreshButton } from "./refresh-button";
import { SkyblockIndexChart } from "./skyblock-index-chart";
import { useBackgroundRefresh } from "./use-background-refresh";

type IndexResponse = SkyblockIndex & { updatedAt: number; taxRate: number };

export function SkyblockIndexDashboard() {
  const [data, setData] = useState<IndexResponse | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetch("/api/v1/skyblock-index", { cache: "no-store", signal });
      const payload = await response.json() as { data?: IndexResponse; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "讀取失敗");
      setData(payload.data);
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "讀取失敗");
    }
  }, []);
  const { refresh, refreshing } = useBackgroundRefresh(load, "skyblock-index");
  if (error && !data) return <div className="state-card error-state"><strong>Skyblock Index 暫時無法載入</strong><span>{error}</span></div>;
  if (!data) return <div className="state-card"><span className="spinner" />正在計算 Skyblock Index…</div>;

  return <>
    <section className="skyblock-index-hero panel">
      <div><span className="eyebrow">Liquidity-weighted Bazaar index</span><h2>{data.value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}</h2><p>基期 {data.baseValue.toLocaleString("zh-TW")} · {data.constituentCount.toLocaleString("zh-TW")} 個成分股</p></div>
      <div className="skyblock-index-metrics"><div><span>24h</span><strong className={tone(data.change24h)}>{formatPercent(data.change24h)}</strong></div><div><span>涵蓋率</span><strong>{data.coveragePercent.toFixed(1)}%</strong></div><div><span>Bazaar 稅</span><strong>{(data.taxRate * 100).toFixed(3)}%</strong></div><RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} /></div>
    </section>
    <section className="chart-panel panel skyblock-index-panel"><div className="panel-title"><div><span className="eyebrow">Index history</span><h2>Skyblock Index 走勢</h2></div><span>每日快照 + 即時 Bazaar</span></div><SkyblockIndexChart points={data.points} /></section>
    <section className="skyblock-index-method panel"><div><span className="eyebrow">Methodology</span><h2>類似自由流通市值加權，但以 Bazaar 流動性取代流通市值</h2></div><p>權重 = √（目前中間價 × 近 7 日雙向可匹配成交量）；單一品項最多 {Math.round(data.maxConstituentWeight * 100)}%，避免少數高價／高量商品主導。成分股需有足夠成交量與完整每日歷史；籃子會隨當前市場重新平衡。</p></section>
    <section className="market-table-wrap panel"><table className="market-table skyblock-index-table"><thead><tr><th>最大權重成分股</th><th>權重</th><th>中間價</th><th>7d 可匹配量</th></tr></thead><tbody>{data.constituents.slice(0, 20).map((item) => <tr key={item.productId}><td><Link className="item-cell" href={`/items/${encodeURIComponent(item.productId)}`}><ItemIcon name={item.name} productId={item.productId} /><span><strong>{item.name}</strong><code>{item.productId}</code></span></Link></td><td>{(item.weight * 100).toFixed(2)}%</td><td>{formatCoins(item.midpoint)}</td><td>{formatCoins(item.weeklyMatched)}</td></tr>)}</tbody></table></section>
    <p className="npc-disclaimer">此指數是 Bazaar 經濟溫度計，不代表可直接買入的投資組合。它使用中間價衡量市場，而非稅後可執行收益；Derpy 的 Bazaar 稅率仍會顯示於上方，但不會改變中間價指數本身。</p>
  </>;
}
