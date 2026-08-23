"use client";

import type { AhFeatureCategory, AhFlip, AhFlipSnapshot, AhRiskLevel } from "@sky-turbo/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { RefreshButton } from "./refresh-button";
import { useBackgroundRefresh } from "./use-background-refresh";

type SortKey = "profit" | "roiPercent" | "discountPercent" | "nearest" | "estimatedValue" | "sales7d";
type RiskFilter = "all" | AhRiskLevel;
type SourceFilter = "all" | AhFlip["valuationSource"];
type CategoryFilter = "all" | AhFeatureCategory;
type AhResponse = AhFlipSnapshot & { refreshIntervalMs?: number; refreshModel?: string };

const emptySnapshot: AhResponse = {
  schemaVersion: 1,
  source: "hypixel-auctions+skycofl",
  generatedAt: 0,
  auctionUpdatedAt: 0,
  totalPages: 0,
  totalAuctions: 0,
  parsedAuctions: 0,
  candidateAuctions: 0,
  evaluatedAuctions: 0,
  skippedAuctions: 0,
  partial: false,
  flips: [],
};

const riskLabels: Record<AhRiskLevel, string> = { low: "低風險", medium: "中風險", high: "高風險" };
const categoryLabels: Record<AhFeatureCategory, string> = {
  reforge: "Reforge", enchantment: "附魔", gemstone: "Gemstone", dye: "Dye", skin: "Skin / Rune",
  "potato-book": "HPB / Fuming", rarity: "稀有度", stars: "星級", pet: "Pet", attribute: "Attribute",
  "drill-part": "Drill / Fishing Part", modifier: "強化材料", counter: "計數器", special: "特殊效果", unknown: "未分類",
};

function finiteInput(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ageLabel(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return `${seconds}s 前`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m 前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h 前`;
  return `${Math.floor(seconds / 86_400)}d 前`;
}

function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)} 分`;
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(1)} 小時`;
  return `${(seconds / 86_400).toFixed(1)} 天`;
}

export function AhFlipDashboard() {
  const [data, setData] = useState<AhResponse>(emptySnapshot);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("profit");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [minProfit, setMinProfit] = useState(0);
  const [minRoi, setMinRoi] = useState(0);
  const [minSales, setMinSales] = useState(0);
  const [minListing, setMinListing] = useState("");
  const [maxListing, setMaxListing] = useState("");
  const [minMedian, setMinMedian] = useState("");
  const [maxMedian, setMaxMedian] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const response = await fetch("/api/v1/ah-flips", { cache: "no-store", signal });
      const payload = await response.json() as { data?: Partial<AhResponse>; error?: { message?: string; details?: string } };
      if (!response.ok) throw new Error(payload.error?.details || payload.error?.message || "AH Flip 掃描失敗");
      setData({ ...emptySnapshot, ...payload.data, flips: payload.data?.flips ?? [] });
      hasLoadedRef.current = true;
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "AH Flip 掃描失敗");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);
  const { refresh, refreshing } = useBackgroundRefresh(load, "ah-flips", 10_000);

  const categories = useMemo(() => [...new Set(data.flips.flatMap((flip) => flip.features.map((feature) => feature.category)))].sort(), [data.flips]);
  const displayed = useMemo(() => {
    const query = search.trim().toLowerCase();
    const listingMin = finiteInput(minListing);
    const listingMax = finiteInput(maxListing);
    const medianMin = finiteInput(minMedian);
    const medianMax = finiteInput(maxMedian);
    return data.flips.filter((flip) => {
      const median = flip.history?.medianPrice;
      return flip.profit >= minProfit && flip.roiPercent >= minRoi && (flip.history?.totalSales ?? 0) >= minSales
        && (risk === "all" || flip.riskLevel === risk)
        && (source === "all" || flip.valuationSource === source)
        && (category === "all" || flip.features.some((feature) => feature.category === category))
        && (listingMin === undefined || flip.listingPrice >= listingMin)
        && (listingMax === undefined || flip.listingPrice <= listingMax)
        && (medianMin === undefined || (median !== undefined && median >= medianMin))
        && (medianMax === undefined || (median !== undefined && median <= medianMax))
        && (!query || flip.name.toLowerCase().includes(query) || flip.productId.toLowerCase().includes(query)
          || flip.auctionId.toLowerCase().includes(query)
          || flip.features.some((feature) => `${feature.label} ${feature.value} ${feature.marketProductId ?? ""}`.toLowerCase().includes(query)));
    }).sort((left, right) => {
      if (sort === "nearest") return right.start - left.start;
      if (sort === "sales7d") return (right.history?.totalSales ?? -1) - (left.history?.totalSales ?? -1);
      return right[sort] - left[sort];
    });
  }, [category, data.flips, maxListing, maxMedian, minListing, minMedian, minProfit, minRoi, minSales, risk, search, sort, source]);

  const copyCommand = useCallback(async (flip: AhFlip) => {
    await navigator.clipboard.writeText(flip.viewAuctionCommand);
    setCopied(flip.auctionId);
    window.setTimeout(() => setCopied((value) => value === flip.auctionId ? null : value), 1_500);
  }, []);

  return <>
    <div className="toolbar panel ah-flip-toolbar">
      <DebouncedSearchField onSearch={setSearch} placeholder="物品、升級、屬性或 auction ID" />
      <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
        <option value="profit">Profit</option><option value="nearest">Nearest（最新發布）</option>
        <option value="roiPercent">ROI (%)</option><option value="discountPercent">折價幅度</option>
        <option value="estimatedValue">估計價值</option><option value="sales7d">7 日成交數</option>
      </select></label>
      <label><span>風險</span><select value={risk} onChange={(event) => setRisk(event.target.value as RiskFilter)}>
        <option value="all">全部風險</option><option value="low">低風險</option><option value="medium">中風險</option><option value="high">高風險</option>
      </select></label>
      <label><span>Min Profit</span><input type="number" min="0" step="1000" value={minProfit} onChange={(event) => setMinProfit(Math.max(0, Number(event.target.value) || 0))} /></label>
      <RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} />
      <details className="filters"><summary>更多篩選器</summary><div className="filter-grid ah-filter-grid">
        <label><span>估值來源</span><select value={source} onChange={(event) => setSource(event.target.value as SourceFilter)}><option value="all">全部</option><option value="skycofl-nbt">SkyCofl 完整 NBT</option><option value="component-estimate">Component Estimate</option></select></label>
        <label><span>升級分類</span><select value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)}><option value="all">全部分類</option>{categories.map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}</select></label>
        <label><span>Min ROI (%)</span><input type="number" step="1" value={minRoi} onChange={(event) => setMinRoi(Number(event.target.value) || 0)} /></label>
        <label><span>Min 7日成交</span><input type="number" min="0" step="1" value={minSales} onChange={(event) => setMinSales(Math.max(0, Number(event.target.value) || 0))} /></label>
        <fieldset><legend>目前 BIN 售價</legend><input aria-label="最低 BIN 售價" placeholder="最低" inputMode="numeric" value={minListing} onChange={(event) => setMinListing(event.target.value)} /><input aria-label="最高 BIN 售價" placeholder="最高" inputMode="numeric" value={maxListing} onChange={(event) => setMaxListing(event.target.value)} /></fieldset>
        <fieldset><legend>7日基礎物品中位價</legend><input aria-label="最低七日中位價" placeholder="最低" inputMode="numeric" value={minMedian} onChange={(event) => setMinMedian(event.target.value)} /><input aria-label="最高七日中位價" placeholder="最高" inputMode="numeric" value={maxMedian} onChange={(event) => setMaxMedian(event.target.value)} /></fieldset>
        <p className="filter-explanation">7 日篩選針對相同基礎物品；完整 Gemstone、Dye、Reforge、附魔等規格的估價另由 SkyCofl NBT 模型計算。</p>
        <div className="filter-actions"><button className="button subtle" type="button" onClick={() => { setRisk("all"); setSource("all"); setCategory("all"); setMinRoi(0); setMinSales(0); setMinListing(""); setMaxListing(""); setMinMedian(""); setMaxMedian(""); }}>重設進階篩選</button></div>
      </div></details>
    </div>
    <div className="depth-note ah-price-note"><span>{displayed.length} / {data.flips.length} 筆稅後正利潤 BIN · {data.totalAuctions.toLocaleString("zh-TW")} 筆拍賣 · {data.partial ? "部分頁面掃描" : "完整一致快照"}{data.generatedAt ? ` · ${new Date(data.generatedAt).toLocaleTimeString("zh-TW")}` : ""}</span><span className={error && hasLoadedRef.current ? "negative" : undefined}>{error && hasLoadedRef.current ? `背景更新失敗：${error}` : data.refreshModel || "每 10 秒檢查 Hypixel AH 新快照"}</span></div>
    {loading && !hasLoadedRef.current
      ? <div className="state-card"><span className="spinner" />正在取得 AH 快照並分析完整 NBT…</div>
      : error && !hasLoadedRef.current
        ? <div className="state-card error-state">{error}</div>
        : <div className="market-table-wrap panel"><table className="market-table ah-flip-table"><thead><tr><th>拍賣物品</th><th>發布</th><th>目前 BIN</th><th>估計實際價值</th><th>稅後收入</th><th>Net Profit</th><th>近 7 天（基礎物品）</th><th>升級摘要</th><th>操作</th></tr></thead><tbody>{displayed.slice(0, 500).map((flip) => <AhFlipRows key={flip.auctionId} flip={flip} expanded={expanded === flip.auctionId} copied={copied === flip.auctionId} onExpand={() => setExpanded((value) => value === flip.auctionId ? null : flip.auctionId)} onCopy={() => void copyCommand(flip)} />)}</tbody></table>{displayed.length === 0 ? <div className="empty-state">目前沒有符合篩選條件且扣除 AH 稅後仍為正利潤的 BIN。</div> : null}</div>}
    <p className="npc-disclaimer">估值包含完整物品 NBT（Gemstone、Dye、Hot Potato / Fuming Book、Reforge、附魔、星級、Pet、Attribute 等），但市場深度、屬性組合與特殊收藏品仍可能造成誤差。Component Estimate 一律保留並標示為高風險；請在購買前於遊戲內再次核對。估價與 7 天歷史由 <a href="https://sky.coflnet.com/data" target="_blank" rel="noreferrer">SkyCofl</a> 提供，拍賣清單來自 Hypixel Public API。</p>
  </>;
}

function AhFlipRows({ flip, expanded, copied, onExpand, onCopy }: { flip: AhFlip; expanded: boolean; copied: boolean; onExpand: () => void; onCopy: () => void }) {
  const history = flip.history;
  return <>
    <tr className={flip.riskLevel === "high" ? "high-risk-row" : undefined}>
      <td><button className="ah-item-button" type="button" onClick={onExpand}><span className="item-cell"><ItemIcon name={flip.name} productId={flip.productId} /><span><strong>{flip.quantity > 1 ? `${flip.quantity}× ` : ""}{flip.name}</strong><small>{flip.tier} · {flip.category} · {flip.productId}</small><span className={`risk-badge risk-${flip.riskLevel}`}>{riskLabels[flip.riskLevel]} · {Math.round(flip.confidence * 100)}% 信心</span></span></span></button></td>
      <td><span className="stack"><strong>{ageLabel(flip.start)}</strong><small>{new Date(flip.start).toLocaleString("zh-TW")}</small></span></td>
      <td><strong>{formatCoins(flip.listingPrice)}</strong></td>
      <td><span className="stack"><strong>{formatCoins(flip.estimatedValue)}</strong><small>{flip.valuationSource === "skycofl-nbt" ? "SkyCofl 完整 NBT" : "Component Estimate"}{flip.fastSellValue ? ` · Fast ${formatCoins(flip.fastSellValue)}` : ""}</small></span></td>
      <td><span className="stack"><strong>{formatCoins(flip.resaleAfterTax)}</strong><small>AH 稅 {formatPercent(-flip.feeRate * 100)} · {formatCoins(flip.auctionFees)}</small></span></td>
      <td><span className={`stack ${tone(flip.profit)}`}><strong>{formatCoins(flip.profit)}</strong><small>ROI {formatPercent(flip.roiPercent)} · 折價 {formatPercent(flip.discountPercent)}</small>{flip.fastSellProfit !== undefined ? <small>Fast-sell {formatCoins(flip.fastSellProfit)}</small> : null}</span></td>
      <td>{history ? <span className="stack"><strong>{formatCoins(history.medianPrice)} · {history.totalSales.toLocaleString("zh-TW")} 筆</strong><small>{formatCoins(history.minimumPrice)}–{formatCoins(history.maximumPrice)} · 中位售出 {durationLabel(history.medianSellTimeSeconds)}</small></span> : <span className="stack"><strong>累積中</strong><small>執行 SkyCofl 歷史回填指令</small></span>}</td>
      <td><span className="stack ah-feature-summary">{flip.features.length ? flip.features.slice(0, 3).map((feature) => <small key={feature.key}>{feature.label}: {feature.value}</small>) : <small>無額外升級</small>}{flip.features.length > 3 ? <small>+{flip.features.length - 3} 項</small> : null}</span></td>
      <td><span className="ah-actions"><button className="detail-button" type="button" onClick={onExpand}>{expanded ? "收合" : "明細"}</button><button className="detail-button" type="button" onClick={onCopy}>{copied ? "已複製" : "複製指令"}</button></span></td>
    </tr>
    {expanded ? <tr className="ah-detail-row"><td colSpan={9}><div className="ah-detail-grid">
      <section><span className="eyebrow">Valuation breakdown</span><h3>升級與部件估值</h3>{flip.features.length ? <div className="ah-feature-list">{flip.features.map((feature) => <div key={feature.key}><span><strong>{feature.label}</strong><small>{categoryLabels[feature.category]} · {feature.value}{feature.recognized ? "" : " · 未完整分類"}</small></span><span><strong>{feature.estimatedContribution === undefined ? "—" : formatCoins(feature.estimatedContribution)}</strong><small>{feature.replacementCost === undefined ? "無市場替換價" : `替換成本 ${formatCoins(feature.replacementCost)}`}</small></span></div>)}</div> : <p className="data-note">NBT 未偵測到額外升級。</p>}</section>
      <section><span className="eyebrow">Risk audit</span><h3>{riskLabels[flip.riskLevel]}估值</h3><ul className="ah-risk-list">{flip.riskReasons.length ? flip.riskReasons.map((reason) => <li key={reason}>{reason}</li>) : <li>成交樣本與完整規格估值充足。</li>}{flip.unknownAttributeKeys.length ? <li>未分類欄位：<code>{flip.unknownAttributeKeys.join(", ")}</code></li> : null}</ul><div className="ah-command"><code>{flip.viewAuctionCommand}</code><button className="detail-button" type="button" onClick={onCopy}>{copied ? "已複製" : "複製"}</button></div>{flip.comparableAuctionUrl ? <a className="source-link" href={flip.comparableAuctionUrl} target="_blank" rel="noreferrer">查看 SkyCofl 可比較拍賣</a> : null}{flip.valuationKey ? <small className="ah-valuation-key">Valuation key: {flip.valuationKey}</small> : null}</section>
    </div></td></tr> : null}
  </>;
}
