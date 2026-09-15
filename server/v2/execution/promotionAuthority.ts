import { createHash } from "node:crypto";
import type { BacktestResult } from "../backtesting";
import type { StrategyCourtCase } from "../courtroom";
import type { ExternalEvaluation } from "../external-evaluation";
import type { ResearchExperiment } from "../experiments";
import type { ForwardTestRecord } from "../forward-testing";
import type { StrategyLifecycleDecision, StrategyLifecycleState } from "../strategy-lifecycle";
import type { StrategyDefinition } from "../rules";
import type { RankedStrategy, StrategyRankingDecision } from "../ranking";
import type { V2RuntimeConfig } from "../runtime/config";
import type { DemoPromotionRecord } from "./contracts";

export const AUTONOMOUS_PRACTICE_PROMOTION_AUTHORITY = "fincoach.autonomous-practice-promotion-authority";
export const AUTONOMOUS_PRACTICE_PROMOTION_POLICY_VERSION = "fincoach.v2.autonomous-practice-promotion.v1";

type StrategyWithLineage = StrategyDefinition & { lineageEventIds?: readonly string[] };
type CourtCaseWithLineage = StrategyCourtCase & { lineageEventIds?: readonly string[] };
type RankingWithLineage = StrategyRankingDecision & { lineageEventIds?: readonly string[] };
type ResearchExperimentWithLineage = ResearchExperiment & { lineageEventIds?: readonly string[] };

export type AutonomousPracticePromotionInput = {
  strategy: StrategyWithLineage;
  courtCases: readonly CourtCaseWithLineage[];
  rankings: readonly RankingWithLineage[];
  experiments: readonly ResearchExperimentWithLineage[];
  backtests: readonly BacktestResult[];
  forwardTests: readonly ForwardTestRecord[];
  evaluations: readonly ExternalEvaluation[];
  lifecycleDecisions: readonly StrategyLifecycleDecision[];
  existingPromotion?: DemoPromotionRecord | null;
  config: Pick<V2RuntimeConfig, "minBacktestTrades" | "minBacktestDays" | "minForwardTestTrades" | "minForwardTestDays" | "minProfitFactor" | "maxDrawdownPct" | "minSharpeRatio">;
  env: NodeJS.ProcessEnv;
  now: Date;
  correlationId: string;
  causationId: string | null;
};

export type AutonomousPracticePromotionDecision = {
  decision: "PROMOTE" | "HOLD" | "REVOKE";
  reason: string;
  unmetRequirements: string[];
  promotion: DemoPromotionRecord | null;
  metrics: Record<string, number>;
};

const qualifyingLifecycleStates = new Set<StrategyLifecycleState>(["candidate", "focused"]);
const adverseLifecycleStates = new Set<StrategyLifecycleState>(["paused", "degraded", "retired", "archived"]);
const terminalEvaluationOutcomes = new Set(["tp", "sl", "expired", "cancelled"]);

export class AutonomousPracticePromotionAuthority {
  evaluate(input: AutonomousPracticePromotionInput): AutonomousPracticePromotionDecision {
    const latestLifecycle = latestForStrategy(input.lifecycleDecisions, input.strategy.strategyId);
    const currentPromotion = input.existingPromotion ?? null;

    if (latestLifecycle && adverseLifecycleStates.has(latestLifecycle.toState)) {
      if (isActivePromotion(currentPromotion, input.strategy)) {
        return {
          decision: "REVOKE",
          reason: `Newer lifecycle state ${latestLifecycle.toState} revoked practice promotion.`,
          unmetRequirements: [`lifecycle_state_not_execution_eligible:${latestLifecycle.toState}`],
          promotion: buildRevocation(input, currentPromotion!, latestLifecycle),
          metrics: {},
        };
      }
      return hold(`lifecycle_state_not_execution_eligible:${latestLifecycle.toState}`);
    }

    const unmetRequirements = evaluateRequirements(input, latestLifecycle);
    if (unmetRequirements.length) return hold(unmetRequirements.join(","));
    if (!practiceEnvironmentSafe(input.env)) return hold("practice_environment_not_verified");
    if (isActivePromotion(currentPromotion, input.strategy)) return hold("practice_promotion_already_active");

    const promotion = buildPromotion(input, latestLifecycle!);
    return { decision: "PROMOTE", reason: "All versioned research and lifecycle requirements passed.", unmetRequirements: [], promotion, metrics: promotionMetrics(input) };
  }
}

function evaluateRequirements(input: AutonomousPracticePromotionInput, latestLifecycle: StrategyLifecycleDecision | null) {
  const unmet: string[] = [];
  const strategyLineage = new Set(input.strategy.lineageEventIds ?? []);
  if (!input.strategy.strategyId || !input.strategy.hypothesisId || !strategyLineage.has(input.strategy.hypothesisId)) unmet.push("strategy_lineage");
  if (!latestLifecycle) unmet.push("lifecycle_decision");
  else if (!qualifyingLifecycleStates.has(latestLifecycle.toState)) unmet.push(`lifecycle_state:${latestLifecycle.toState}`);
  else if (latestLifecycle.metrics.expectancy <= 0 || latestLifecycle.metrics.edgeDecay >= 0.35 || latestLifecycle.metrics.externalDisagreement >= 0.65) unmet.push("lifecycle_metrics");

  const court = latestCourtCase(input);
  if (!court || !["approve_for_replay", "approve_for_forward_test"].includes(court.verdict)) unmet.push("qualifying_court_verdict");
  if (court && court.strategyVersion !== input.strategy.strategyVersion) unmet.push("court_strategy_version");

  const courtExperimentIds = new Set(court?.experimentIds ?? []);
  const experiments = input.experiments.filter(item => courtExperimentIds.has(item.experimentId) && item.strategyId === input.strategy.strategyId && item.strategyVersion === input.strategy.strategyVersion);
  if (!experiments.length || experiments.some(item => item.status !== "completed" || elapsedDays(item.datasetSpecification.start, item.datasetSpecification.end) < input.config.minBacktestDays || !item.lineageEventIds?.length)) unmet.push("completed_backtest_experiment");

  const backtestIds = new Set(court?.backtestIds ?? []);
  const backtests = input.backtests.filter(item => backtestIds.has(item.backtestId) && item.strategyId === input.strategy.strategyId && item.strategyVersion === input.strategy.strategyVersion);
  if (!backtests.length || backtests.some(item => item.status !== "completed" || item.aggregateMetrics.tradeCount < input.config.minBacktestTrades || item.aggregateMetrics.expectancy <= 0 || item.aggregateMetrics.maxDrawdown > input.config.maxDrawdownPct || item.warnings.length > 0 || !item.lineageEventIds.length)) unmet.push("backtest_thresholds");

  const ranking = latestRanking(input);
  const candidate = ranking?.candidates.find(item => item.strategyId === input.strategy.strategyId && item.strategyVersion === input.strategy.strategyVersion && ["candidate", "focused_research"].includes(item.status));
  if (!candidate || candidate.courtCaseId !== court?.caseId) unmet.push("ranked_candidate");
  if (candidate && (candidate.metrics.oosExpectancy <= 0 || candidate.metrics.maxDrawdown > input.config.maxDrawdownPct)) unmet.push("ranked_candidate_metrics");

  const forwardTests = currentForwardTests(input.forwardTests, input.strategy);
  if (!forwardTests.length || forwardTests.some(item => item.status !== "completed" || !item.demoVerification.demoOnly || item.demoVerification.environment !== "practice" || item.demoVerification.accountMode !== "practice" || !item.lineageEventIds.length)) unmet.push("completed_practice_forward_test");
  const forwardTestIds = new Set(matchingForwardTestIds(input.forwardTests, input.strategy));
  const evaluations = input.evaluations
    .filter(item => item.strategyId === input.strategy.strategyId && item.forwardTestId && forwardTestIds.has(item.forwardTestId) && item.evaluationSource !== "oanda_practice" && terminalEvaluationOutcomes.has(item.outcome) && item.lineageEventIds.length)
    .sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt) || a.evaluationId.localeCompare(b.evaluationId));
  const metrics = performanceMetrics(evaluations);
  if (evaluations.length < input.config.minForwardTestTrades) unmet.push("forward_test_observation_count");
  if (evaluations.length && elapsedDays(evaluations[0]!.evaluatedAt, evaluations.at(-1)!.evaluatedAt) < input.config.minForwardTestDays) unmet.push("forward_test_observation_days");
  if (metrics.expectancy <= 0 || metrics.profitFactor < input.config.minProfitFactor || metrics.maxDrawdownPct > input.config.maxDrawdownPct || metrics.sharpeRatio < input.config.minSharpeRatio) unmet.push("forward_test_performance_thresholds");
  return [...new Set(unmet)];
}

function buildPromotion(input: AutonomousPracticePromotionInput, lifecycle: StrategyLifecycleDecision): DemoPromotionRecord {
  const evidenceEventIds = evidenceIds(input, lifecycle);
  const forwardTestIds = matchingForwardTestIds(input.forwardTests, input.strategy).sort();
  const evaluationIds = input.evaluations.filter(item => item.strategyId === input.strategy.strategyId && item.forwardTestId && forwardTestIds.includes(item.forwardTestId) && item.evaluationSource !== "oanda_practice" && terminalEvaluationOutcomes.has(item.outcome)).map(item => item.evaluationId).sort();
  const idempotencyKey = digest({ action: "promote", strategyId: input.strategy.strategyId, strategyVersion: input.strategy.strategyVersion, lifecycleDecisionId: lifecycle.decisionId, evaluationIds });
  return {
    promotionId: digest({ type: "practice-promotion", idempotencyKey }),
    strategyId: input.strategy.strategyId,
    strategyVersion: input.strategy.strategyVersion,
    authorizedForPractice: true,
    status: "active",
    environment: "practice",
    authority: AUTONOMOUS_PRACTICE_PROMOTION_AUTHORITY,
    approvedBy: AUTONOMOUS_PRACTICE_PROMOTION_AUTHORITY,
    approvedAt: input.now.toISOString(),
    reason: "Autonomous practice promotion: versioned courtroom, backtest, forward-test, performance, and lifecycle evidence qualified.",
    evidenceEventIds,
    lifecycleDecisionId: lifecycle.decisionId,
    forwardTestIds,
    evaluationIds,
    policyVersion: AUTONOMOUS_PRACTICE_PROMOTION_POLICY_VERSION,
    idempotencyKey,
    correlationId: input.correlationId,
    causationId: input.causationId ?? lifecycle.decisionId,
    supersedesPromotionId: input.existingPromotion?.promotionId ?? null,
    lineageEventIds: evidenceEventIds,
  };
}

function buildRevocation(input: AutonomousPracticePromotionInput, current: DemoPromotionRecord, lifecycle: StrategyLifecycleDecision): DemoPromotionRecord {
  const evidenceEventIds = [...new Set([...current.evidenceEventIds, ...(lifecycle.lineageEventIds ?? []), lifecycle.decisionId])].filter(Boolean).sort();
  const idempotencyKey = digest({ action: "revoke", strategyId: input.strategy.strategyId, strategyVersion: input.strategy.strategyVersion, supersedesPromotionId: current.promotionId, lifecycleDecisionId: lifecycle.decisionId });
  const approvedAt = new Date(Math.max(input.now.getTime(), Date.parse(current.approvedAt) + 1)).toISOString();
  return {
    ...current,
    promotionId: digest({ type: "practice-promotion-revocation", idempotencyKey }),
    strategyVersion: input.strategy.strategyVersion,
    authorizedForPractice: false,
    status: "revoked",
    authority: AUTONOMOUS_PRACTICE_PROMOTION_AUTHORITY,
    approvedBy: AUTONOMOUS_PRACTICE_PROMOTION_AUTHORITY,
    approvedAt,
    reason: `Autonomous practice promotion revoked by lifecycle decision ${lifecycle.decisionId}: ${lifecycle.toState}.`,
    evidenceEventIds,
    lifecycleDecisionId: lifecycle.decisionId,
    policyVersion: AUTONOMOUS_PRACTICE_PROMOTION_POLICY_VERSION,
    idempotencyKey,
    correlationId: input.correlationId,
    causationId: lifecycle.decisionId,
    supersedesPromotionId: current.promotionId,
    lineageEventIds: evidenceEventIds,
  };
}

function latestCourtCase(input: AutonomousPracticePromotionInput) {
  return [...input.courtCases].filter(item => item.strategyId === input.strategy.strategyId && item.strategyVersion === input.strategy.strategyVersion).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.caseId.localeCompare(a.caseId))[0] ?? null;
}

function latestRanking(input: AutonomousPracticePromotionInput) {
  return [...input.rankings].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || b.rankingId.localeCompare(a.rankingId)).find(item => item.candidates.some(candidate => candidate.strategyId === input.strategy.strategyId && candidate.strategyVersion === input.strategy.strategyVersion)) ?? null;
}

function currentForwardTests(records: readonly ForwardTestRecord[], strategy: StrategyWithLineage) {
  const matching = matchingForwardRecords(records, strategy);
  const superseded = new Set(matching.map(item => item.supersedesId).filter((id): id is string => Boolean(id)));
  return matching.filter(item => !superseded.has(item.forwardTestId));
}

function matchingForwardRecords(records: readonly ForwardTestRecord[], strategy: StrategyWithLineage) {
  return records.filter(item => item.strategyId === strategy.strategyId && item.strategyVersion === strategy.strategyVersion);
}

function matchingForwardTestIds(records: readonly ForwardTestRecord[], strategy: StrategyWithLineage) {
  return matchingForwardRecords(records, strategy).map(item => item.forwardTestId);
}

function latestForStrategy(records: readonly StrategyLifecycleDecision[], strategyId: string) {
  return [...records].filter(item => item.strategyId === strategyId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.decisionId.localeCompare(a.decisionId))[0] ?? null;
}

function isActivePromotion(promotion: DemoPromotionRecord | null, strategy: StrategyWithLineage) {
  return Boolean(promotion?.authorizedForPractice === true && promotion.status === "active" && promotion.environment === "practice" && promotion.strategyId === strategy.strategyId && promotion.strategyVersion === strategy.strategyVersion);
}

function practiceEnvironmentSafe(env: NodeJS.ProcessEnv) {
  return env.FINCOACH_LIVE_EXECUTION_ENABLED === "false"
    && env.FINCOACH_PAPER_EXECUTION_ENABLED === "false"
    && env.FINCOACH_PORTFOLIO_LIVE_EXECUTION_ENABLED === "false"
    && env.FINCOACH_DEMO_BROKER_EXECUTION_ENABLED === "true"
    && env.OANDA_ENV?.trim().toLowerCase() === "practice"
    && env.OANDA_BASE_URL === "https://api-fxpractice.oanda.com/v3";
}

function evidenceIds(input: AutonomousPracticePromotionInput, lifecycle: StrategyLifecycleDecision) {
  const court = latestCourtCase(input);
  const ranking = latestRanking(input);
  const candidate = ranking?.candidates.find(item => item.strategyId === input.strategy.strategyId && item.strategyVersion === input.strategy.strategyVersion);
  const currentForward = currentForwardTests(input.forwardTests, input.strategy);
  const forwardEvidenceIds = new Set(matchingForwardTestIds(input.forwardTests, input.strategy));
  const evaluationIds = input.evaluations.filter(item => item.strategyId === input.strategy.strategyId && item.forwardTestId && forwardEvidenceIds.has(item.forwardTestId) && item.evaluationSource !== "oanda_practice" && terminalEvaluationOutcomes.has(item.outcome)).flatMap(item => [item.evaluationId, ...item.lineageEventIds]);
  return [...new Set([
    ...(input.strategy.lineageEventIds ?? []), input.strategy.hypothesisId, court?.caseId, ...(court?.lineageEventIds ?? []), ranking?.rankingId, ...(ranking?.lineageEventIds ?? []), candidate?.courtCaseId,
    ...input.experiments.filter(item => court?.experimentIds.includes(item.experimentId)).flatMap(item => [item.experimentId, ...(item.lineageEventIds ?? [])]),
    ...input.backtests.filter(item => court?.backtestIds.includes(item.backtestId)).flatMap(item => [item.backtestId, ...item.lineageEventIds]),
    ...currentForward.flatMap(item => [item.forwardTestId, ...item.lineageEventIds]), ...evaluationIds, lifecycle.decisionId, ...lifecycle.lineageEventIds,
  ].filter((id): id is string => Boolean(id)))].sort();
}

function performanceMetrics(evaluations: readonly ExternalEvaluation[]) {
  const returns = evaluations.map(item => item.r);
  const average = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const grossProfit = returns.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(returns.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  let equity = 100;
  let peak = equity;
  let maxDrawdownPct = 0;
  for (const value of returns) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 100);
  }
  const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / (returns.length - 1) : 0;
  const sharpeRatio = variance > 0 ? (average / Math.sqrt(variance)) * Math.sqrt(returns.length) : 0;
  return { expectancy: Number(average.toFixed(6)), profitFactor: Number(profitFactor.toFixed(6)), maxDrawdownPct: Number(maxDrawdownPct.toFixed(6)), sharpeRatio: Number(sharpeRatio.toFixed(6)) };
}

function promotionMetrics(input: AutonomousPracticePromotionInput) {
  const forwardIds = new Set(matchingForwardTestIds(input.forwardTests, input.strategy));
  return performanceMetrics(input.evaluations.filter(item => item.strategyId === input.strategy.strategyId && item.forwardTestId && forwardIds.has(item.forwardTestId) && item.evaluationSource !== "oanda_practice" && terminalEvaluationOutcomes.has(item.outcome)));
}

function elapsedDays(start: string, end: string) {
  const difference = Date.parse(end) - Date.parse(start);
  return Number.isFinite(difference) && difference >= 0 ? difference / 86_400_000 : 0;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function hold(reason: string): AutonomousPracticePromotionDecision {
  return { decision: "HOLD", reason, unmetRequirements: reason.split(","), promotion: null, metrics: {} };
}
