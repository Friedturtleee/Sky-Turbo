export interface ChartPriceRange {
  minValue: number;
  maxValue: number;
}

/**
 * Keeps a historical chart focused on the current price regime. Values farther
 * than the configured percentage from the median of the newest samples are
 * treated as display outliers; the underlying history is left untouched.
 */
export function calculateRobustChartPriceRange(
  values: number[],
  maxChangePercent = 1_000,
): ChartPriceRange | undefined {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);
  if (valid.length === 0) return undefined;

  const recentCount = Math.min(valid.length, Math.max(5, Math.ceil(valid.length * 0.1)));
  const recent = [...valid.slice(-recentCount)].sort((left, right) => left - right);
  const middle = Math.floor(recent.length / 2);
  const anchor = recent.length % 2 === 0
    ? (recent[middle - 1]! + recent[middle]!) / 2
    : recent[middle]!;
  const factor = 1 + Math.max(0, maxChangePercent) / 100;
  const lowerBound = anchor / factor;
  const upperBound = anchor * factor;
  const inliers = valid.filter((value) => value >= lowerBound && value <= upperBound);
  const minimum = Math.min(...inliers);
  const maximum = Math.max(...inliers);
  const padding = minimum === maximum
    ? Math.max(maximum * 0.05, 0.01)
    : (maximum - minimum) * 0.06;

  return {
    minValue: Math.max(0, minimum - padding),
    maxValue: maximum + padding,
  };
}
