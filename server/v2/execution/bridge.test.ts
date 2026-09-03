import assert from "node:assert/strict";
import { V2OandaPracticeExecutionBridge, externalEvaluationFromBrokerOutcome } from "./bridge";
import { InMemoryV2ExecutionRequestRepository } from "./repository";
import type { V2ResearchSignal } from "../signals";
import type { StrategyDefinition } from "../rules";
import type { ForwardTestRecord } from "../forward-testing";

const env = { FINCOACH_DEMO_BROKER_EXECUTION_ENABLED: "true", FINCOACH_LIVE_EXECUTION_ENABLED: "false", FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED: "false", OANDA_ENV: "practice", OANDA_BASE_URL: "https://api-fxpractice.oanda.com/v3" };
const now = new Date("2026-09-03T01:00:00.000Z");
const signal = { schema: "fincoach.signal.v2", signalId: "signal-1", symbol: "EUR/USD", side: "buy", entryPrice: 1.1, stopLoss: 1.09, takeProfit: 1.12, timeframe: "1m", strategyId: "strategy-1", strategyVersion: 1, courtCaseId: "court-1", forwardTestId: "forward-1", confidence: .9, evidenceScore: .9, validUntil: "2026-09-03T02:00:00.000Z", demoOnly: true, createdAt: now.toISOString(), lineageEventIds: ["strategy-1", "signal-source"], correlationId: "correlation-1", causationId: "causation-1" } as V2ResearchSignal;
const strategy = { strategyId: "strategy-1", strategyVersion: 1, researchOnly: true } as StrategyDefinition & { researchOnly: boolean };
const forwardTest = { forwardTestId: "forward-1", strategyId: "strategy-1", strategyVersion: 1, courtCaseId: "court-1", rankingId: "ranking-1", status: "monitoring", demoVerification: { demoOnly: true, environment: "practice", accountMode: "practice", verifiedAt: now.toISOString() }, snapshot: { snapshotId: "snapshot-1", symbol: "EUR/USD", timestamp: now.toISOString(), bid: 1.1, ask: 1.1002, spread: .0002, fresh: true, contextEventId: "context-1", lineageEventIds: ["snapshot-source"] }, ruleEvaluation: {}, reason: "validated", counterargument: "", expectedR: 1.5, risk: .001, createdAt: now.toISOString(), lineageEventIds: ["forward-source"], correlationId: "correlation-1", causationId: "causation-1" } as unknown as ForwardTestRecord;
const promotion = { promotionId: "promotion-1", strategyId: "strategy-1", authorizedForPractice: true as const, approvedBy: "operator", approvedAt: now.toISOString(), reason: "validated", lineageEventIds: ["promotion-source"] };

let brokerCalls = 0;
const broker = { async submitAutonomousPractice() { brokerCalls += 1; return { provider: "oanda_practice" as const, orderId: "order-1", status: "filled" as const, reason: null, submittedAt: now.toISOString(), requestedUnits: 1, filledUnits: 1, remainingUnits: 0, averageFillPrice: 1.1002, brokerTradeId: "trade-1", brokerFillTransactionId: "fill-1", productionOrderSubmissionEnabled: false as const }; } };

const ineligible = await new V2OandaPracticeExecutionBridge(new InMemoryV2ExecutionRequestRepository(), broker).process({ signal, strategy, forwardTest, lifecycle: { decisionId: "decision-1", toState: "candidate" }, killSwitchActive: false, practiceCapacityAvailable: true, env, now });
assert.equal(ineligible.eligibility.eligible, false);
assert.equal(ineligible.eligibility.reason, "research_only_without_explicit_promotion");
assert.equal(ineligible.request?.status, "failed");
assert.equal(brokerCalls, 0);
for (const [reason, overrides] of [
  ["signal_expired", { signal: { ...signal, signalId: "expired", validUntil: "2026-09-02T00:00:00.000Z" } }],
  ["missing_strategy_lineage", { signal: { ...signal, signalId: "no-lineage", lineageEventIds: ["signal-source"] } }],
  ["kill_switch_active", { signal: { ...signal, signalId: "kill" }, killSwitchActive: true }],
  ["practice_capacity_exhausted", { signal: { ...signal, signalId: "capacity" }, practiceCapacityAvailable: false }],
  ["oanda_practice_endpoint_required", { signal: { ...signal, signalId: "live-endpoint" }, env: { ...env, OANDA_BASE_URL: "https://api-fxtrade.oanda.com/v3" } }],
] as const) {
  const result = await new V2OandaPracticeExecutionBridge(new InMemoryV2ExecutionRequestRepository(), broker).process({ signal, strategy, forwardTest, lifecycle: { decisionId: "decision-1", toState: "candidate" }, promotion, killSwitchActive: false, practiceCapacityAvailable: true, env, now, ...overrides });
  assert.equal(result.eligibility.reason, reason);
}
assert.equal(brokerCalls, 0);

const repository = new InMemoryV2ExecutionRequestRepository();
const bridge = new V2OandaPracticeExecutionBridge(repository, broker);
const eligible = await bridge.process({ signal, strategy, forwardTest, lifecycle: { decisionId: "decision-1", toState: "candidate" }, promotion, killSwitchActive: false, practiceCapacityAvailable: true, env, now });
assert.equal(eligible.eligibility.eligible, true);
assert.equal(eligible.request?.status, "filled");
assert.equal(eligible.request?.brokerOrderId, "order-1");
assert.equal(eligible.request?.brokerTradeId, "trade-1");
assert.equal(eligible.request?.brokerFillTransactionId, "fill-1");
assert.equal(brokerCalls, 1);

const duplicate = await bridge.process({ signal, strategy, forwardTest, lifecycle: { decisionId: "decision-1", toState: "candidate" }, promotion, killSwitchActive: false, practiceCapacityAvailable: true, env, now });
assert.equal(duplicate.eligibility.reason, "duplicate_execution_request");
assert.equal(brokerCalls, 1);

const closed = await bridge.reconcileClosedTrades([{ id: "trade-1", instrument: "EUR/USD", providerSymbol: "EUR_USD", side: "buy", units: 1, price: 1.1002, openedAt: now.toISOString(), state: "closed", realizedPnL: 0.02, closedAt: "2026-09-03T01:30:00.000Z", closingTransactionId: "close-1" }]);
assert.equal(closed.length, 1);
assert.ok(Math.abs((closed[0]?.realizedR ?? 0) - 2) < 1e-9);
assert.equal(closed[0]?.status, "closed");
assert.equal((await bridge.reconcileClosedTrades([{ id: "trade-1", instrument: "EUR/USD", providerSymbol: "EUR_USD", side: "buy", units: 1, price: 1.1002, openedAt: now.toISOString(), state: "closed", realizedPnL: 0.02, closedAt: "2026-09-03T01:30:00.000Z" }])).length, 0);
const evaluation = externalEvaluationFromBrokerOutcome(closed[0]!);
assert.equal(evaluation?.evaluationSource, "oanda_practice");
assert.equal(evaluation?.brokerTradeId, "trade-1");
assert.equal(evaluation?.outcome, "tp");
assert.equal(externalEvaluationFromBrokerOutcome(closed[0]!)?.evaluationId, evaluation?.evaluationId);
console.log("V2 OANDA practice execution bridge tests passed");
