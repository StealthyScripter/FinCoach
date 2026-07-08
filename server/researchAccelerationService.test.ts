import assert from "node:assert/strict";
import {
  HistoricalCoveragePlanner,
  HistoricalReplayService,
  OandaPracticeCandleProvider,
  ReplayExperimentRunner,
  ResearchAccelerationService,
  StabilityComparisonService,
  splitCandles,
} from "./researchAccelerationService";
import { HistoricalDataImportService, historicalDataImportService } from "./historicalDataImportService";
import { evaluatePromotionReadiness } from "./strategyResearchSchedulerService";
import type { BacktestResult, BacktestTrade } from "./strategy-machine/backtesting";
import type { EventReference } from "./strategy-machine/core";

const now = new Date("2026-01-01T12:00:00.000Z");
const service = new HistoricalDataImportService();
service.ensureDemoHistory({ instruments: ["EUR/USD", "GBP/USD"], timeframe: "15m", count: 420, now });

const coverage = new HistoricalCoveragePlanner(service).plan(now);
assert.equal(coverage.items.length, 20);
assert.ok(coverage.items.some((item) => item.instrument === "EUR_USD" && item.timeframe === "15m" && item.candlesAvailable >= 420));
assert.ok(coverage.items.some((item) => item.instrument === "XAU_USD" && item.timeframe === "4h" && item.target === "missing"));
assert.ok(coverage.items.some((item) => item.missingWindows.length > 0), "missing windows should be reported");

const csvService = new HistoricalDataImportService();
csvService.importCsv({
  now,
  csv: [
    "timestamp,instrument,timeframe,open,high,low,close,volume",
    "2025-12-31T00:00:00.000Z,XAU/USD,1h,2300,2302,2298,2301,20",
    "2025-12-31T01:00:00.000Z,XAU/USD,1h,2301,2305,2300,2304,21",
  ].join("\n"),
});
const csvCoverage = new HistoricalCoveragePlanner(csvService).plan(now);
assert.equal(csvCoverage.items.find((item) => item.instrument === "XAU_USD" && item.timeframe === "1h")?.candlesAvailable, 2);

const provider = new OandaPracticeCandleProvider(
  { OANDA_ENV: "practice", OANDA_API_TOKEN: "redacted-test-token" } as NodeJS.ProcessEnv,
  async (url, init) => {
    assert.match(String(url), /api-fxpractice\.oanda\.com/);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer redacted-test-token");
    return {
      ok: true,
      async json() {
        return {
          candles: [
            { complete: true, time: "2025-12-31T00:00:00.000Z", volume: 10, mid: { o: "1.1000", h: "1.1010", l: "1.0990", c: "1.1005" } },
            { complete: false, time: "2025-12-31T00:15:00.000Z", volume: 11, mid: { o: "1.1005", h: "1.1015", l: "1.1000", c: "1.1010" } },
          ],
        };
      },
    } as Response;
  },
);
const oandaCandles = await provider.fetchCandles({ instrument: "EUR_USD", timeframe: "15m", count: 2 });
assert.equal(oandaCandles.length, 1, "mocked OANDA import should ignore incomplete candles");
assert.equal(oandaCandles[0].instrument, "EUR_USD");

const candles = service.getCandles("EUR/USD", "15m");
const split = splitCandles(candles);
assert.ok(split.discovery.length > 0);
assert.ok(split.inSample.length > split.outOfSample.length);
assert.ok(split.walkForward.length >= 1);

const replay = new HistoricalReplayService().replay({ candles: split.discovery, windowSize: Math.min(80, split.discovery.length) });
assert.equal(replay.executionAttempted, false);
assert.ok(replay.events.some((event) => event.type === "MarketSnapshotCreated"));
assert.ok(replay.events.some((event) => event.type === "CandleSeriesCreated"));
assert.ok(replay.events.some((event) => /Pattern/.test(event.type)));
assert.ok(replay.events.slice(1).some((event) => event.sourceEventRefs.length > 0), "replay events should preserve lineage");

const runner = new ReplayExperimentRunner(service);
const outcomes = runner.run({ instruments: ["EUR/USD"], timeframe: "15m", now });
assert.equal(outcomes.length, 1);
assert.notEqual(outcomes[0].experimentId, "not-created");
assert.ok(outcomes[0].replayEvents > 0);

const stable = new StabilityComparisonService().compare({
  experimentId: "stable",
  windows: [
    result("stable", 0.18, 1.6, 0.6, 0.55),
    result("stable", 0.17, 1.55, 0.62, 0.54),
    result("stable", 0.19, 1.62, 0.58, 0.56),
  ],
  sampleDepth: service.sampleDepth(candles),
});
assert.equal(stable.stable, true, stable.reasons.join("; "));

const fragile = new StabilityComparisonService().compare({
  experimentId: "fragile",
  windows: [
    result("fragile", 0.4, 3.5, 0.2, 0.8),
    result("fragile", -0.2, 0.4, 2.8, 0.25),
  ],
  sampleDepth: new HistoricalDataImportService().sampleDepth(candles.slice(0, 40)),
});
assert.equal(fragile.stable, false);
assert.ok(fragile.fragileParameterSet || fragile.narrowOptima || fragile.regimeSpecificOverfitting);

historicalDataImportService.clearForTest();
historicalDataImportService.ensureDemoHistory({ instruments: ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD"], timeframe: "15m", count: 420, now });
const acceleration = new ResearchAccelerationService();
const run = acceleration.runReplay({ instruments: ["EUR/USD", "GBP/USD"], timeframe: "15m", now });
assert.equal(run.status.running, false);
assert.equal(run.status.experimentsRun, 2);
assert.equal(run.report.forwardTestingJustified, run.stability.some((comparison) => comparison.stable));
assert.ok(run.report.equivalentMarketDaysReplayed > 0);
assert.ok(run.report.evidenceGapsRemaining.length > 0, "short demo history should leave explicit evidence gaps");

const quality = promotionInput();
assert.equal(evaluatePromotionReadiness({ ...quality, historicalStabilityApproved: false }).fullEvidence, false);
assert.match(
  evaluatePromotionReadiness({ ...quality, historicalStabilityApproved: false }).rejectionReasons.join(" "),
  /Historical stability/,
);
assert.equal(evaluatePromotionReadiness({ ...quality, historicalStabilityApproved: true }).fullEvidence, true);

console.log("researchAccelerationService tests passed");

function result(experimentId: string, expectancy: number, profitFactor: number, maxDrawdown: number, winRate: number): BacktestResult {
  const trades = Array.from({ length: 24 }, (_, index): BacktestTrade => ({
    entryAt: `2025-01-01T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    exitAt: `2025-01-01T${String(index % 24).padStart(2, "0")}:15:00.000Z`,
    instrument: index % 2 === 0 ? "EUR_USD" : "GBP_USD",
    direction: "long",
    entry: 1,
    exit: 1 + expectancy / 10,
    stop: 0.99,
    target: 1.02,
    rMultiple: expectancy,
    outcome: expectancy > 0 ? "win" : "loss",
    session: index % 3 === 0 ? "london" : "new_york",
    regime: index % 2 === 0 ? "supportive" : "adverse",
  }));
  return {
    experimentId,
    ruleSetId: `${experimentId}-rule`,
    tradeCount: trades.length,
    winRate,
    lossRate: 1 - winRate,
    expectancy,
    profitFactor,
    maxDrawdown,
    averageWinner: Math.max(expectancy, 0),
    averageLoser: Math.min(expectancy, 0),
    averageR: expectancy,
    bestTrade: trades[0],
    worstTrade: trades[trades.length - 1],
    regimeBreakdown: { supportive: 12, adverse: 12 },
    symbolBreakdown: { EUR_USD: 12, GBP_USD: 12 },
    timeframeBreakdown: { "15m": 24 },
    sessionBreakdown: { london: 8, new_york: 16 },
    trades,
  };
}

function promotionInput() {
  const refs: EventReference[] = ["snapshot", "hypothesis", "rule", "backtest", "validation"].map((id) => ({
    eventId: id,
    eventType: `${id}Event`,
    module: id,
    schemaVersion: "strategy-machine.v1",
    occurredAt: "2026-01-01T08:00:00.000Z",
  }));
  return {
    validationVerdict: "candidate",
    validationResult: { actualSampleSize: 80, evidenceScore: 0.76, overfittingWarning: false },
    backtestResult: { expectancy: 0.18, profitFactor: 1.6, maxDrawdown: 0.7 },
    detectedPatternCount: 2,
    ruleSet: {
      ruleSetId: "quality-rule",
      version: 1,
      entryCondition: [{ field: "compressionBreakout", operator: "==", value: true }],
      exitCondition: [{ field: "barsInTrade", operator: ">=", value: 12 }],
      stopLossRule: [{ field: "stopDistanceAtr", operator: ">=", value: 0.8 }],
      takeProfitRule: [{ field: "targetR", operator: ">=", value: 1.5 }],
      sourceHypothesisRefs: [refs[1]],
    },
    invalidationEvidenceCount: 1,
    demoOnlyApproved: true,
    marketSnapshotRefCount: 1,
    journal: {
      entryReason: "objective replay evidence supports candidate",
      hypothesisId: "hypothesis-1",
      ruleVersion: 1,
      stopLoss: 1.09,
      takeProfit: 1.12,
      expectedOutcome: "positive expectancy",
      actualOutcome: "open",
      lessonLearned: "forward test only after stability",
      beforeEntrySnapshotRefs: [refs[0]],
      sourceEventRefs: refs.slice(1),
    },
    eventLineageRefs: refs,
  };
}
