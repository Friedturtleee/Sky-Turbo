"use client";

import type { AhFeatureCategory, AhFlip, AhFlipSnapshot, AhRiskLevel } from "@sky-turbo/core";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DebouncedSearchField } from "./debounced-search-field";
import { formatCoins, formatPercent, tone } from "./format";
import { ItemIcon } from "./item-icon";
import { RefreshButton } from "./refresh-button";
import { useBackgroundRefresh } from "./use-background-refresh";

type SortKey = "profit" | "roiPercent" | "discountPercent" | "nearest" | "estimatedValue" | "sales7d";
type RiskFilter = "all" | AhRiskLevel;
type SourceFilter = "all" | AhFlip["valuationSource"];
type CategoryFilter = "all" | AhFeatureCategory;
type AhResponse = AhFlipSnapshot & { unchanged?: false; refreshIntervalMs?: number; refreshModel?: string };
type AhUnchangedResponse = Pick<AhResponse, "generatedAt" | "auctionUpdatedAt" | "refreshIntervalMs" | "refreshModel"> & { unchanged: true };

const PAGE_SIZE = 50;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoadedRef = useRef(false);
  const generatedAtRef = useRef(0);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!hasLoadedRef.current) setLoading(true);
    const params = new URLSearchParams();
    if (generatedAtRef.current > 0) params.set("since", String(generatedAtRef.current));
    try {
      const response = await fetch(`/api/v1/ah-flips${params.size ? `?${params}` : ""}`, { cache: "no-store", signal });
      const payload = await response.json() as { data?: Partial<AhResponse> | AhUnchangedResponse; error?: { message?: string; details?: string } };
      if (!response.ok) throw new Error(payload.error?.details || payload.error?.message || "AH Flip 掃描失敗");
      if (payload.data?.unchanged) {
        setData((current) => current.refreshModel === payload.data?.refreshModel ? current : { ...current, refreshModel: payload.data?.refreshModel });
      } else {
        const next = { ...emptySnapshot, ...payload.data, flips: payload.data?.flips ?? [] } as AhResponse;
        generatedAtRef.current = next.generatedAt;
        setData((current) => current.generatedAt === next.generatedAt ? current : next);
      }
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

  const pageCount = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount);
  const pagedFlips = useMemo(() => displayed.slice((visiblePage - 1) * PAGE_SIZE, visiblePage * PAGE_SIZE), [displayed, visiblePage]);
  const selected = useMemo(() => selectedId ? data.flips.find((flip) => flip.auctionId === selectedId) ?? null : null, [data.flips, selectedId]);

  useEffect(() => { setPage(1); }, [category, maxListing, maxMedian, minListing, minMedian, minProfit, minRoi, minSales, risk, search, sort, source]);
  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedId(null); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selected]);

  const copyCommand = useCallback(async (flip: AhFlip) => {
    await navigator.clipboard.writeText(flip.viewAuctionCommand);
    setCopied(flip.auctionId);
    window.setTimeout(() => setCopied((value) => value === flip.auctionId ? null : value), 1_500);
  }, []);
  const showDetails = useCallback((flip: AhFlip) => setSelectedId(flip.auctionId), []);
  const manualRefresh = useCallback(() => void refresh(), [refresh]);

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
      <RefreshButton onRefresh={manualRefresh} refreshing={refreshing} />
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
        ? <div className="state-card error-state"><strong>AH Flip 暫時無法載入</strong><span>{error}</span><button className="button subtle" type="button" onClick={manualRefresh}>重新掃描</button></div>
        : <div className="market-table-wrap panel ah-table-panel">
          <table className="market-table ah-flip-table"><thead><tr><th>拍賣物品</th><th>發布／售價</th><th>估計價值</th><th>Net Profit</th><th>近 7 天</th><th>風險／操作</th></tr></thead><tbody>{pagedFlips.map((flip) => <AhFlipRow key={flip.auctionId} flip={flip} copied={copied === flip.auctionId} onSelect={showDetails} onCopy={copyCommand} />)}</tbody></table>
          {displayed.length === 0 ? <div className="empty-state">目前沒有符合篩選條件且扣除 AH 稅後仍為正利潤的 BIN。</div> : <Pagination page={visiblePage} pageCount={pageCount} total={displayed.length} onPage={setPage} />}
        </div>}
    <p className="npc-disclaimer">估值包含完整物品 NBT（Gemstone、Dye、Hot Potato / Fuming Book、Reforge、附魔、星級、Pet、Attribute 等），但市場深度、屬性組合與特殊收藏品仍可能造成誤差。Component Estimate 一律保留並標示為高風險；請在購買前於遊戲內再次核對。估價與 7 天歷史由 <a href="https://sky.coflnet.com/data" target="_blank" rel="noreferrer">SkyCofl</a> 提供，拍賣清單來自 Hypixel Public API。</p>
    {selected ? <AhFlipDetail flip={selected} copied={copied === selected.auctionId} onClose={() => setSelectedId(null)} onCopy={copyCommand} /> : null}
  </>;
}

const AhFlipRow = memo(function AhFlipRow({ flip, copied, onSelect, onCopy }: { flip: AhFlip; copied: boolean; onSelect: (flip: AhFlip) => void; onCopy: (flip: AhFlip) => void }) {
  const history = flip.history;
  return <tr className={flip.riskLevel === "high" ? "high-risk-row" : undefined}>
    <td><button className="ah-item-button" type="button" onClick={() => onSelect(flip)}><span className="item-cell"><ItemIcon name={flip.name} productId={flip.productId} /><span><strong>{flip.quantity > 1 ? `${flip.quantity}× ` : ""}{flip.name}</strong><small>{flip.tier} · {flip.category} · {flip.productId}</small><small className="ah-feature-inline">{flip.features.length ? flip.features.slice(0, 2).map((feature) => `${feature.label}: ${feature.value}`).join(" · ") : "無額外升級"}</small></span></span></button></td>
    <td><span className="stack"><strong>{formatCoins(flip.listingPrice)}</strong><small>{ageLabel(flip.start)} · {new Date(flip.start).toLocaleTimeString("zh-TW")}</small></span></td>
    <td><span className="stack"><strong>{formatCoins(flip.estimatedValue)}</strong><small>稅後 {formatCoins(flip.resaleAfterTax)} · AH 稅 {formatCoins(flip.auctionFees)}</small></span></td>
    <td><span className={`stack ${tone(flip.profit)}`}><strong>{formatCoins(flip.profit)}</strong><small>ROI {formatPercent(flip.roiPercent)} · 折價 {formatPercent(flip.discountPercent)}</small>{flip.fastSellProfit !== undefined ? <small>Fast-sell {formatCoins(flip.fastSellProfit)}</small> : null}</span></td>
    <td>{history ? <span className="stack"><strong>{history.totalSales.toLocaleString("zh-TW")} 筆 · 中位 {formatCoins(history.medianPrice)}</strong><small>{formatCoins(history.minimumPrice)}–{formatCoins(history.maximumPrice)}</small></span> : <span className="stack"><strong>累積中</strong><small>尚無歷史回填</small></span>}</td>
    <td><span className="stack ah-row-controls"><span className={`risk-badge risk-${flip.riskLevel}`}>{riskLabels[flip.riskLevel]} · {Math.round(flip.confidence * 100)}%</span><span className="ah-actions"><button className="detail-button" type="button" onClick={() => onSelect(flip)}>明細</button><button className="detail-button" type="button" onClick={() => onCopy(flip)}>{copied ? "已複製" : "複製指令"}</button></span></span></td>
  </tr>;
});

function Pagination({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (page: number) => void }) {
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, page * PAGE_SIZE);
  return <nav className="ah-pagination" aria-label="AH Flip 分頁"><span>顯示 {first}–{last} / {total}，每頁 {PAGE_SIZE} 筆</span><div><button className="detail-button" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一頁</button><strong>{page} / {pageCount}</strong><button className="detail-button" type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>下一頁</button></div></nav>;
}

function AhFlipDetail({ flip, copied, onClose, onCopy }: { flip: AhFlip; copied: boolean; onClose: () => void; onCopy: (flip: AhFlip) => void }) {
  const history = flip.history;
  return <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <article className="panel shard-detail-modal ah-detail-modal" role="dialog" aria-modal="true" aria-labelledby="ah-detail-title">
      <header><div><span className="eyebrow">Auction valuation</span><h2 id="ah-detail-title">{flip.quantity > 1 ? `${flip.quantity}× ` : ""}{flip.name}</h2><small>{flip.productId} · 發布於 {new Date(flip.start).toLocaleString("zh-TW")}</small></div><button aria-label="關閉 AH Flip 明細" type="button" onClick={onClose}>×</button></header>
      <div className="detail-profit-grid ah-profit-grid"><div><span>目前 BIN</span><strong>{formatCoins(flip.listingPrice)}</strong></div><div><span>估計實際價值</span><strong>{formatCoins(flip.estimatedValue)}</strong></div><div><span>稅後收入</span><strong>{formatCoins(flip.resaleAfterTax)}</strong><small>AH 稅 {formatPercent(-flip.feeRate * 100)}</small></div><div><span>Net Profit</span><strong className={tone(flip.profit)}>{formatCoins(flip.profit)}</strong><small>ROI {formatPercent(flip.roiPercent)}</small></div></div>
      <div className="ah-detail-grid">
        <section><span className="eyebrow">Valuation breakdown</span><h3>升級與部件估值</h3>{flip.features.length ? <div className="ah-feature-list">{flip.features.map((feature) => <div key={feature.key}><span><strong>{feature.label}</strong><small>{categoryLabels[feature.category]} · {feature.value}{feature.recognized ? "" : " · 未完整分類"}</small></span><span><strong>{feature.estimatedContribution === undefined ? "—" : formatCoins(feature.estimatedContribution)}</strong><small>{feature.replacementCost === undefined ? "無市場替換價" : `替換成本 ${formatCoins(feature.replacementCost)}`}</small></span></div>)}</div> : <p className="data-note">NBT 未偵測到額外升級。</p>}</section>
        <section><span className="eyebrow">Risk audit</span><h3>{riskLabels[flip.riskLevel]}估值</h3><span className={`risk-badge risk-${flip.riskLevel}`}>{Math.round(flip.confidence * 100)}% 信心 · {flip.valuationSource === "skycofl-nbt" ? "SkyCofl 完整 NBT" : "Component Estimate"}</span><ul className="ah-risk-list">{flip.riskReasons.length ? flip.riskReasons.map((reason) => <li key={reason}>{reason}</li>) : <li>成交樣本與完整規格估值充足。</li>}{flip.unknownAttributeKeys.length ? <li>未分類欄位：<code>{flip.unknownAttributeKeys.join(", ")}</code></li> : null}</ul>{history ? <div className="ah-history-card"><strong>近 7 天：{history.totalSales.toLocaleString("zh-TW")} 筆</strong><small>中位 {formatCoins(history.medianPrice)} · 範圍 {formatCoins(history.minimumPrice)}–{formatCoins(history.maximumPrice)}</small><small>中位售出時間 {durationLabel(history.medianSellTimeSeconds)}</small></div> : null}<div className="ah-command"><code>{flip.viewAuctionCommand}</code><button className="detail-button" type="button" onClick={() => onCopy(flip)}>{copied ? "已複製" : "複製"}</button></div>{flip.comparableAuctionUrl ? <a className="source-link" href={flip.comparableAuctionUrl} target="_blank" rel="noreferrer">查看 SkyCofl 可比較拍賣</a> : null}{flip.valuationKey ? <small className="ah-valuation-key">Valuation key: {flip.valuationKey}</small> : null}</section>
      </div>
    </article>
  </div>;
}
