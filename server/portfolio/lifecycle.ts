import type { PortfolioDecisionEvent, PortfolioStrategy } from "./domain";

export type PortfolioLifecycleStage = "EXPERIMENTAL" | "BACKTEST_QUALIFIED" | "WALK_FORWARD_QUALIFIED" | "VIRTUAL_FORWARD" | "MATURE" | "LIVE_CANDIDATE" | "DEGRADED" | "DEMOTED" | "RETIRED";

export function lifecycleDecision(input: { strategy: PortfolioStrategy; backtestPassed: boolean; walkForwardPassed: boolean; forwardDays: number; drawdownPct: number; now?: Date }) {
  const now = input.now ?? new Date();
  let stage: PortfolioLifecycleStage = input.strategy.riskLevel >= 10 ? "EXPERIMENTAL" : "BACKTEST_QUALIFIED";
  let reason = "Initial lifecycle review.";
  if (!input.backtestPassed) {
    stage = "DEGRADED";
    reason = "Backtest requirements failed.";
  } else if (!input.walkForwardPassed) {
    stage = "BACKTEST_QUALIFIED";
    reason = "Backtest passed; walk-forward still required.";
  } else if (input.forwardDays < 14) {
    stage = "WALK_FORWARD_QUALIFIED";
    reason = "Walk-forward passed; virtual forward duration still required.";
  } else if (input.drawdownPct > Math.max(10, input.strategy.riskLevel * 4)) {
    stage = "DEMOTED";
    reason = "Drawdown exceeded mandate tolerance.";
  } else if (input.forwardDays >= 60) {
    stage = "LIVE_CANDIDATE";
    reason = "Evidence supports operator review for live consideration; no real-money promotion is automatic.";
  } else {
    stage = "MATURE";
    reason = "Backtest, walk-forward, and virtual forward evidence are acceptable.";
  }
  return { stage, reason, createdAt: now.toISOString(), liveExecutionBlocked: true };
}

export function mutateStrategy(parent: PortfolioStrategy, input: { suffix: string; now?: Date; maxRiskDelta?: number }): PortfolioStrategy {
  const now = input.now ?? new Date();
  const maxRiskDelta = input.maxRiskDelta ?? 1;
  return {
    ...parent,
    id: `${parent.id}-v${parent.strategyVersion + 1}-${input.suffix.toLowerCase()}`,
    shortName: `${parent.shortName}${input.suffix}`.slice(0, 12),
    name: `${parent.name} ${input.suffix}`,
    strategyVersion: parent.strategyVersion + 1,
    parentStrategyId: parent.id,
    riskLevel: Math.min(10, Math.max(1, parent.riskLevel + Math.sign(maxRiskDelta))),
    lifecycleState: "RESEARCH",
    parameters: { ...parent.parameters, mutation: input.suffix, parentVersion: parent.strategyVersion },
    researchHypothesis: `${parent.researchHypothesis} Variant ${input.suffix} tests bounded parameter mutation.`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function lifecycleEvent(input: { strategy: PortfolioStrategy; stage: PortfolioLifecycleStage; reason: string; now?: Date }): PortfolioDecisionEvent {
  const now = input.now ?? new Date();
  return { id: `portfolio-lifecycle:${input.strategy.id}:${input.stage}:${now.toISOString()}`, portfolioId: null, strategyId: input.strategy.id, eventType: input.stage, symbol: null, reason: input.reason, beforeState: { lifecycleState: input.strategy.lifecycleState }, afterState: { stage: input.stage }, evidence: { liveExecutionBlocked: true }, expectedEffect: {}, actualEffect: {}, createdAt: now.toISOString() };
}
