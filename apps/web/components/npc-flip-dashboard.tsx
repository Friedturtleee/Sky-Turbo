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
};

const strategyLabels: Record<NpcStrategy, string> = {
  "bo-so": "Buy Order → Sell Order",
  "ib-so": "Instant Buy → Sell Order",
  "bo-is": "Buy Order → Instant Sell",
  "ib-is": "Instant Buy → Instant Sell",
};

function strategyLabel(flip: NpcFlip): string {
  if (flip.saleSource === "bazaar") return strategyLabels[flip.strategy];
  return `${flip.strategy.startsWith("ib") ? "Instant Buy" : "Buy Order"} → AH`;
}

function bazaarCostLabel(strategy: NpcStrategy): string {
  return strategy.startsWith("ib") ? "BZ insta buy" : "BZ buy order";
}

function productReference(productId: string): string {
  if (productId === "INK_SACK:3") return "Cocoa Beans · Hypixel Bazaar legacy ID";
  return productId;
}

function integer(value: number): string {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(value);
}

function limitSourceLabel(source: NpcFlip["dailyLimitSource"]): string {
  if (source === "shop-stock") return "商店標示庫存";
  if (source === "standard-shop-limit") return "標準每日上限";
  if (source === "manual-wiki") return "Wiki 商店資料";
  return "未標示來源";
}

export function NpcFlipDashboard() {
  const [data, setData] = useState<NpcFlipResponse>({
    flips: [], unpricedCount: 0, updatedAt: 0, shopDataGeneratedAt: "", priceModel: "", mayor: unknownMayor,
  });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("maxDailyProfit");
  const [strategy, setStrategy] = useState<NpcStrategy>("bo-so");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [conditionalBonusActive, setConditionalBonusActive] = useState(false);
  const [minProfit, setMinProfit] = useState(0);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const response = await fetch(`/api/v1/npc-flips?strategy=${strategy}`, { cache: "no-store", signal });
      const payload = await response.json() as { data?: Partial<NpcFlipResponse>; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "NPC Flip 計算失敗");
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
      setError(reason instanceof Error ? reason.message : "NPC Flip 計算失敗");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [strategy]);
  const { refresh, refreshing } = useBackgroundRefresh(load, `npc-flips-${strategy}`);
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
      <DebouncedSearchField onSearch={setSearch} placeholder="物品、NPC、成本材料或 ID" />
      <label><span>排序</span><select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
        <option value="maxDailyProfit">Max Profit</option><option value="profit">單次 Max Profit</option>
        <option value="marginPercent">Margin (%)</option><option value="salePriceNet">稅後出售價格</option><option value="totalCost">單次成本</option>
      </select></label>
      <label><span>交易策略</span><select value={strategy} onChange={(event) => setStrategy(event.target.value as NpcStrategy)}>
        {Object.entries(strategyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><span>市場分類</span><select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value as MarketFilter)}>
        <option value="all">全部（BZ + AH）</option><option value="bazaar">Bazaar</option><option value="ah-lowest-bin">Auction House</option>
      </select></label>
      <label><span>Min 單次 Profit</span><input type="number" min="0" step="100" value={minProfit} onChange={(event) => setMinProfit(Math.max(0, Number(event.target.value) || 0))} /></label>
      <label className="npc-bonus-toggle"><input type="checkbox" checked={conditionalBonusActive} onChange={(event) => setConditionalBonusActive(event.target.checked)} /><span>已解鎖 Kiara Abiphone（庫存 +1）</span></label>
      <RefreshButton onRefresh={() => void refresh()} refreshing={refreshing} />
    </div>
    <div className="depth-note npc-price-note"><span>{displayedFlips.length} 筆可定價交易 · {data.unpricedCount} 筆缺少市場價格{data.updatedAt ? ` · 更新：${new Date(data.updatedAt).toLocaleTimeString("zh-TW")}` : ""}</span><span className={error && hasLoadedRef.current ? "negative" : undefined}>{error && hasLoadedRef.current ? error : data.priceModel || "Bazaar、AH、市長與 NPC 上限載入中"}</span></div>
    {loading && !hasLoadedRef.current
      ? <div className="state-card"><span className="spinner" />正在取得 NPC 庫存、現任市長與市場價格…</div>
      : error && !hasLoadedRef.current
        ? <div className="state-card error-state">{error}</div>
        : <div className="market-table-wrap panel npc-table-panel"><table className="market-table npc-flip-table"><thead><tr>
          <th>NPC 商品</th><th>NPC</th><th>單次購買需求</th><th>單次成本</th><th>稅後出售價格</th><th>7日成交量</th><th>單次 Profit</th><th>執行上限</th><th>Max Profit</th>
        </tr></thead><tbody>{displayedFlips.slice(0, 300).map((flip) => {
          const plan = planFor(flip);
          return <tr key={flip.offerId}>
            <td data-label="NPC 商品"><button className="npc-item-button" type="button" onClick={() => setSelectedOfferId(flip.offerId)}><span className="item-cell"><ItemIcon name={flip.name} productId={flip.productId} /><span><strong>{flip.quantity > 1 ? `${flip.quantity}× ` : ""}{flip.name}</strong><small>{productReference(flip.productId)}</small></span></span></button></td>
            <td data-label="NPC"><span className="stack"><strong>{flip.npc}</strong>{flip.requirement ? <small>{flip.requirement}</small> : null}</span></td>
            <td data-label="單次購買需求"><CostList costs={flip.costs.map((cost) => ({ name: cost.name, amount: cost.amount, totalPrice: cost.totalPrice, priceSource: cost.priceSource }))} bazaarLabel={bazaarCostLabel(flip.strategy)} /></td>
            <td data-label="單次成本">{formatCoins(flip.totalCost)}</td>
            <td data-label="出售價格"><SalePrice flip={flip} /></td>
            <td data-label="7日成交量">{flip.saleSource === "bazaar"
              ? <span className="stack"><strong>{(flip.bazaarMatchedVolume7d ?? 0).toLocaleString("zh-TW")}</strong><small>近 7 天 BZ 成交</small></span>
              : flip.ahSalesLast7d === undefined ? <span className="neutral">累積中</span> : <span className="stack"><strong>{flip.ahSalesLast7d.toLocaleString("zh-TW")} 筆</strong><small>近 7 天 AH 成交</small></span>}</td>
            <td data-label="單次 Profit"><span className={`stack ${tone(flip.maxProfitPerPurchase)}`}><strong>{formatCoins(flip.maxProfitPerPurchase)}</strong><small>{strategyLabel(flip)} · {formatPercent(flip.totalCost > 0 ? flip.maxProfitPerPurchase / flip.totalCost * 100 : 0)}</small>{flip.saleSource === "bazaar" ? <small>Insta {formatCoins(flip.bazaarInstaSellProfit ?? 0)} · Order {formatCoins(flip.bazaarSellOrderProfit ?? 0)}</small> : null}</span></td>
            <td data-label="執行上限">{plan ? <span className="stack"><strong>{integer(plan.maxProfitPurchaseCount)} 次 · {integer(plan.maxProfitPurchaseCount * flip.quantity)} 個</strong><small>{plan.limitedBy}{plan.depthPartial ? " · Hypixel 前 30 檔" : ""}</small></span> : <span className="stack neutral"><strong>未確認</strong><small>沒有可靠的庫存或深度資料</small></span>}</td>
            <td data-label="Max Profit">{plan ? <span className="stack npc-max-profit"><strong className={tone(plan.totalProfit)}>{formatCoins(plan.totalProfit)}</strong><CostList costs={plan.costs.map((cost) => ({ name: cost.name, amount: cost.requiredAmount, totalPrice: cost.totalPrice, priceSource: cost.priceSource }))} bazaarLabel={bazaarCostLabel(flip.strategy)} compact /><button className="detail-button" type="button" onClick={() => setSelectedOfferId(flip.offerId)}>查看詳細</button></span> : <span className="stack"><strong>無法估算</strong><small>{formatCoins(flip.maxProfitPerPurchase)} / 次</small><button className="detail-button" type="button" onClick={() => setSelectedOfferId(flip.offerId)}>查看詳細</button></span>}</td>
          </tr>;
        })}</tbody></table>{displayedFlips.length === 0 ? <div className="empty-state">目前沒有符合條件且可完整定價的 NPC Flip。</div> : null}</div>}
    {selectedFlip ? <NpcFlipDetailModal flip={selectedFlip} diazActive={diazActive} conditionalBonusActive={conditionalBonusActive} onConditionalBonusChange={setConditionalBonusActive} onClose={() => setSelectedOfferId(null)} mayorLabel={`自動：${data.mayor.name}`} /> : null}
    <p className="npc-disclaimer">NPC Flip 依目前選取的 Buy Order／Instant Buy 與 Sell Order／Instant Sell 策略計算。Instant 交易會逐檔消耗 Hypixel 可見掛單並在利潤最高處停止；Order 使用目前最佳掛單價。一般可轉售商品採 640 個標準上限，Mayor 與 Diaz Shopping Spree 由 Hypixel Election API 自動套用。AH 成品的 Max Profit 預設只估算單次購買，售價使用最低 BIN／近期成交中位估價並扣除分級手續費。市場價格由 Hypixel 與 <a href="https://sky.coflnet.com/data" target="_blank" rel="noreferrer">SkyCofl</a> 提供。</p>
  </>;
}

function SalePrice({ flip }: { flip: NpcFlip }) {
  return <span className="stack"><strong>{formatCoins(flip.salePriceNet)}</strong>{flip.saleSource === "bazaar"
    ? <small><span className="market-source-badge">{flip.maxProfitStrategy === "sell-order" ? "BZ sell order" : "BZ insta sell"}</span> · 已扣稅</small>
    : <><small><span className="market-source-badge">AH 成交估價</span> · 已扣稅</small><small className={flip.auctionPriceCapped ? "price-warning" : undefined}>{flip.auctionPriceCapped ? "已用近期成交中位價限制異常 LBIN" : flip.auctionPriceModel === "adjusted-estimate" ? "SkyCofl 批次調整估價" : "LBIN 與近期成交價交叉估算"}</small></>}
  </span>;
}

function CostList({ costs, bazaarLabel, compact = false }: {
  costs: Array<{ name: string; amount: number; totalPrice: number; priceSource: "coins" | "bazaar" | "ah-lowest-bin" }>;
  bazaarLabel: string;
  compact?: boolean;
}) {
  return <span className={`stack npc-cost-list${compact ? " compact" : ""}`}>{costs.map((cost, index) => <span key={`${cost.name}-${index}`}><strong>{integer(cost.amount)}× {cost.name}</strong>{compact ? null : <small>{cost.priceSource === "coins" ? formatCoins(cost.totalPrice) : `${cost.priceSource === "bazaar" ? bazaarLabel : "AH LBIN"} · ${formatCoins(cost.totalPrice)}`}</small>}</span>)}</span>;
}

function NpcFlipDetailModal({ flip, diazActive, conditionalBonusActive, onConditionalBonusChange, mayorLabel, onClose }: {
  flip: NpcFlip;
  diazActive: boolean;
  conditionalBonusActive: boolean;
  onConditionalBonusChange: (active: boolean) => void;
  mayorLabel: string;
  onClose: () => void;
}) {
  const [fraction, setFraction] = useState<1 | 0.8>(1);
  const plan = calculateNpcProfitPlan(flip, { diazActive, conditionalBonusActive, fraction });
  return <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="shard-detail-modal npc-detail-modal panel" role="dialog" aria-modal="true" aria-labelledby="npc-detail-title">
    <header><div><span className="eyebrow">NPC Max Profit detail</span><h2 id="npc-detail-title">{flip.name}</h2><code>{flip.npc} · {productReference(flip.productId)}</code></div><button type="button" aria-label="關閉" onClick={onClose}>×</button></header>
    {plan ? <><div className="detail-profit-grid"><div><span>需要購買</span><strong>{integer(plan.purchaseCount)} 次</strong></div><div><span>取得成品</span><strong>{integer(plan.outputQuantity)} 個</strong></div><div><span>成本總額</span><strong>{formatCoins(plan.totalCost)}</strong></div><div><span>{fraction === 1 ? "Max Profit" : "80% Target Profit"}</span><strong className={tone(plan.totalProfit)}>{formatCoins(plan.totalProfit)}</strong></div></div>
      <div className="route-multiplier npc-plan-controls"><label><span>成本規劃目標</span><select value={fraction} onChange={(event) => setFraction(Number(event.target.value) as 1 | 0.8)}><option value={1}>深度內最高利潤（100% Max Profit）</option><option value={0.8}>Max Profit 的至少 80%</option></select></label><div><span>市長（自動）</span><strong>{mayorLabel}{plan.diazApplied ? " · ×10" : " · ×1"}</strong></div><div><span>交易策略</span><strong>{strategyLabel(flip)}</strong></div><div><span>稅後總收入</span><strong>{formatCoins(plan.revenueAfterTax)}</strong></div>{flip.conditionalDailyLimitBonus ? <label className="npc-modal-checkbox"><span>{flip.conditionalLimitRequirement}</span><span><input type="checkbox" checked={conditionalBonusActive} onChange={(event) => onConditionalBonusChange(event.target.checked)} /> 套用庫存 +{flip.conditionalDailyLimitBonus}</span></label> : null}</div>
      <div className="detail-columns"><article><div className="modal-section-title"><div><span className="eyebrow">Required costs</span><h3>{fraction === 1 ? "最高利潤方案所需成本" : "達到 80% Max Profit 所需成本"}</h3></div><small>Instant 成本為逐檔成交後的實際總額</small></div><div className="material-total-list">{plan.costs.map((cost) => <div key={cost.productId ?? cost.name}><span><strong>{cost.name}</strong><code>{cost.productId ? productReference(cost.productId) : "COINS"} · 每次 {integer(cost.amountPerPurchase)}</code></span><span><strong>{integer(cost.requiredAmount)} 個</strong><small>{formatCoins(cost.totalPrice)} · {cost.priceSource === "bazaar" ? bazaarCostLabel(flip.strategy) : cost.priceSource === "ah-lowest-bin" ? "AH LBIN" : "Coins"}</small></span></div>)}</div></article>
        <article><div className="modal-section-title"><div><span className="eyebrow">Limit and revenue audit</span><h3>上限與收益</h3></div></div><div className="material-total-list"><div><span><strong>基礎每日庫存</strong><small>{limitSourceLabel(flip.dailyLimitSource)}</small></span><span><strong>{integer(flip.dailyLimit ?? 0)} 個</strong><small>{flip.diazEligible ? "可套用 Diaz" : "不適用 Diaz"}</small></span></div>{flip.conditionalDailyLimitBonus ? <div><span><strong>條件庫存</strong><small>{flip.conditionalLimitRequirement}</small></span><span><strong>+{flip.conditionalDailyLimitBonus}</strong><small>{plan.conditionalBonusApplied ? "已套用" : "未套用"}</small></span></div> : null}<div><span><strong>有效每日庫存</strong><small>{integer(plan.stockPurchaseLimit)} 次可購買</small></span><span><strong>{integer(plan.effectiveDailyLimit)} 個</strong><small>{plan.diazApplied ? "Shopping Spree ×10" : "×1"}</small></span></div><div><span><strong>市場執行上限</strong><small>{plan.limitedBy}</small></span><span><strong>{integer(plan.executionPurchaseLimit)} 次</strong><small>{plan.depthPartial ? "Hypixel 前 30 檔" : plan.depthLimited ? "受可見深度限制" : "受每日庫存限制"}</small></span></div><div><span><strong>最高利潤數量</strong><small>{strategyLabel(flip)}</small></span><span><strong>{integer(plan.maxProfitPurchaseCount)} 次</strong><small>{integer(plan.maxProfitPurchaseCount * flip.quantity)} 個成品</small></span></div><div><span><strong>單次 Profit</strong><small>第一批目前價格</small></span><span><strong className={tone(flip.maxProfitPerPurchase)}>{formatCoins(flip.maxProfitPerPurchase)}</strong><small>成本 {formatCoins(flip.totalCost)}</small></span></div></div><p className="npc-detail-source">資料來源：<a className="source-link" href={flip.source.url} target="_blank" rel="noreferrer">{flip.source.label}</a></p></article></div></>
    : <div className="empty-state">這筆商品沒有足夠可靠的每日庫存資料，因此不虛構 Max Profit；仍可使用單次 Profit 判斷。</div>}
    <footer><span>每日上限依商品數量計算；Instant 會逐檔計價並在總利潤最高處停止。</span><span>標示前 30 檔時，實際市場深度可能更高。</span></footer>
  </section></div>;
}
