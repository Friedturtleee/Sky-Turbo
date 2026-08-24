export function formatCoins(value: number, compact = true, locale = "zh-TW"): string {
  if (!Number.isFinite(value)) return "—";
  if (compact) {
    const absolute = Math.abs(value);
    const units = [
      { threshold: 1_000_000_000, suffix: "b" },
      { threshold: 1_000_000, suffix: "m" },
      { threshold: 1_000, suffix: "k" },
    ] as const;
    const unit = units.find(({ threshold }) => absolute >= threshold);
    if (unit) {
      const scaled = value / unit.threshold;
      const maximumFractionDigits = Math.abs(scaled) < 10 ? 2 : Math.abs(scaled) < 100 ? 1 : 0;
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits }).format(scaled)}${unit.suffix}`;
    }
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(value?: number, accumulating = "累積中"): string {
  if (value === undefined || !Number.isFinite(value)) return accumulating;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function tone(value?: number): string {
  if (!value) return "neutral";
  return value > 0 ? "positive" : "negative";
}
