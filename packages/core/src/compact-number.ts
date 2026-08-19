const compactMultipliers = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
} as const;

export function parseCompactNumber(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value === null || value === undefined) return undefined;
  const normalized = value.trim().replaceAll(",", "");
  if (!normalized) return undefined;
  const match = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([kmb])?$/i);
  if (!match?.[1]) return undefined;
  const amount = Number(match[1]);
  const suffix = match[2]?.toLowerCase() as keyof typeof compactMultipliers | undefined;
  const result = amount * (suffix ? compactMultipliers[suffix] : 1);
  return Number.isFinite(result) ? result : undefined;
}
