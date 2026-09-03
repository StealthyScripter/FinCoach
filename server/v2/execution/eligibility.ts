import type { DemoEligibilityInput, DemoExecutionEligibility, DemoExecutionLifecycleState } from "./contracts";

const permittedLifecycleStates = new Set<DemoExecutionLifecycleState>(["candidate", "focused"]);

export function evaluateDemoExecutionEligibility(input: DemoEligibilityInput): DemoExecutionEligibility {
  const now = input.now ?? new Date();
  const base = { strategyId: input.signal.strategyId, signalId: input.signal.signalId, forwardTestId: input.signal.forwardTestId, lifecycleDecisionId: input.lifecycle?.decisionId ?? null, evaluatedAt: now.toISOString() };
  const reject = (reason: string) => ({ ...base, eligible: false, reason });
  if (!input.signal.signalId) return reject("missing_signal");
  if (!input.signal.strategyId || !input.signal.lineageEventIds.includes(input.signal.strategyId)) return reject("missing_strategy_lineage");
  if (Date.parse(input.signal.validUntil) <= now.getTime()) return reject("signal_expired");
  if (!input.strategy || input.strategy.strategyId !== input.signal.strategyId) return reject("strategy_not_found");
  if (!input.forwardTest || input.forwardTest.forwardTestId !== input.signal.forwardTestId) return reject("forward_test_not_found");
  if (!["monitoring", "completed"].includes(input.forwardTest.status)) return reject("forward_test_not_qualifying");
  if (!input.forwardTest.lineageEventIds.length || !input.forwardTest.demoVerification.demoOnly || input.forwardTest.demoVerification.environment !== "practice" || input.forwardTest.demoVerification.accountMode !== "practice") return reject("missing_qualifying_forward_test_evidence");
  if (input.forwardTest.courtCaseId !== input.signal.courtCaseId || !input.forwardTest.rankingId) return reject("missing_qualifying_ranking_evidence");
  if (input.strategy.researchOnly !== false && !(input.promotion?.authorizedForPractice === true && input.promotion.strategyId === input.strategy.strategyId)) return reject("research_only_without_explicit_promotion");
  if (!input.lifecycle || !permittedLifecycleStates.has(input.lifecycle.toState as DemoExecutionLifecycleState)) return reject("lifecycle_state_not_permitted");
  if (input.killSwitchActive) return reject("kill_switch_active");
  const env = input.env ?? process.env;
  if (env.FINCOACH_DEMO_BROKER_EXECUTION_ENABLED !== "true") return reject("demo_execution_disabled");
  if (env.FINCOACH_LIVE_EXECUTION_ENABLED !== "false") return reject("live_execution_not_false");
  if (env.FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED !== "false") return reject("portfolio_live_execution_not_false");
  if (env.OANDA_ENV?.trim().toLowerCase() !== "practice") return reject("oanda_environment_not_practice");
  if (env.OANDA_BASE_URL !== "https://api-fxpractice.oanda.com/v3") return reject("oanda_practice_endpoint_required");
  if (!input.practiceCapacityAvailable) return reject("practice_capacity_exhausted");
  return { ...base, eligible: true, reason: "eligible" };
}
