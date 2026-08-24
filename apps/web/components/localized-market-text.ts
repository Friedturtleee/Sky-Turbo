import type { AppLocale } from "./i18n";

/**
 * The calculators keep their constraint reason as a compact data string so it
 * can also be used by scripts and tests. Localize those known reason shapes at
 * the presentation boundary instead of coupling pricing logic to the UI.
 */
export function localizeMarketLimit(reason: string, locale: AppLocale): string {
  if (locale !== "en") return reason;
  if (reason === "成品沒有 Bazaar 行情") return "Output has no Bazaar quote";
  if (reason === "市場流動性") return "Market liquidity";
  if (reason === "目前深度沒有正 Total Profit") return "Current depth has no positive Total Profit";
  if (reason === "邊際 Craft Profit") return "Marginal Craft Profit";
  if (reason === "AH 預設只估算 1 次購買") return "AH estimates one purchase by default";
  if (reason === "NPC 每日庫存") return "NPC daily stock";

  const noQuote = /^(.*) 沒有 Bazaar 行情$/.exec(reason);
  if (noQuote) return `${noQuote[1]} has no Bazaar quote`;
  const weeklyVolume = /^(.*) 近 7 日成交量$/.exec(reason);
  if (weeklyVolume) return `${weeklyVolume[1]} 7-day trading volume`;
  const visibleDepth = /^(.*) (Buy Orders|Sell Offers) 可見深度$/.exec(reason);
  if (visibleDepth) return `${visibleDepth[1]} visible ${visibleDepth[2]} depth`;
  const marketDepth = /^(.*) 市場深度$/.exec(reason);
  if (marketDepth) return `${marketDepth[1]} market depth`;
  return reason;
}
