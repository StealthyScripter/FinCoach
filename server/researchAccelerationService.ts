import { BacktestService, type BacktestResult } from "./strategy-machine/backtesting";
import { ExperimentManagerService } from "./strategy-machine/experiment-manager";
import { HypothesisService } from "./strategy-machine/hypothesis";
import { MarketDataService, normalizeInstrument, type Candle } from "./strategy-machine/market-data";
import { PatternDiscoveryService } from "./strategy-machine/pattern-discovery";
import { RuleBuilderService, type RuleSet } from "./strategy-machine/rule-builder";
import { ValidationService, type ValidationResult } from "./strategy-machine/validation";
import { historicalDataImportService, type BacktestSampleDepthReport, type CandleProvider, type HistoricalDataCoverage, type HistoricalDataImportService } from "./historicalDataImportService";
import { toEventReference, type EventEnvelope } from "./strategy-machine/core";

export const RESEARCH_INSTRUMENTS = ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD"] as const;
export const RESEARCH_TIMEFRAMES = ["15m", "1h", "4h", "1d"] as const;

export type HistoricalCoveragePlan = {
  generatedAt: string;
  requirements: {
    minimumYears: 1;
    preferredYears: 3;
    idealYears: 5;
    sourcePriority: string[];
  };
  items: Array<HistoricalDataCoverage & {
    yearsAvailable: number;
    target: "missing" | "below_minimum" | "minimum" | "preferred" | "ideal";
    missingWindows: Array<{ from: string; to: string; reason: string }>;
    qualityWarnings: string[];
  }>;
};

export type ReplayRunStatus = {
  running: boolean;
  lastRunAt: string | null;
  experimentsRun: number;
  hypothesesTested: number;
  ruleSetsRejected: number;
  eventsEmitted: number;
  promoted: number;
  demoted: number;
  topRejectionReasons: string[];
  latestWarnings: string[];
};

export type ExperimentSplit = {
  discovery: Candle[];
  inSample: Candle[];
  outOfSample: Candle[];
  walkForward: Candle[][];
};

export type StabilityComparison = {
  experimentId: string;
  stable: boolean;
  fragileParameterSet: boolean;
  narrowOptima: boolean;
  regimeSpecificOverfitting: boolean;
  performanceDecay: boolean;
  metrics: {
    expectancyStability: number;
    drawdownStability: number;
    profitFactorStability: number;
    winRateStability: number;
    rMultipleStability: number;
    sampleSize: number;
    regimeCoverage: number;
    symbolCoverage: number;
    walkForwardConsistency: number;
  };
  reasons: string[];
};

export type ResearchAccelerationReport = {
  generatedAt: string;
  yearsOfHistoryAvailable: number;
  equivalentMarketDaysReplayed: number;
  experimentsRun: number;
  hypothesesTested: number;
  ruleSetsRejected: number;
  strategiesPromoted: number;
  strategiesDemoted: number;
  topRejectionReasons: string[];
  mostStableCandidates: StabilityComparison[];
  evidenceGapsRemaining: string[];
  forwardTestingJustified: boolean;
};

export class HistoricalCoveragePlanner {
  constructor(private readonly historicalData: HistoricalDataImportService = historicalDataImportService) {}

  plan(now = new Date()): HistoricalCoveragePlan {
    const items = RESEARCH_INSTRUMENTS.flatMap((instrument) => RESEARCH_TIMEFRAMES.map((timeframe) => {
      const coverage = this.historicalData.coverage(instrument, timeframe);
      const yearsAvailable = coverage.start && coverage.end
        ? Math.max(0, (Date.parse(coverage.end) - Date.parse(coverage.start)) / (365 * 24 * 60 * 60 * 1000))
        : 0;
      const target: HistoricalCoveragePlan["items"][number]["target"] = yearsAvailable >= 5 ? "ideal" : yearsAvailable >= 3 ? "preferred" : yearsAvailable >= 1 ? "minimum" : coverage.candlesAvailable > 0 ? "below_minimum" : "missing";
      return {
        ...coverage,
        yearsAvailable: round(yearsAvailable, 3),
        target,
        missingWindows: missingWindows(coverage, now),
        qualityWarnings: [...coverage.warnings, ...(target === "missing" ? ["No historical candles imported."] : target === "below_minimum" ? ["Less than one year of history available."] : [])],
      };
    }));
    return {
      generatedAt: now.toISOString(),
      requirements: {
        minimumYears: 1,
        preferredYears: 3,
        idealYears: 5,
        sourcePriority: ["OANDA practice candles", "local CSV import", "user-provided OHLCV archive", "demo fixture fallback", "paid provider adapter stub"],
      },
      items,
    };
  }
}

export class OandaPracticeCandleProvider implements CandleProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchCandles(input: { instrument: string; timeframe: Candle["timeframe"]; count: number }) {
    if (this.env.OANDA_ENV?.trim().toLowerCase() !== "practice") throw new Error("OANDA practice history import requires OANDA_ENV=practice");
    const token = this.env.OANDA_API_TOKEN;
    if (!token?.trim()) throw new Error("OANDA_API_TOKEN is not configured");
    const granularity = input.timeframe === "15m" ? "M15" : input.timeframe === "1h" ? "H1" : input.timeframe === "4h" ? "H4" : input.timeframe === "1d" ? "D" : "M1";
    const response = await this.fetchImpl(`https://api-fxpractice.oanda.com/v3/instruments/${encodeURIComponent(input.instrument)}/candles?price=M&granularity=${granularity}&count=${Math.min(input.count, 5000)}`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "MarketPilot-HistoricalImport/1.0" },
    });
    if (!response.ok) throw new Error(`OANDA practice history import failed with status ${response.status}`);
    const payload = await response.json() as { candles?: Array<Record<string, unknown>> };
    return (payload.candles ?? []).filter((candle) => candle.complete !== false).map((candle) => {
      const mid = candle.mid as Record<string, unknown>;
      return {
        instrument: input.instrument,
        timeframe: input.timeframe,
        timestamp: String(candle.time),
        open: Number(mid.o),
        high: Number(mid.h),
        low: Number(mid.l),
        close: Number(mid.c),
        volume: Number(candle.volume ?? 0),
        spread: null,
      };
    });
  }
}

export class HistoricalReplayService {
  constructor(
    private readonly marketData = new MarketDataService(),
    private readonly patternDiscovery = new PatternDiscoveryService(),
    private readonly hypotheses = new HypothesisService(),
    private readonly rules = new RuleBuilderService(),
  ) {}

  replay(input: { candles: Candle[]; windowSize?: number }) {
    const events: EventEnvelope[] = [];
    const sorted = [...input.candles].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const windowSize = input.windowSize ?? Math.min(140, sorted.length);
    for (let end = windowSize; end <= sorted.length; end += windowSize) {
      const window = sorted.slice(end - windowSize, end);
      const latest = window[window.length - 1];
      const snapshot = this.marketData.createSnapshot({
        instrument: latest.instrument,
        bid: latest.close,
        ask: latest.close,
        provider: "mock",
        observedAt: new Date(latest.timestamp),
      });
      const candles = this.marketData.createCandleSeries(window, [toEventReference(snapshot)]);
      const patterns = this.patternDiscovery.detect({
        instrument: latest.instrument,
        timeframe: latest.timeframe,
        candles: window,
        sourceEventRefs: [toEventReference(candles), toEventReference(snapshot)],
      });
      const hypothesis = this.hypotheses.fromPatterns(patterns);
      const ruleSet = this.rules.createFromHypothesis(hypothesis);
      events.push(snapshot, candles, ...patterns, hypothesis, ruleSet);
    }
    return { events, executionAttempted: false };
  }
}

export class ReplayExperimentRunner {
  constructor(
    private readonly historicalData: HistoricalDataImportService = historicalDataImportService,
    private readonly replay = new HistoricalReplayService(),
    private readonly experiments = new ExperimentManagerService(),
    private readonly backtests = new BacktestService(),
    private readonly validation = new ValidationService(),
  ) {}

  run(input: { instruments?: string[]; timeframe?: Candle["timeframe"]; maxExperiments?: number; now?: Date } = {}) {
    const instruments = input.instruments ?? [...RESEARCH_INSTRUMENTS];
    const timeframe = input.timeframe ?? "15m";
    const maxExperiments = input.maxExperiments ?? 200;
    const outcomes: Array<{ experimentId: string; validation: ValidationResult | null; backtest: BacktestResult | null; split: ReturnType<typeof splitCandles>; replayEvents: number; rejectionReason: string | null }> = [];
    for (const instrument of instruments) {
      const candles = this.historicalData.getCandles(instrument, timeframe);
      if (candles.length < 120) {
        outcomes.push({ experimentId: "not-created", validation: null, backtest: null, split: splitCandles(candles), replayEvents: 0, rejectionReason: `${instrument} ${timeframe} has insufficient historical candles (${candles.length}).` });
        continue;
      }
      const split = splitCandles(candles);
      const replayed = this.replay.replay({ candles: split.discovery, windowSize: Math.min(80, split.discovery.length) });
      const ruleEvent = [...replayed.events].reverse().find((event) => event.type === "RuleSetCreated");
      if (!ruleEvent) {
        outcomes.push({ experimentId: "not-created", validation: null, backtest: null, split, replayEvents: replayed.events.length, rejectionReason: "Replay did not produce an objective rule set." });
        continue;
      }
      const experiment = this.experiments.create({
        name: `${instrument} ${timeframe} replay experiment`,
        refs: { ruleSetRefs: [toEventReference(ruleEvent)] },
        now: input.now,
      });
      const experimentId = String(experiment.payload.experimentId);
      const backtestEvent = this.backtests.run({
        experimentId,
        ruleSet: ruleEvent.payload as unknown as RuleSet,
        candles: split.inSample,
        spread: 0,
        slippage: 0,
        commissionPerTrade: 0,
        riskPerTrade: 0.001,
        sourceEventRefs: [toEventReference(ruleEvent)],
      });
      const validationEvent = backtestEvent.type === "BacktestCompleted" ? this.validation.validate(backtestEvent) : null;
      outcomes.push({
        experimentId,
        validation: validationEvent?.payload as unknown as ValidationResult ?? null,
        backtest: backtestEvent.type === "BacktestCompleted" ? backtestEvent.payload as unknown as BacktestResult : null,
        split,
        replayEvents: replayed.events.length,
        rejectionReason: validationEvent?.type === "ExperimentRejected" ? "Validation rejected replay experiment." : null,
      });
      if (outcomes.length >= maxExperiments) break;
    }
    return outcomes;
  }
}

export class StabilityComparisonService {
  compare(input: { experimentId: string; windows: BacktestResult[]; sampleDepth: BacktestSampleDepthReport }): StabilityComparison {
    const expectancy = input.windows.map((window) => window.expectancy);
    const drawdown = input.windows.map((window) => window.maxDrawdown);
    const profitFactor = input.windows.map((window) => window.profitFactor);
    const winRate = input.windows.map((window) => window.winRate);
    const r = input.windows.flatMap((window) => window.trades.map((trade) => trade.rMultiple));
    const metrics = {
      expectancyStability: stability(expectancy),
      drawdownStability: stability(drawdown),
      profitFactorStability: stability(profitFactor),
      winRateStability: stability(winRate),
      rMultipleStability: stability(r),
      sampleSize: input.windows.reduce((sum, window) => sum + window.tradeCount, 0),
      regimeCoverage: input.sampleDepth.regimesCovered.length,
      symbolCoverage: input.sampleDepth.instrumentsCovered.length,
      walkForwardConsistency: consistency(expectancy),
    };
    const reasons = [
      metrics.sampleSize < 60 ? "Sample size below stability threshold." : null,
      metrics.regimeCoverage < 2 ? "Regime coverage is narrow." : null,
      metrics.expectancyStability < 0.55 ? "Expectancy is unstable across windows." : null,
      metrics.walkForwardConsistency < 0.55 ? "Walk-forward consistency is weak." : null,
      metrics.profitFactorStability < 0.45 ? "Profit factor is fragile." : null,
    ].filter((reason): reason is string => Boolean(reason));
    return {
      experimentId: input.experimentId,
      stable: reasons.length === 0,
      fragileParameterSet: metrics.profitFactorStability < 0.45 || metrics.rMultipleStability < 0.45,
      narrowOptima: metrics.walkForwardConsistency < 0.55,
      regimeSpecificOverfitting: metrics.regimeCoverage < 2,
      performanceDecay: expectancy.length >= 2 && expectancy[expectancy.length - 1] < expectancy[0] * 0.5,
      metrics,
      reasons,
    };
  }
}

export class ResearchAccelerationService {
  private readonly planner = new HistoricalCoveragePlanner();
  private readonly runner = new ReplayExperimentRunner();
  private readonly stability = new StabilityComparisonService();
  private status: ReplayRunStatus = { running: false, lastRunAt: null, experimentsRun: 0, hypothesesTested: 0, ruleSetsRejected: 0, eventsEmitted: 0, promoted: 0, demoted: 0, topRejectionReasons: [], latestWarnings: [] };
  private report: ResearchAccelerationReport = this.emptyReport();
  private comparisons: StabilityComparison[] = [];

  coverage(now = new Date()) {
    return this.planner.plan(now);
  }

  async importOanda(input: { env?: NodeJS.ProcessEnv; instruments?: string[]; timeframes?: Candle["timeframe"][]; count?: number; provider?: CandleProvider } = {}) {
    const env = input.env ?? process.env;
    const provider = input.provider ?? new OandaPracticeCandleProvider(env);
    const results = [];
    for (const instrument of input.instruments ?? [...RESEARCH_INSTRUMENTS]) {
      for (const timeframe of input.timeframes ?? [...RESEARCH_TIMEFRAMES]) {
        try {
          results.push(await historicalDataImportService.importFromProvider({ provider, instrument, timeframe, count: input.count ?? 5000 }));
        } catch (error) {
          results.push({ source: "provider" as const, imported: 0, duplicatesRemoved: 0, rejected: 0, warnings: [error instanceof Error ? error.message : "OANDA import failed"], startedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
        }
      }
    }
    return { results };
  }

  runReplay(input: { instruments?: string[]; timeframe?: Candle["timeframe"]; now?: Date } = {}) {
    this.status = { ...this.status, running: true };
    const outcomes = this.runner.run(input);
    const windows = outcomes.flatMap((outcome) => outcome.backtest ? [outcome.backtest] : []);
    this.comparisons = outcomes.map((outcome) => this.stability.compare({
      experimentId: outcome.experimentId,
      windows: outcome.backtest ? [outcome.backtest] : [],
      sampleDepth: historicalDataImportService.sampleDepth([...outcome.split.inSample, ...outcome.split.outOfSample]),
    }));
    const coverage = this.coverage(input.now);
    const rejectionReasons = outcomes.map((outcome) => outcome.rejectionReason).filter((reason): reason is string => Boolean(reason));
    this.status = {
      running: false,
      lastRunAt: (input.now ?? new Date()).toISOString(),
      experimentsRun: outcomes.filter((outcome) => outcome.experimentId !== "not-created").length,
      hypothesesTested: outcomes.length,
      ruleSetsRejected: rejectionReasons.length,
      eventsEmitted: outcomes.reduce((sum, outcome) => sum + outcome.replayEvents, 0),
      promoted: 0,
      demoted: this.comparisons.filter((comparison) => !comparison.stable).length,
      topRejectionReasons: topReasons([...rejectionReasons, ...this.comparisons.flatMap((comparison) => comparison.reasons)]),
      latestWarnings: coverage.items.flatMap((item) => item.qualityWarnings).slice(0, 10),
    };
    this.report = {
      generatedAt: (input.now ?? new Date()).toISOString(),
      yearsOfHistoryAvailable: round(Math.max(...coverage.items.map((item) => item.yearsAvailable), 0), 3),
      equivalentMarketDaysReplayed: Math.round(outcomes.reduce((sum, outcome) => sum + outcome.split.inSample.length + outcome.split.outOfSample.length, 0) / 96),
      experimentsRun: this.status.experimentsRun,
      hypothesesTested: this.status.hypothesesTested,
      ruleSetsRejected: this.status.ruleSetsRejected,
      strategiesPromoted: 0,
      strategiesDemoted: this.status.demoted,
      topRejectionReasons: this.status.topRejectionReasons,
      mostStableCandidates: this.comparisons.filter((comparison) => comparison.stable).slice(0, 5),
      evidenceGapsRemaining: coverage.items.flatMap((item) => item.qualityWarnings).slice(0, 10),
      forwardTestingJustified: this.comparisons.some((comparison) => comparison.stable),
    };
    return { outcomes, status: this.status, report: this.report, stability: this.comparisons };
  }

  replayStatus() {
    return this.status;
  }

  replayReport() {
    return this.report;
  }

  stabilitySnapshot() {
    return { generatedAt: new Date().toISOString(), comparisons: this.comparisons };
  }

  private emptyReport(): ResearchAccelerationReport {
    return { generatedAt: new Date().toISOString(), yearsOfHistoryAvailable: 0, equivalentMarketDaysReplayed: 0, experimentsRun: 0, hypothesesTested: 0, ruleSetsRejected: 0, strategiesPromoted: 0, strategiesDemoted: 0, topRejectionReasons: [], mostStableCandidates: [], evidenceGapsRemaining: [], forwardTestingJustified: false };
  }
}

export function splitCandles(candles: Candle[]): ExperimentSplit {
  const sorted = [...candles].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const discoveryEnd = Math.floor(sorted.length * 0.25);
  const inSampleEnd = Math.floor(sorted.length * 0.6);
  const outOfSampleEnd = Math.floor(sorted.length * 0.8);
  return {
    discovery: sorted.slice(0, discoveryEnd),
    inSample: sorted.slice(discoveryEnd, inSampleEnd),
    outOfSample: sorted.slice(inSampleEnd, outOfSampleEnd),
    walkForward: chunk(sorted.slice(outOfSampleEnd), Math.max(20, Math.floor(sorted.length * 0.05))),
  };
}

function missingWindows(coverage: HistoricalDataCoverage, now: Date) {
  if (!coverage.start || !coverage.end) return [{ from: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString(), reason: "No historical candles available." }];
  const start = Date.parse(coverage.start);
  const minimumStart = now.getTime() - 365 * 24 * 60 * 60 * 1000;
  return start > minimumStart ? [{ from: new Date(minimumStart).toISOString(), to: coverage.start, reason: "Less than one year imported." }] : [];
}

function stability(values: number[]) {
  if (values.length < 2) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return round(Math.max(0, 1 - Math.sqrt(variance) / Math.max(Math.abs(avg), 1)), 3);
}

function consistency(values: number[]) {
  if (values.length === 0) return 0;
  return round(values.filter((value) => value > 0).length / values.length, 3);
}

function topReasons(reasons: string[]) {
  return Object.entries(reasons.reduce<Record<string, number>>((counts, reason) => ({ ...counts, [reason]: (counts[reason] ?? 0) + 1 }), {}))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason]) => reason)
    .slice(0, 5);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks.filter((item) => item.length > 0);
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

export const researchAccelerationService = new ResearchAccelerationService();
