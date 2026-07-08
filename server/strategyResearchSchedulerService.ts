import { BacktestService, type BacktestResult } from "./strategy-machine/backtesting";
import { DemoOnlyPolicyService } from "./execution/demoOnlyPolicy";
import { ExperimentManagerService } from "./strategy-machine/experiment-manager";
import { ForwardTestService } from "./strategy-machine/forward-testing";
import { HypothesisService } from "./strategy-machine/hypothesis";
import { TradeJournalService } from "./strategy-machine/journal";
import { MarketDataService, type Candle } from "./strategy-machine/market-data";
import { PatternDiscoveryService } from "./strategy-machine/pattern-discovery";
import { RuleBuilderService, type RuleSet } from "./strategy-machine/rule-builder";
import { StrategyRankingService, type StrategyStatus } from "./strategy-machine/strategy-ranking";
import { ValidationService, type ValidationResult } from "./strategy-machine/validation";
import { eventLogService } from "./eventLogService";
import { executionAuditLog } from "./execution/riskControls";
import { strategyEvidenceStore } from "./execution/strategyEvidenceStore";
import { historicalDataImportService, type BacktestSampleDepthReport, type HistoricalDataCoverage, type HistoricalDataImportService, type HistoricalImportStatus } from "./historicalDataImportService";
import { toEventReference, type EventEnvelope, type EventReference } from "./strategy-machine/core";

const DEFAULT_SYMBOLS = ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD"] as const;
const DEFAULT_PATTERN_FAMILIES = [
  "volatility compression breakout",
  "London/session breakout",
  "EMA pullback continuation",
  "support/resistance reaction",
  "liquidity sweep reversal",
] as const;
const MIN_PROMOTION_SAMPLE_SIZE = 30;
const MIN_PROMOTION_EVIDENCE_SCORE = 0.68;
const MAX_PROMOTION_DRAWDOWN_R = 3;

type CandidateStatus = "rejected" | "insufficient_data" | "watch" | "candidate" | "forward_test";

export type PromotionQuality = {
  patternCount: number;
  sampleSize: number;
  evidenceScore: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  objectiveRuleSet: boolean;
  backtestMetricsPresent: boolean;
  stopLossTakeProfitPresent: boolean;
  invalidationRulePresent: boolean;
  marketSnapshotBeforeEntry: boolean;
  journalRequiredFieldsPresent: boolean;
  demoOnlyApproved: boolean;
  eventLineageComplete: boolean;
  fullEvidence: boolean;
  rejectionReasons: string[];
};

export type StrategyResearchCandidate = {
  experimentId: string;
  symbol: string;
  hypothesisId: string;
  ruleSetId: string;
  ruleVersion: number;
  validationVerdict: string;
  rankingStatus: StrategyStatus;
  status: CandidateStatus;
  forwardTestId: string | null;
  journalId: string | null;
  reason: string;
  quality: PromotionQuality;
  journal: {
    stopLoss: number | null;
    takeProfit: number | null;
    beforeEntrySnapshotRefs: number;
    sourceEventRefs: number;
    lessonLearned: string | null;
  };
  eventIds: string[];
};

export type StrategyResearchPipelineStatus = {
  enabled: boolean;
  mode: "demo_observation";
  running: boolean;
  lastRunAt: string | null;
  lastSkipReason: string | null;
  allowedSymbols: string[];
  allowedStrategies: string[];
  patternFamilies: string[];
  health: {
    status: "idle" | "healthy" | "blocked";
    cyclesRun: number;
    safetyBlocks: number;
    liveExecutionEnabled: false;
  };
  experimentQueue: Array<{ experimentId: string; symbol: string; status: CandidateStatus; validationVerdict: string }>;
  latestDiscoveredPatterns: Array<{ eventId: string; symbol: string; patternType: string; confidence: number }>;
  latestHypotheses: Array<{ eventId: string; hypothesisId: string; symbol: string; status: string; score: number }>;
  historicalDataCoverage: HistoricalDataCoverage[];
  latestImportStatus: HistoricalImportStatus | null;
  sampleDepthReports: BacktestSampleDepthReport[];
  missingHistoryWarnings: string[];
  promotedCandidates: StrategyResearchCandidate[];
  rejectedCandidates: StrategyResearchCandidate[];
  counts: {
    patternsDetected: number;
    hypothesesCreated: number;
    ruleSetsCreated: number;
    experimentsCreated: number;
    backtestsRun: number;
    validationsRun: number;
    promoted: number;
    forwardTestsStarted: number;
    journalEntriesCreated: number;
    rejected: number;
    weakRejectedCount: number;
    insufficientDataCount: number;
    promotedWithFullEvidenceCount: number;
    promotedWithoutFullEvidenceCount: number;
  };
  latestRejectionReasons: string[];
};

export type StrategyResearchCycleResult = StrategyResearchPipelineStatus & {
  eventsCreated: number;
};

export function evaluatePromotionReadiness(input: {
  validationVerdict: string;
  validationResult: Partial<ValidationResult> | null;
  backtestResult: Partial<BacktestResult> | null;
  detectedPatternCount: number;
  ruleSet: Partial<RuleSet> | null;
  invalidationEvidenceCount: number;
  demoOnlyApproved: boolean;
  marketSnapshotRefCount: number;
  journal: {
    entryReason?: string | null;
    hypothesisId?: string | null;
    ruleVersion?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
    expectedOutcome?: string | null;
    actualOutcome?: string | null;
    lessonLearned?: string | null;
    beforeEntrySnapshotRefs?: EventReference[];
    sourceEventRefs?: EventReference[];
  } | null;
  eventLineageRefs: EventReference[];
  historicalStabilityApproved?: boolean;
}): PromotionQuality {
  const sampleSize = Number(input.validationResult?.actualSampleSize ?? 0);
  const evidenceScore = Number(input.validationResult?.evidenceScore ?? 0);
  const expectancy = Number(input.backtestResult?.expectancy ?? 0);
  const profitFactor = Number(input.backtestResult?.profitFactor ?? 0);
  const maxDrawdown = Number(input.backtestResult?.maxDrawdown ?? 0);
  const objectiveRuleSet = Boolean(
    input.ruleSet?.ruleSetId
    && input.ruleSet.entryCondition?.length
    && input.ruleSet.exitCondition?.length
    && input.ruleSet.stopLossRule?.length
    && input.ruleSet.takeProfitRule?.length
    && input.ruleSet.sourceHypothesisRefs?.length,
  );
  const backtestMetricsPresent = [sampleSize, evidenceScore, expectancy, profitFactor, maxDrawdown].every(Number.isFinite)
    && sampleSize > 0
    && profitFactor >= 0
    && maxDrawdown >= 0;
  const stopLossTakeProfitPresent = Boolean(input.ruleSet?.stopLossRule?.length && input.ruleSet.takeProfitRule?.length)
    && Number(input.journal?.stopLoss ?? 0) > 0
    && Number(input.journal?.takeProfit ?? 0) > 0;
  const invalidationRulePresent = input.invalidationEvidenceCount > 0 || Boolean(input.ruleSet?.stopLossRule?.length);
  const marketSnapshotBeforeEntry = input.marketSnapshotRefCount > 0 && Boolean(input.journal?.beforeEntrySnapshotRefs?.length);
  const journalRequiredFieldsPresent = Boolean(
    input.journal?.entryReason?.trim()
    && input.journal.hypothesisId?.trim()
    && Number(input.journal.ruleVersion ?? 0) > 0
    && Number(input.journal.stopLoss ?? 0) > 0
    && Number(input.journal.takeProfit ?? 0) > 0
    && input.journal.expectedOutcome
    && input.journal.actualOutcome
    && input.journal.lessonLearned?.trim()
    && input.journal.beforeEntrySnapshotRefs?.length
    && input.journal.sourceEventRefs?.length,
  );
  const eventLineageComplete = input.eventLineageRefs.length >= 5;
  const rejectionReasons = [
    input.detectedPatternCount < 2 ? "At least two detected patterns are required." : null,
    sampleSize < MIN_PROMOTION_SAMPLE_SIZE ? `Minimum sample depth ${MIN_PROMOTION_SAMPLE_SIZE} not met; actual ${sampleSize}.` : null,
    evidenceScore < MIN_PROMOTION_EVIDENCE_SCORE ? `Minimum evidence score ${MIN_PROMOTION_EVIDENCE_SCORE} not met; actual ${round(evidenceScore)}.` : null,
    input.validationVerdict !== "candidate" && input.validationVerdict !== "ready_for_forward_test" ? `Validation verdict ${input.validationVerdict} is not promotable.` : null,
    input.validationResult?.overfittingWarning ? "Validation flagged overfitting or unstable backtest evidence." : null,
    maxDrawdown > MAX_PROMOTION_DRAWDOWN_R ? `Maximum drawdown ${round(maxDrawdown)} exceeds ${MAX_PROMOTION_DRAWDOWN_R}R.` : null,
    !objectiveRuleSet ? "Objective rule set is required." : null,
    !backtestMetricsPresent ? "Required backtest metrics are missing or invalid." : null,
    !stopLossTakeProfitPresent ? "Stop-loss and take-profit logic are required." : null,
    !invalidationRulePresent ? "Invalidation evidence or stop-loss invalidation rule is required." : null,
    !marketSnapshotBeforeEntry ? "Market snapshot before entry is required." : null,
    !journalRequiredFieldsPresent ? "Journal entry requirements are incomplete." : null,
    !input.demoOnlyApproved ? "Demo-only policy approval is required." : null,
    !eventLineageComplete ? "Complete event lineage is required." : null,
    input.historicalStabilityApproved === false ? "Historical stability comparison approval is required." : null,
  ].filter((reason): reason is string => Boolean(reason));
  return {
    patternCount: input.detectedPatternCount,
    sampleSize,
    evidenceScore,
    expectancy,
    profitFactor,
    maxDrawdown,
    objectiveRuleSet,
    backtestMetricsPresent,
    stopLossTakeProfitPresent,
    invalidationRulePresent,
    marketSnapshotBeforeEntry,
    journalRequiredFieldsPresent,
    demoOnlyApproved: input.demoOnlyApproved,
    eventLineageComplete,
    fullEvidence: rejectionReasons.length === 0,
    rejectionReasons,
  };
}

export class StrategyResearchSchedulerService {
  private status: StrategyResearchPipelineStatus = {
    enabled: false,
    mode: "demo_observation",
    running: false,
    lastRunAt: null,
    lastSkipReason: null,
    allowedSymbols: [...DEFAULT_SYMBOLS],
    allowedStrategies: [],
    patternFamilies: [...DEFAULT_PATTERN_FAMILIES],
    health: { status: "idle", cyclesRun: 0, safetyBlocks: 0, liveExecutionEnabled: false },
    experimentQueue: [],
    latestDiscoveredPatterns: [],
    latestHypotheses: [],
    historicalDataCoverage: [],
    latestImportStatus: null,
    sampleDepthReports: [],
    missingHistoryWarnings: [],
    promotedCandidates: [],
    rejectedCandidates: [],
    counts: {
      patternsDetected: 0,
      hypothesesCreated: 0,
      ruleSetsCreated: 0,
      experimentsCreated: 0,
      backtestsRun: 0,
      validationsRun: 0,
      promoted: 0,
      forwardTestsStarted: 0,
      journalEntriesCreated: 0,
      rejected: 0,
      weakRejectedCount: 0,
      insufficientDataCount: 0,
      promotedWithFullEvidenceCount: 0,
      promotedWithoutFullEvidenceCount: 0,
    },
    latestRejectionReasons: [],
  };

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly marketData = new MarketDataService(),
    private readonly patternDiscovery = new PatternDiscoveryService(),
    private readonly hypotheses = new HypothesisService(),
    private readonly rules = new RuleBuilderService(),
    private readonly experiments = new ExperimentManagerService(),
    private readonly backtests = new BacktestService(),
    private readonly validation = new ValidationService(),
    private readonly forwardTests = new ForwardTestService(undefined, new DemoOnlyPolicyService(env)),
    private readonly journal = new TradeJournalService(),
    private readonly ranking = new StrategyRankingService(),
    private readonly historicalData = historicalDataImportService,
  ) {}

  snapshot(): StrategyResearchPipelineStatus {
    return clone(this.status);
  }

  async runOnce(input: { runState?: string; now?: Date } = {}): Promise<StrategyResearchCycleResult> {
    const now = input.now ?? new Date();
    const modeSafe = this.env.MARKETPILOT_RUN_MODE?.trim() === "demo_observation";
    const runStateSafe = !input.runState || input.runState === "running";
    if (!modeSafe || !runStateSafe) {
      const reason = !modeSafe ? "MARKETPILOT_RUN_MODE is not demo_observation." : `Demo run is ${input.runState}.`;
      this.status = {
        ...this.status,
        enabled: modeSafe,
        running: false,
        lastSkipReason: reason,
        health: { ...this.status.health, status: "blocked", safetyBlocks: this.status.health.safetyBlocks + 1 },
      };
      return { ...this.snapshot(), eventsCreated: 0 };
    }

    const cycleEvents: EventEnvelope[] = [];
    const candidates: StrategyResearchCandidate[] = [];
    const rejected: StrategyResearchCandidate[] = [];
    let eventsCreated = 0;
    this.historicalData.ensureDemoHistory({ instruments: [...DEFAULT_SYMBOLS], timeframe: "15m", count: 420, now });
    const sampleDepthReports: BacktestSampleDepthReport[] = [];

    for (const symbol of DEFAULT_SYMBOLS) {
      const symbolEvents = this.processSymbol(symbol, now);
      sampleDepthReports.push(this.historicalData.sampleDepth(this.historicalData.getCandles(symbol, "15m")));
      eventsCreated += symbolEvents.events.length;
      cycleEvents.push(...symbolEvents.events);
      if (symbolEvents.candidate.status === "forward_test" || symbolEvents.candidate.status === "candidate" || symbolEvents.candidate.status === "watch") {
        candidates.push(symbolEvents.candidate);
      } else {
        rejected.push(symbolEvents.candidate);
      }
    }

    const nextCounts = {
      patternsDetected: this.status.counts.patternsDetected + cycleEvents.filter((event) => event.type === "PatternDetected").length,
      hypothesesCreated: this.status.counts.hypothesesCreated + cycleEvents.filter((event) => event.type === "HypothesisCreated" || event.type === "HypothesisNeedsMoreData").length,
      ruleSetsCreated: this.status.counts.ruleSetsCreated + cycleEvents.filter((event) => event.type === "RuleSetCreated").length,
      experimentsCreated: this.status.counts.experimentsCreated + cycleEvents.filter((event) => event.type === "ExperimentCreated").length,
      backtestsRun: this.status.counts.backtestsRun + cycleEvents.filter((event) => event.type === "BacktestCompleted" || event.type === "BacktestInsufficientSample").length,
      validationsRun: this.status.counts.validationsRun + cycleEvents.filter((event) => event.module === "validation").length,
      promoted: this.status.counts.promoted + candidates.filter((candidate) => candidate.status === "forward_test").length,
      forwardTestsStarted: this.status.counts.forwardTestsStarted + cycleEvents.filter((event) => event.type === "ForwardTestStarted").length,
      journalEntriesCreated: this.status.counts.journalEntriesCreated + cycleEvents.filter((event) => event.type === "TradeJournalCreated").length,
      rejected: this.status.counts.rejected + rejected.length,
      weakRejectedCount: this.status.counts.weakRejectedCount + rejected.filter((candidate) => candidate.status === "rejected").length,
      insufficientDataCount: this.status.counts.insufficientDataCount + rejected.filter((candidate) => candidate.status === "insufficient_data" || /sample|insufficient/i.test(candidate.reason)).length,
      promotedWithFullEvidenceCount: this.status.counts.promotedWithFullEvidenceCount + candidates.filter((candidate) => candidate.status === "forward_test" && candidate.quality.fullEvidence).length,
      promotedWithoutFullEvidenceCount: this.status.counts.promotedWithoutFullEvidenceCount + candidates.filter((candidate) => candidate.status === "forward_test" && !candidate.quality.fullEvidence).length,
    };

    this.status = {
      ...this.status,
      enabled: true,
      running: true,
      lastRunAt: now.toISOString(),
      lastSkipReason: null,
      allowedStrategies: [],
      health: {
        status: "healthy",
        cyclesRun: this.status.health.cyclesRun + 1,
        safetyBlocks: this.status.health.safetyBlocks,
        liveExecutionEnabled: false,
      },
      experimentQueue: [...candidates, ...rejected].map((candidate) => ({
        experimentId: candidate.experimentId,
        symbol: candidate.symbol,
        status: candidate.status,
        validationVerdict: candidate.validationVerdict,
      })).slice(-25),
      latestDiscoveredPatterns: cycleEvents
        .filter((event) => event.type === "PatternDetected")
        .map((event) => ({
          eventId: event.id,
          symbol: String(event.payload.instrument),
          patternType: String(event.payload.patternType),
          confidence: Number(event.payload.confidence),
        }))
        .slice(-25),
      latestHypotheses: cycleEvents
        .filter((event) => event.type === "HypothesisCreated" || event.type === "HypothesisNeedsMoreData" || event.type === "HypothesisRejected")
        .map((event) => ({
          eventId: event.id,
          hypothesisId: String(event.payload.hypothesisId ?? "none"),
          symbol: String(event.payload.instrument ?? "unknown"),
          status: String(event.payload.status ?? "rejected"),
          score: Number(event.payload.score ?? 0),
        }))
        .slice(-25),
      historicalDataCoverage: this.historicalData.coverageSnapshot([...DEFAULT_SYMBOLS], "15m"),
      latestImportStatus: this.historicalData.latestImportStatus(),
      sampleDepthReports,
      missingHistoryWarnings: sampleDepthReports.flatMap((report) => report.missingDataWarnings).slice(-25),
      promotedCandidates: [...this.status.promotedCandidates, ...candidates.filter((candidate) => candidate.status === "forward_test")].slice(-25),
      rejectedCandidates: [...this.status.rejectedCandidates, ...rejected].slice(-25),
      counts: nextCounts,
      latestRejectionReasons: [...this.status.latestRejectionReasons, ...rejected.map((candidate) => `${candidate.symbol}: ${candidate.reason}`)].slice(-10),
    };

    eventLogService.append({
      type: "analytics.snapshot_recorded",
      userId: "system",
      sourceService: "strategy-research-scheduler",
      payload: {
        researchPipeline: {
          counts: nextCounts,
          promoted: candidates.filter((candidate) => candidate.status === "forward_test").length,
          rejected: rejected.length,
        },
        demoOnly: true,
        productionLiveExecutionBlocked: true,
      },
      createdAt: now.toISOString(),
    });
    return { ...this.snapshot(), eventsCreated };
  }

  private processSymbol(symbol: string, now: Date): { events: EventEnvelope[]; candidate: StrategyResearchCandidate } {
    const events: EventEnvelope[] = [];
    const history = this.historicalData.getCandles(symbol, "15m");
    const candles = history.length ? history : demoCandles(symbol, now);
    const patternCandles = candles.slice(-140);
    const latest = candles[candles.length - 1];
    const snapshot = this.marketData.createSnapshot({
      instrument: symbol,
      bid: round(latest.close - spreadFor(symbol) / 2),
      ask: round(latest.close + spreadFor(symbol) / 2),
      provider: "mock",
      observedAt: now,
    });
    events.push(snapshot);
    const spread = this.marketData.detectSpread(snapshot);
    const session = this.marketData.detectSession(symbol, now);
    const economic = this.marketData.attachEconomicContext(symbol, now, [toEventReference(snapshot)]);
    const candleSeries = this.marketData.createCandleSeries(patternCandles, [toEventReference(snapshot)]);
    events.push(spread, session, economic, candleSeries);

    const patternEvents = this.patternDiscovery.detect({
      instrument: normalizeSymbol(symbol),
      timeframe: "15m",
      candles: patternCandles,
      sourceEventRefs: [toEventReference(candleSeries), toEventReference(snapshot)],
    });
    events.push(...patternEvents);
    const detectedPatterns = patternEvents.filter((event) => event.type === "PatternDetected");
    const hypothesis = this.hypotheses.fromPatterns(patternEvents);
    events.push(hypothesis);
    const ruleSetEvent = this.rules.createFromHypothesis(hypothesis);
    events.push(ruleSetEvent);

    const fallbackCandidate = (status: CandidateStatus, reason: string): StrategyResearchCandidate => ({
      experimentId: "not-created",
      symbol,
      hypothesisId: String(payloadOf(hypothesis).hypothesisId ?? "none"),
      ruleSetId: String(payloadOf(ruleSetEvent).ruleSetId ?? "none"),
      ruleVersion: Number(payloadOf(ruleSetEvent).version ?? 0),
      validationVerdict: "not_run",
      rankingStatus: "experimental",
      status,
      forwardTestId: null,
      journalId: null,
      reason,
      quality: evaluatePromotionReadiness({
        validationVerdict: "not_run",
        validationResult: null,
        backtestResult: null,
        detectedPatternCount: detectedPatterns.length,
        ruleSet: ruleSetEvent.type === "RuleSetCreated" ? ruleSetEvent.payload as unknown as RuleSet : null,
        invalidationEvidenceCount: detectedPatterns.reduce((sum, event) => sum + (((payloadOf(event).invalidationEvidence as unknown[])?.length) ?? 0), 0),
        demoOnlyApproved: false,
        marketSnapshotRefCount: 1,
        journal: null,
        eventLineageRefs: events.map(toEventReference),
      }),
      journal: emptyJournalSummary(),
      eventIds: events.map((event) => event.id),
    });

    if (detectedPatterns.length < 2 || ruleSetEvent.type !== "RuleSetCreated") {
      const candidate = fallbackCandidate("rejected", "At least two detected patterns and an objective rule set are required.");
      this.persistEvents(events, candidate);
      return { events, candidate };
    }

    const ruleSet = ruleSetEvent.payload as unknown as RuleSet;
    const experiment = this.experiments.create({
      name: `${symbol} automated demo research`,
      refs: {
        observationRefs: [toEventReference(snapshot), toEventReference(candleSeries)],
        patternRefs: detectedPatterns.map(toEventReference),
        hypothesisRefs: [toEventReference(hypothesis)],
        ruleSetRefs: [toEventReference(ruleSetEvent)],
      },
      now,
    });
    events.push(experiment);
    const experimentId = String(experiment.payload.experimentId);
    events.push(this.experiments.transition(experimentId, "collecting_data", [toEventReference(candleSeries)], now));
    events.push(this.experiments.transition(experimentId, "backtesting", [toEventReference(ruleSetEvent)], now));
    const backtest = this.backtests.run({
      experimentId,
      ruleSet,
      candles,
      spread: Number(snapshot.payload.spread),
      slippage: 0,
      commissionPerTrade: 0,
      riskPerTrade: 0.001,
      sourceEventRefs: [toEventReference(ruleSetEvent)],
    });
    events.push(backtest);

    let validationEvent: EventEnvelope | null = null;
    if (backtest.type === "BacktestCompleted") {
      validationEvent = this.validation.validate(backtest);
      events.push(validationEvent);
    }
    const validationResult = validationEvent?.payload as unknown as ValidationResult | undefined;
    const backtestResult = backtest.payload as unknown as BacktestResult;
    const validationVerdict = validationResult?.verdict ?? "insufficient_data";
    const baseRefs = [toEventReference(snapshot), toEventReference(hypothesis), toEventReference(ruleSetEvent), toEventReference(backtest), ...(validationEvent ? [toEventReference(validationEvent)] : [])];
    const rankingEvent = this.ranking.rank({
      experimentId,
      sampleSize: validationResult?.actualSampleSize ?? 0,
      expectancy: backtestResult.expectancy ?? 0,
      maxDrawdown: backtestResult.maxDrawdown ?? 0,
      forwardTestScore: validationVerdict === "ready_for_forward_test" ? 0.7 : validationVerdict === "candidate" ? 0.45 : 0.2,
      journalQuality: 0.8,
      regimeSurvival: validationResult?.regimeStability ?? 0.5,
      symbolSuitability: 0.8,
      sourceEventRefs: baseRefs,
    }, null, now);
    events.push(rankingEvent);
    const rankingStatus = String(rankingEvent.payload.status) as StrategyStatus;

    let status: CandidateStatus = validationVerdict === "ready_for_forward_test" || validationVerdict === "candidate" ? "forward_test" : validationVerdict === "watch" ? "watch" : validationVerdict === "needs_more_data" ? "insufficient_data" : "rejected";
    let forwardTestId: string | null = null;
    let journalId: string | null = null;
    let journalSummary = emptyJournalSummary();
    let reason = `Validation verdict: ${validationVerdict}.`;
    const policy = new DemoOnlyPolicyService(this.env).check({
      provider: "paper_provider",
      accountMode: "paper",
      verificationSource: "strategy-research-scheduler.paper_mode",
      attemptedAction: "strategy-research.forward-test.promote",
      source: "strategy-research-scheduler",
    });
    const plannedJournal = {
      entryReason: `${detectedPatterns.map((event) => payloadOf(event).patternType).join(", ")} supported hypothesis ${String(payloadOf(hypothesis).hypothesisId)}.`,
      hypothesisId: String(payloadOf(hypothesis).hypothesisId),
      ruleVersion: ruleSet.version,
      stopLoss: round(Number(snapshot.payload.mid) - stopDistance(symbol)),
      takeProfit: round(Number(snapshot.payload.mid) + stopDistance(symbol) * 1.5),
      expectedOutcome: "positive expectancy paper/demo forward-test setup",
      actualOutcome: "open",
      lessonLearned: "Forward test opened in paper/demo tracking only; wait for actual outcome before promotion.",
      beforeEntrySnapshotRefs: [toEventReference(snapshot)],
      sourceEventRefs: [toEventReference(hypothesis), toEventReference(ruleSetEvent), toEventReference(backtest), ...(validationEvent ? [toEventReference(validationEvent)] : [])],
    };
    let quality = evaluatePromotionReadiness({
      validationVerdict,
      validationResult: validationResult ?? null,
      backtestResult,
      detectedPatternCount: detectedPatterns.length,
      ruleSet,
      invalidationEvidenceCount: detectedPatterns.reduce((sum, event) => sum + (((payloadOf(event).invalidationEvidence as unknown[])?.length) ?? 0), 0),
      demoOnlyApproved: policy.allowed,
      marketSnapshotRefCount: 1,
      journal: plannedJournal,
      eventLineageRefs: baseRefs,
    });

    if (status === "forward_test") {
      if (!quality.fullEvidence) {
        status = "rejected";
        reason = quality.rejectionReasons.join(" ");
      } else {
        events.push(this.experiments.transition(experimentId, "ready_for_forward_test", baseRefs, now));
        const forward = this.forwardTests.start({
          experimentId,
          provider: "paper_provider",
          accountMode: "paper",
          mode: "paper",
          allowedInstruments: [normalizeSymbol(symbol)],
          riskLimitPct: 0.1,
          refs: baseRefs,
        });
        events.push(forward);
        forwardTestId = String(forward.payload.forwardTestId);
        events.push(this.experiments.transition(experimentId, "forward_testing", [toEventReference(forward)], now));
        const journal = this.journal.create({
          experimentId,
          tradeId: `paper-demo-${forwardTestId}`,
          instrument: symbol,
          ruleVersion: ruleSet.version,
          entryReason: plannedJournal.entryReason,
          stopLoss: plannedJournal.stopLoss,
          takeProfit: plannedJournal.takeProfit,
          positionSize: 1,
          outcome: "open",
          beforeEntrySnapshotRefs: [toEventReference(snapshot)],
          afterExitSnapshotRefs: [],
          multiTimeframeSnapshotRefs: [toEventReference(candleSeries)],
          screenshotRefs: [{ type: "placeholder", uri: "strategy-research-scheduler://paper-demo", capturedAt: now.toISOString(), redacted: true }],
          sourceEventRefs: [toEventReference(forward), toEventReference(hypothesis), toEventReference(ruleSetEvent)],
        });
        events.push(journal);
        journalId = String(journal.payload.journalId);
        journalSummary = {
          stopLoss: plannedJournal.stopLoss,
          takeProfit: plannedJournal.takeProfit,
          beforeEntrySnapshotRefs: plannedJournal.beforeEntrySnapshotRefs.length,
          sourceEventRefs: plannedJournal.sourceEventRefs.length + 1,
          lessonLearned: plannedJournal.lessonLearned,
        };
        events.push(...this.journal.review(journalId, {
          lessonLearned: plannedJournal.lessonLearned,
          mistakeClassification: null,
          improvementSuggestion: "Require multiple forward-test outcomes before focus promotion.",
          refs: [toEventReference(journal), toEventReference(forward)],
        }));
        reason = "Validated strategy promoted to paper/demo forward testing.";
      }
    } else if (status === "watch") {
      events.push(this.experiments.transition(experimentId, "watch", baseRefs, now));
    } else if (status === "rejected") {
      events.push(this.experiments.transition(experimentId, "retired", baseRefs, now));
    }

    const candidate: StrategyResearchCandidate = {
      experimentId,
      symbol,
      hypothesisId: String(payloadOf(hypothesis).hypothesisId),
      ruleSetId: ruleSet.ruleSetId,
      ruleVersion: ruleSet.version,
      validationVerdict,
      rankingStatus,
      status,
      forwardTestId,
      journalId,
      reason,
      quality,
      journal: journalSummary,
      eventIds: events.map((event) => event.id),
    };
    this.persistEvents(events, candidate);
    strategyEvidenceStore.recordSymbolSuitability(experimentId, {
      symbol,
      verdict: status === "forward_test" ? "acceptable" : status === "rejected" ? "reject" : "developing",
      source: "strategy-research-scheduler",
      summary: reason,
      metadata: {
        validationVerdict,
        rankingStatus,
        forwardTestId,
        journalId,
        eventIds: candidate.eventIds,
        demoOnly: true,
      },
    });
    return { events, candidate };
  }

  private persistEvents(events: EventEnvelope[], candidate: StrategyResearchCandidate) {
    for (const event of events) {
      eventLogService.append({
        type: event.type === "MarketSnapshotCreated"
          ? "price.tick_received"
          : event.type === "CandleSeriesCreated"
            ? "market.candle_closed"
            : event.type === "ForwardTestStarted"
              ? "strategy.lifecycle_evaluated"
              : event.type === "TradeJournalCreated"
                ? "journal.entry_created"
                : "analytics.snapshot_recorded",
        userId: "system",
        sourceService: "strategy-research-scheduler",
        correlationId: candidate.experimentId,
        payload: {
          strategyMachineEventId: event.id,
          strategyMachineEventType: event.type,
          module: event.module,
          payload: event.payload,
          sourceEventRefs: event.sourceEventRefs,
          demoOnly: true,
          productionLiveExecutionBlocked: true,
        },
      });
    }
    executionAuditLog.append({
      action: "strategy_research.candidate_evaluated",
      outcome: candidate.status === "rejected" ? "blocked" : "accepted",
      correlationId: candidate.experimentId,
      detail: {
        symbol: candidate.symbol,
        status: candidate.status,
        validationVerdict: candidate.validationVerdict,
        forwardTestId: candidate.forwardTestId,
        journalId: candidate.journalId,
        demoOnly: true,
        productionLiveExecutionBlocked: true,
      },
    });
  }
}

function demoCandles(symbol: string, now: Date): Candle[] {
  const instrument = normalizeSymbol(symbol);
  const pip = symbol.includes("JPY") ? 0.01 : symbol.startsWith("XAU") ? 0.8 : symbol.startsWith("XAG") ? 0.04 : 0.0001;
  const start = basePrice(symbol);
  return Array.from({ length: 140 }, (_, index) => {
    const time = new Date(now.getTime() - (140 - index) * 15 * 60_000);
    if (index === 139) time.setUTCHours(8, 15, 0, 0);
    const trend = index * pip * 0.22;
    const compression = index > 124 && index < 139 ? pip * 0.35 : pip * 1.4;
    const sweep = index === 138 ? -pip * 4 : 0;
    const breakout = index === 139 ? pip * 8 : 0;
    const open = start + trend + sweep;
    const close = open + pip * 0.35 + breakout;
    const high = Math.max(open, close) + compression;
    const low = Math.min(open, close) - compression - (index === 138 ? pip * 4 : 0);
    return {
      instrument,
      timeframe: "15m",
      timestamp: time.toISOString(),
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: 100 + index,
    };
  });
}

function basePrice(symbol: string) {
  if (symbol === "USD/JPY") return 158;
  if (symbol === "XAU/USD") return 2350;
  if (symbol === "XAG/USD") return 31;
  if (symbol === "GBP/USD") return 1.28;
  return 1.1;
}

function spreadFor(symbol: string) {
  if (symbol.includes("JPY")) return 0.01;
  if (symbol.startsWith("XAU")) return 0.2;
  if (symbol.startsWith("XAG")) return 0.02;
  return 0.00012;
}

function stopDistance(symbol: string) {
  if (symbol.includes("JPY")) return 0.05;
  if (symbol.startsWith("XAU")) return 2;
  if (symbol.startsWith("XAG")) return 0.1;
  return 0.0008;
}

function normalizeSymbol(symbol: string) {
  return symbol.replace("/", "_");
}

function round(value: number) {
  return Number(value.toFixed(6));
}

function payloadOf(event: EventEnvelope): Record<string, unknown> {
  return event.payload as unknown as Record<string, unknown>;
}

function emptyJournalSummary(): StrategyResearchCandidate["journal"] {
  return {
    stopLoss: null,
    takeProfit: null,
    beforeEntrySnapshotRefs: 0,
    sourceEventRefs: 0,
    lessonLearned: null,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const strategyResearchSchedulerService = new StrategyResearchSchedulerService();
