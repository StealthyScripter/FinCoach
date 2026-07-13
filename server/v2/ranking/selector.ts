import type { RankedStrategy, ResearchPortfolioSelection } from "./contracts";

export function selectFocusedPortfolio(candidates: RankedStrategy[], maxFocusedCount: number): ResearchPortfolioSelection {
  const selected: RankedStrategy[] = [];
  const clusters = new Set<string>();
  for (const candidate of candidates) {
    if (selected.length >= maxFocusedCount) break;
    if (candidate.status !== "candidate") continue;
    if (clusters.has(candidate.correlationCluster)) continue;
    clusters.add(candidate.correlationCluster);
    selected.push({ ...candidate, status: "focused_research" });
  }
  return { maxFocusedCount, strategies: selected, constraints: { maxOnePerCorrelationCluster: true } };
}
