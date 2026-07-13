import assert from "node:assert/strict";
import { StrategyLifecycleV2EventTypes, StrategyLifecycleV2Service } from "./v2/strategy-lifecycle";

const correlationId = "00000000-0000-4000-8000-000000000022";
const service = new StrategyLifecycleV2Service();

const registered = service.recordDecision({
  decisionId: "life-1",
  strategyId: "strategy-1",
  fromState: null,
  toState: "draft",
  reason: "initial strategy record",
  metrics: { expectancy: 0.4, drawdown: 0.05, calibration: 0.8, evidenceAgeDays: 1, regimeMismatch: 0.1, externalDisagreement: 0, edgeDecay: 0.05 },
  createdAt: "2026-01-04T00:00:00.000Z",
  lineageEventIds: ["evolution-event-1"],
  correlationId,
  causationId: null,
});
assert.equal(registered.decision?.schemaVersion, "fincoach.v2.strategy-lifecycle.1");
assert.equal(registered.events[0].eventType, StrategyLifecycleV2EventTypes.StrategyPromoted);

const promoted = service.recordDecision({
  decisionId: "life-2",
  strategyId: "strategy-1",
  fromState: "draft",
  toState: "hypothesis",
  reason: "hypothesis accepted for research",
  metrics: registered.decision!.metrics,
  createdAt: "2026-01-04T01:00:00.000Z",
  lineageEventIds: ["learning-event-1"],
  correlationId,
  causationId: registered.events[0].eventId,
});
assert.equal(promoted.events[0].eventType, StrategyLifecycleV2EventTypes.StrategyPromoted);

const forbidden = service.recordDecision({
  decisionId: "life-bad",
  strategyId: "strategy-1",
  fromState: "hypothesis",
  toState: "focused",
  reason: "skip governance",
  metrics: registered.decision!.metrics,
  createdAt: "2026-01-04T02:00:00.000Z",
  lineageEventIds: ["bad-event"],
  correlationId,
  causationId: null,
});
assert.equal(forbidden.decision, null);
assert.equal(forbidden.events[0].payload.reason, "forbidden_transition");

const degraded = service.evaluateDecay({
  decisionId: "life-decay",
  strategyId: "strategy-1",
  currentState: "focused",
  metrics: { expectancy: -0.2, drawdown: 0.18, calibration: 0.42, evidenceAgeDays: 80, regimeMismatch: 0.7, externalDisagreement: 0.4, edgeDecay: 0.45 },
  createdAt: "2026-01-05T00:00:00.000Z",
  lineageEventIds: ["external-disagreement", "ml-drift"],
  correlationId,
  causationId: null,
});
assert.equal(degraded.decision?.toState, "degraded");
assert.equal(degraded.events[0].eventType, StrategyLifecycleV2EventTypes.StrategyDegraded);

const paused = service.recordDecision({
  decisionId: "life-pause",
  strategyId: "strategy-1",
  fromState: "degraded",
  toState: "paused",
  reason: "manual governance pause after decay",
  metrics: degraded.decision!.metrics,
  createdAt: "2026-01-05T01:00:00.000Z",
  lineageEventIds: ["decay-event"],
  correlationId,
  causationId: degraded.events[0].eventId,
});
assert.equal(paused.events[0].eventType, StrategyLifecycleV2EventTypes.StrategyPaused);

const recovered = service.recordDecision({
  decisionId: "life-recover",
  strategyId: "strategy-1",
  fromState: "paused",
  toState: "focused",
  reason: "fresh evidence restored calibration",
  metrics: { expectancy: 0.3, drawdown: 0.04, calibration: 0.82, evidenceAgeDays: 3, regimeMismatch: 0.1, externalDisagreement: 0, edgeDecay: 0.02 },
  createdAt: "2026-01-06T00:00:00.000Z",
  lineageEventIds: ["new-evidence"],
  correlationId,
  causationId: paused.events[0].eventId,
});
assert.equal(recovered.events[0].eventType, StrategyLifecycleV2EventTypes.StrategyRecovered);

const retired = service.recordDecision({
  decisionId: "life-retire",
  strategyId: "strategy-1",
  fromState: "focused",
  toState: "retired",
  reason: "persistent edge decay",
  metrics: { expectancy: -0.4, drawdown: 0.3, calibration: 0.3, evidenceAgeDays: 120, regimeMismatch: 0.8, externalDisagreement: 0.7, edgeDecay: 0.8 },
  createdAt: "2026-01-07T00:00:00.000Z",
  lineageEventIds: ["retirement-evidence"],
  correlationId,
  causationId: recovered.events[0].eventId,
});
assert.equal(retired.events[0].eventType, StrategyLifecycleV2EventTypes.StrategyRetired);

assert.equal(service.recordDecision({ ...registered.decision!, fromState: null }).events[0].eventType, StrategyLifecycleV2EventTypes.StrategyLifecycleDuplicateSuppressed);
assert.equal(service.history("strategy-1").length, 6);

const restarted = new StrategyLifecycleV2Service(service.repositorySnapshot());
const concurrent = await Promise.all(Array.from({ length: 5 }, () => restarted.recordDecision({
  decisionId: "life-concurrent",
  strategyId: "strategy-2",
  fromState: null,
  toState: "draft",
  reason: "concurrent initial record",
  metrics: registered.decision!.metrics,
  createdAt: "2026-01-08T00:00:00.000Z",
  lineageEventIds: ["concurrent-lineage"],
  correlationId,
  causationId: null,
})));
assert.equal(concurrent.filter(result => result.events[0].eventType === StrategyLifecycleV2EventTypes.StrategyPromoted).length, 1);
assert.equal(concurrent.filter(result => result.events[0].eventType === StrategyLifecycleV2EventTypes.StrategyLifecycleDuplicateSuppressed).length, 4);
assert.equal("generateHypothesis" in service || "publishSignal" in service || "executeTrade" in service, false);

console.log("v2 phase 22 strategy-lifecycle tests passed");
