import type { BacktestRequest, BacktestResult, MarketPilotOverview, MarketPilotEvent } from "@shared/schema";
import { eventLogService } from "./eventLogService";
import { backtestingService } from "./backtestingService";

export type HistoricalModelBenchmark = {
  id: string;
  name: string;
  allocation: BacktestRequest["allocation"];
  backtest: BacktestResult;
  score: number;
  verdict: "pass" | "watchlist" | "reject";
  notes: string[];
};

export type HistoricalModelValidationReport = {
  generatedAt: string;
  benchmarkVersion: string;
  datasetName: string;
  overallScore: number;
  status: "pass" | "review" | "fail";
  bestModelId: string;
  worstModelId: string;
  models: HistoricalModelBenchmark[];
  requiredActions: string[];
  evidence: string[];
};

const BENCHMARK_VERSION = "marketpilot-model-validation-v1";

export class ModelValidationBenchmarkService {
  run(overview: MarketPilotOverview, now = new Date()): HistoricalModelValidationReport {
    const models = [
      benchmarkModel("three_fund", "Three-Fund Core", [
        { symbol: "VTI", targetPct: 60 },
        { symbol: "VXUS", targetPct: 20 },
        { symbol: "BND", targetPct: 20 },
      ]),
      benchmarkModel("sixty_forty", "60/40 Balanced", [
        { symbol: "VTI", targetPct: 60 },
        { symbol: "BND", targetPct: 40 },
      ]),
      benchmarkModel("risk_parity", "Defensive Barbell", [
        { symbol: "SGOV", targetPct: 40 },
        { symbol: "BND", targetPct: 35 },
        { symbol: "VTI", targetPct: 25 },
      ]),
      benchmarkModel("concentrated_growth", "Concentrated Growth", [
        { symbol: "QQQ", targetPct: 80 },
        { symbol: "VTI", targetPct: 20 },
      ]),
    ].map((model) => {
      const backtest = backtestingService.run({
        strategyName: model.name,
        startYear: 2008,
        endYear: 2026,
        initialCapital: 100_000,
        monthlyContribution: 500,
        rebalanceFrequency: "annual",
        allocation: model.allocation,
      });
      const score = scoreBenchmark(backtest);
      const verdict: HistoricalModelBenchmark["verdict"] = score >= 78 ? "pass" : score >= 60 ? "watchlist" : "reject";
      return {
        ...model,
        backtest,
        score,
        verdict,
        notes: [
          verdict === "pass" ? "Historical performance is strong enough for continued paper review." : "Review this model against lower-volatility alternatives before use.",
          backtest.maxDrawdownPct < -20 ? "Historical drawdown exceeds a foundation-stage comfort threshold." : "Drawdown remained within a manageable band.",
        ],
      };
    });

    const best = [...models].sort((left, right) => right.score - left.score)[0];
    const worst = [...models].sort((left, right) => left.score - right.score)[0];
    const overallScore = Math.round(models.reduce((sum, model) => sum + model.score, 0) / models.length);
    const status: HistoricalModelValidationReport["status"] =
      overallScore >= 78 && best.verdict === "pass" ? "pass" : overallScore >= 62 ? "review" : "fail";
    const requiredActions = [
      ...(worst.verdict === "reject" ? [`Avoid ${worst.name} until historical drawdown and Sharpe improve.`] : []),
      ...(best.backtest.maxDrawdownPct < -20 ? ["Prefer models with shallower crisis drawdowns before any supervised-live consideration."] : []),
      ...(status === "fail" ? ["Model validation is not strong enough for automation; keep the result paper-only."] : []),
    ];

    return {
      generatedAt: now.toISOString(),
      benchmarkVersion: BENCHMARK_VERSION,
      datasetName: "Deterministic historical return fixture 2008-2026",
      overallScore,
      status,
      bestModelId: best.id,
      worstModelId: worst.id,
      models,
      requiredActions,
      evidence: [
        "Models are benchmarked against the same deterministic crisis-and-recovery return fixture used by backtesting.",
        `${models.length} canonical allocations were compared on return, volatility, drawdown, and Sharpe.`,
        "Results remain paper-only and do not authorize live execution.",
      ],
    };
  }

  record(report: HistoricalModelValidationReport, overview: MarketPilotOverview) {
    return eventLogService.append({
      type: "analytics.model_validation_recorded",
      userId: overview.user.id,
      sourceService: "model-validation-benchmark-service",
      payload: {
        benchmarkVersion: report.benchmarkVersion,
        datasetName: report.datasetName,
        overallScore: report.overallScore,
        status: report.status,
        bestModelId: report.bestModelId,
        worstModelId: report.worstModelId,
        requiredActions: report.requiredActions,
      },
    });
  }

  latest(limit = 10): MarketPilotEvent[] {
    return eventLogService
      .list(250)
      .filter((event) => event.type === "analytics.model_validation_recorded")
      .slice(0, limit);
  }
}

const modelValidationBenchmarkService = new ModelValidationBenchmarkService();
export { modelValidationBenchmarkService };

function benchmarkModel(id: string, name: string, allocation: BacktestRequest["allocation"]) {
  return { id, name, allocation };
}

function scoreBenchmark(backtest: BacktestResult) {
  const drawdownPenalty = Math.abs(backtest.maxDrawdownPct) * 1.5;
  const volatilityPenalty = backtest.volatilityPct * 0.6;
  const returnReward = backtest.annualizedReturnPct * 1.1;
  const sharpeReward = backtest.sharpeRatio * 14;
  return Math.max(0, Math.min(100, Math.round(returnReward + sharpeReward - drawdownPenalty - volatilityPenalty + 40)));
}
