import { auctionFeeRate } from "./npc-flips";
import type { AhFlip, AhRiskLevel, AhValuationInput } from "./types";

function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function riskFor(input: AhValuationInput, exact: boolean): {
  riskLevel: AhRiskLevel;
  confidence: number;
  riskReasons: string[];
} {
  const reasons: string[] = [];
  let score = exact ? 0.86 : 0.32;

  if (!exact) reasons.push("SkyCofl 精確 NBT 估價缺失，使用 Component Estimate");
  if (input.unknownAttributeKeys.length > 0) {
    score -= Math.min(0.2, input.unknownAttributeKeys.length * 0.025);
    reasons.push(`包含 ${input.unknownAttributeKeys.length} 個尚未完整分類的 NBT 欄位`);
  }

  const comparableVolume = input.nbtEstimate?.volume;
  if (exact && (!positive(comparableVolume) || comparableVolume < 1)) {
    score -= 0.32;
    reasons.push("完全相同規格的市場成交量過低");
  } else if (exact && comparableVolume !== undefined && comparableVolume < 3) {
    score -= 0.14;
    reasons.push("完全相同規格的市場成交量偏低");
  }

  if (!input.history) {
    score -= 0.12;
    reasons.push("尚未載入 SkyCofl 近 7 天基礎物品成交資料");
  } else {
    if (input.history.totalSales < 3) {
      score -= 0.25;
      reasons.push("近 7 天成交樣本少於 3 筆");
    } else if (input.history.totalSales < 10) {
      score -= 0.1;
      reasons.push("近 7 天成交樣本偏少");
    }
    if (input.history.priceCoefficientVariation > 0.75) {
      score -= 0.25;
      reasons.push("近 7 天價格波動極高");
    } else if (input.history.priceCoefficientVariation > 0.4) {
      score -= 0.1;
      reasons.push("近 7 天價格波動偏高");
    }
  }

  const confidence = clamp(score, 0.05, 0.99);
  const riskLevel: AhRiskLevel = !exact || confidence < 0.45
    ? "high"
    : confidence < 0.72
      ? "medium"
      : "low";
  if (riskLevel === "high" && reasons.length === 0) reasons.push("估值信心不足");
  return { riskLevel, confidence, riskReasons: reasons };
}

export function calculateAhFlip(input: AhValuationInput): AhFlip | null {
  if (!positive(input.listingPrice) || input.quantity < 1 || input.end <= input.start) return null;
  const exact = positive(input.nbtEstimate?.median);
  const estimatedValue = exact ? input.nbtEstimate!.median : input.componentEstimate;
  if (!positive(estimatedValue)) return null;

  const feeRate = auctionFeeRate(estimatedValue);
  const resaleAfterTax = estimatedValue * (1 - feeRate);
  const auctionFees = estimatedValue - resaleAfterTax;
  const profit = resaleAfterTax - input.listingPrice;
  const fastSellValue = positive(input.nbtEstimate?.fastSell) ? input.nbtEstimate.fastSell : undefined;
  const fastSellProfit = fastSellValue === undefined
    ? undefined
    : fastSellValue * (1 - auctionFeeRate(fastSellValue)) - input.listingPrice;
  const risk = riskFor(input, exact);

  return {
    auctionId: input.auctionId,
    productId: input.productId,
    name: input.name,
    category: input.category,
    tier: input.tier,
    quantity: input.quantity,
    listingPrice: input.listingPrice,
    start: input.start,
    end: input.end,
    estimatedValue,
    ...(fastSellValue === undefined ? {} : { fastSellValue }),
    componentEstimate: input.componentEstimate,
    resaleAfterTax,
    auctionFees,
    feeRate,
    profit,
    ...(fastSellProfit === undefined ? {} : { fastSellProfit }),
    roiPercent: profit / input.listingPrice * 100,
    discountPercent: (estimatedValue - input.listingPrice) / estimatedValue * 100,
    valuationSource: exact ? "skycofl-nbt" : "component-estimate",
    ...risk,
    features: input.features,
    unknownAttributeKeys: input.unknownAttributeKeys,
    ...(input.history ? { history: input.history } : {}),
    ...(positive(input.nbtEstimate?.volume) ? { comparableVolume: input.nbtEstimate.volume } : {}),
    ...(input.nbtEstimate?.medianKey ? { valuationKey: input.nbtEstimate.medianKey } : {}),
    ...(input.nbtEstimate?.lbinLink ? { comparableAuctionUrl: input.nbtEstimate.lbinLink } : {}),
    viewAuctionCommand: `/viewauction ${input.auctionId}`,
  };
}
