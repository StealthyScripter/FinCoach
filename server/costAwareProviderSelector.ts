export type ProviderCostLevel = "internal" | "free" | "demo" | "paid";

export type CostAwareProvider = {
  id: string;
  name: string;
  costLevel: ProviderCostLevel;
  enabled: boolean;
  health: "healthy" | "degraded" | "disabled";
  supportsPaidFeatures?: boolean;
  reason?: string | null;
};

export type ProviderSelection = {
  chosen: CostAwareProvider | null;
  candidates: CostAwareProvider[];
  rationale: string[];
  generatedAt: string;
};

const COST_RANK: Record<ProviderCostLevel, number> = {
  internal: 0,
  free: 1,
  demo: 2,
  paid: 3,
};

export class CostAwareProviderSelector {
  choose(candidates: CostAwareProvider[], preferred: ProviderCostLevel[] = ["internal", "free", "demo", "paid"]): ProviderSelection {
    const enabled = candidates.filter((candidate) => candidate.enabled && candidate.health !== "disabled");
    const ordered = [...enabled].sort((left, right) => {
      const leftRank = preferred.indexOf(left.costLevel);
      const rightRank = preferred.indexOf(right.costLevel);
      return (leftRank === -1 ? preferred.length : leftRank) - (rightRank === -1 ? preferred.length : rightRank)
        || COST_RANK[left.costLevel] - COST_RANK[right.costLevel]
        || left.name.localeCompare(right.name);
    });
    const chosen = ordered[0] ?? null;
    return {
      chosen,
      candidates: ordered,
      generatedAt: new Date().toISOString(),
      rationale: chosen ? [
        `${chosen.name} selected because it is enabled and matches the preferred cost order.`,
        `Cost level: ${chosen.costLevel}.`,
      ] : ["No enabled providers were available."],
    };
  }
}

export const costAwareProviderSelector = new CostAwareProviderSelector();
