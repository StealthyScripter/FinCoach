import { createDomainEvent, type DomainEvent } from "../contracts";
import type { StrategyDecayEvaluationInput, StrategyLifecycleDecision, StrategyLifecycleDecisionInput, StrategyLifecycleErrorCode, StrategyLifecycleHealth, StrategyLifecycleMetrics, StrategyLifecycleState } from "./contracts";
import { StrategyLifecycleV2EventTypes } from "./events";
import { InMemoryStrategyLifecycleRepository } from "./repository";

type LifecycleResult = { decision: StrategyLifecycleDecision | null; events: DomainEvent[] };

const legalTransitions: Record<StrategyLifecycleState, readonly StrategyLifecycleState[]> = {
  draft: ["hypothesis", "archived"],
  hypothesis: ["experiment", "archived"],
  experiment: ["validated", "paused", "retired"],
  validated: ["court-approved", "paused", "retired"],
  "court-approved": ["forward-test", "paused", "retired"],
  "forward-test": ["candidate", "degraded", "paused", "retired"],
  candidate: ["focused", "paused", "degraded", "retired"],
  focused: ["paused", "degraded", "retired"],
  paused: ["focused", "retired", "archived"],
  degraded: ["paused", "retired", "focused"],
  retired: ["archived"],
  archived: [],
};

export class StrategyLifecycleV2Service {
  private readonly repository: InMemoryStrategyLifecycleRepository;

  constructor(repositoryOrSeed: InMemoryStrategyLifecycleRepository | readonly StrategyLifecycleDecision[] = new InMemoryStrategyLifecycleRepository()) {
    this.repository = repositoryOrSeed instanceof InMemoryStrategyLifecycleRepository ? repositoryOrSeed : new InMemoryStrategyLifecycleRepository(repositoryOrSeed);
  }

  recordDecision(input: StrategyLifecycleDecisionInput): LifecycleResult {
    const rejected = validate(input);
    if (rejected) return this.reject(input, rejected);
    const decision: StrategyLifecycleDecision = { ...input, schemaVersion: "fincoach.v2.strategy-lifecycle.1" };
    const saved = this.repository.save(decision);
    return { decision: saved.decision, events: [createDomainEvent({ eventType: saved.inserted ? eventFor(saved.decision) : StrategyLifecycleV2EventTypes.StrategyLifecycleDuplicateSuppressed, sourceModule: "strategy-lifecycle", correlationId: input.correlationId, causationId: input.causationId, payload: { decisionId: saved.decision.decisionId, strategyId: saved.decision.strategyId, toState: saved.decision.toState } })] };
  }

  evaluateDecay(input: StrategyDecayEvaluationInput): LifecycleResult {
    const toState = decayState(input.currentState, input.metrics);
    return this.recordDecision({
      decisionId: input.decisionId,
      strategyId: input.strategyId,
      fromState: input.currentState,
      toState,
      reason: toState === "retired" ? "edge decay exceeded retirement threshold" : "edge decay exceeded degradation threshold",
      metrics: input.metrics,
      createdAt: input.createdAt,
      lineageEventIds: input.lineageEventIds,
      correlationId: input.correlationId,
      causationId: input.causationId,
    });
  }

  history(strategyId: string) {
    return this.repository.history(strategyId);
  }

  repositorySnapshot() {
    return this.repository.snapshot();
  }

  health(checkedAt = new Date().toISOString()): StrategyLifecycleHealth {
    return { module: "strategy-lifecycle", status: "healthy", schemaVersion: "fincoach.v2.strategy-lifecycle.1", checkedAt, decisionCount: this.repository.list().length };
  }

  private reject(input: StrategyLifecycleDecisionInput, reason: StrategyLifecycleErrorCode): LifecycleResult {
    return { decision: null, events: [createDomainEvent({ eventType: StrategyLifecycleV2EventTypes.StrategyLifecycleRejected, sourceModule: "strategy-lifecycle", correlationId: input.correlationId, causationId: input.causationId, payload: { reason, decisionId: input.decisionId, strategyId: input.strategyId } })] };
  }
}

function validate(input: StrategyLifecycleDecisionInput): StrategyLifecycleErrorCode | null {
  if (!input.decisionId || !input.strategyId || !input.reason || !input.correlationId) return "missing_required_field";
  if (!input.lineageEventIds.length) return "missing_lineage";
  if (!metricsValid(input.metrics)) return "invalid_metrics";
  if (input.fromState === null) return input.toState === "draft" ? null : "forbidden_transition";
  if (!legalTransitions[input.fromState].includes(input.toState)) return "forbidden_transition";
  return null;
}

function metricsValid(metrics: StrategyLifecycleMetrics) {
  return Object.values(metrics).every(Number.isFinite);
}

function decayState(currentState: StrategyLifecycleState, metrics: StrategyLifecycleMetrics): StrategyLifecycleState {
  if (metrics.edgeDecay >= 0.75 || metrics.drawdown >= 0.25 || metrics.externalDisagreement >= 0.65) return "retired";
  if (metrics.expectancy < 0 || metrics.calibration < 0.5 || metrics.evidenceAgeDays > 60 || metrics.regimeMismatch >= 0.6 || metrics.edgeDecay >= 0.35) return "degraded";
  return currentState;
}

function eventFor(decision: StrategyLifecycleDecision) {
  if (decision.toState === "paused") return StrategyLifecycleV2EventTypes.StrategyPaused;
  if (decision.toState === "degraded") return StrategyLifecycleV2EventTypes.StrategyDegraded;
  if (decision.toState === "retired" || decision.toState === "archived") return StrategyLifecycleV2EventTypes.StrategyRetired;
  if ((decision.fromState === "paused" || decision.fromState === "degraded") && decision.toState === "focused") return StrategyLifecycleV2EventTypes.StrategyRecovered;
  return StrategyLifecycleV2EventTypes.StrategyPromoted;
}

export const strategyLifecycleV2Service = new StrategyLifecycleV2Service();
