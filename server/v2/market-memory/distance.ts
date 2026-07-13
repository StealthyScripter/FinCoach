import type { MarketStateVector } from "./contracts";

export function weightedDistance(a: MarketStateVector, b: MarketStateVector, weights: Record<string, number> = {}): number {
  const keys = Array.from(new Set([...Object.keys(a.features), ...Object.keys(b.features)])).sort();
  let total = 0; let compared = 0;
  for (const key of keys) {
    const av = a.features[key]; const bv = b.features[key];
    if (typeof av === "number" && typeof bv === "number") {
      const w = weights[key] ?? 1;
      total += w * (av - bv) ** 2; compared += w;
    } else if (av != null && bv != null) {
      total += av === bv ? 0 : (weights[key] ?? 1); compared += weights[key] ?? 1;
    }
  }
  return compared === 0 ? Number.POSITIVE_INFINITY : Number(Math.sqrt(total / compared).toFixed(8));
}
export function similarityFromDistance(distance: number) {
  return Number((1 / (1 + distance)).toFixed(8));
}
