import { z } from "zod";

export const strategyValidationVerdictSchema = z.enum([
  "reject",
  "paper_only",
  "watchlist",
  "supervised_live_candidate",
]);

export type StrategyValidationVerdict = z.infer<typeof strategyValidationVerdictSchema>;

export const strategyValidationInputSchema = z.object({
  strategyId: z.string().min(1),
  instrument: z.string().min(1),
  backtest: z.object({
    netReturnPct: z.number(),
    sharpe: z.number(),
    profitFactor: z.number().nonnegative(),
    maxDrawdownPct: z.number().nonnegative(),
    tradeCount: z.number().int().nonnegative(),
  }),
  walkForward: z.object({
    profitableWindowsPct: z.number().min(0).max(100),
    outOfSampleReturnPct: z.number(),
    degradationPct: z.number().nonnegative(),
  }),
  monteCarlo: z.object({
    profitableRunsPct: z.number().min(0).max(100),
    medianEndingReturnPct: z.number(),
    riskOfRuinPct: z.number().min(0).max(100),
  }),
  regimePerformance: z.record(z.string(), z.number()).default({}),
  symbolPerformance: z.record(z.string(), z.number()).default({}),
});

export type StrategyValidationInput = z.infer<typeof strategyValidationInputSchema>;

export type StrategyValidationScorecard = {
  strategyId: string;
  instrument: string;
  backtestScore: number;
  walkForwardScore: number;
  monteCarloRobustnessScore: number;
  drawdownScore: number;
  riskOfRuinScore: number;
  tradeCountSufficiency: number;
  overfittingWarning: boolean;
  regimeSensitivity: "low" | "moderate" | "high";
  symbolSuitability: number;
  overallScore: number;
  verdict: StrategyValidationVerdict;
  reasons: string[];
  evaluatedAt: string;
  liveExecutionAuthorized: false;
};

export class StrategyValidationService {
  evaluate(input: StrategyValidationInput): StrategyValidationScorecard {
    const value = strategyValidationInputSchema.parse(input);
    const backtestScore = clamp(
      value.backtest.sharpe * 25
      + Math.min(value.backtest.profitFactor, 3) * 12
      + Math.max(0, value.backtest.netReturnPct) * 0.8,
    );
    const walkForwardScore = clamp(
      value.walkForward.profitableWindowsPct * 0.7
      + Math.max(0, value.walkForward.outOfSampleReturnPct) * 1.2
      - value.walkForward.degradationPct * 0.6,
    );
    const monteCarloRobustnessScore = clamp(
      value.monteCarlo.profitableRunsPct * 0.75
      + Math.max(0, value.monteCarlo.medianEndingReturnPct)
      - value.monteCarlo.riskOfRuinPct * 1.5,
    );
    const drawdownScore = clamp(100 - value.backtest.maxDrawdownPct * 4);
    const riskOfRuinScore = clamp(100 - value.monteCarlo.riskOfRuinPct * 5);
    const tradeCountSufficiency = clamp(value.backtest.tradeCount / 100 * 100);
    const regimeValues = Object.values(value.regimePerformance);
    const regimeRange = regimeValues.length > 1 ? Math.max(...regimeValues) - Math.min(...regimeValues) : 0;
    const regimeSensitivity = regimeRange > 20 ? "high" : regimeRange > 10 ? "moderate" : "low";
    const symbolReturn = value.symbolPerformance[value.instrument];
    const symbolSuitability = clamp(symbolReturn === undefined ? 40 : 50 + symbolReturn * 2);
    const overfittingWarning = value.walkForward.degradationPct > 35
      || value.walkForward.outOfSampleReturnPct <= 0
      || backtestScore - walkForwardScore > 30;
    const overallScore = round(
      backtestScore * 0.2
      + walkForwardScore * 0.2
      + monteCarloRobustnessScore * 0.18
      + drawdownScore * 0.14
      + riskOfRuinScore * 0.14
      + tradeCountSufficiency * 0.08
      + symbolSuitability * 0.06,
    );
    const reasons = [
      value.backtest.tradeCount < 30 ? "Insufficient trade count" : null,
      value.monteCarlo.riskOfRuinPct > 10 ? "Risk of ruin exceeds 10%" : null,
      value.backtest.maxDrawdownPct > 25 ? "Maximum drawdown exceeds 25%" : null,
      overfittingWarning ? "Out-of-sample degradation indicates possible overfitting" : null,
      regimeSensitivity === "high" ? "Performance is highly regime-sensitive" : null,
      symbolSuitability < 50 ? `${value.instrument} suitability is weak or unproven` : null,
    ].filter((reason): reason is string => Boolean(reason));

    let verdict: StrategyValidationVerdict = "reject";
    if (!reasons.slice(0, 3).length && overallScore >= 80 && !overfittingWarning && regimeSensitivity !== "high") {
      verdict = "supervised_live_candidate";
    } else if (overallScore >= 65 && value.backtest.tradeCount >= 50 && value.monteCarlo.riskOfRuinPct <= 10) {
      verdict = "watchlist";
    } else if (overallScore >= 45 && value.backtest.tradeCount >= 30 && value.monteCarlo.riskOfRuinPct <= 20) {
      verdict = "paper_only";
    }

    return {
      strategyId: value.strategyId,
      instrument: value.instrument,
      backtestScore: round(backtestScore),
      walkForwardScore: round(walkForwardScore),
      monteCarloRobustnessScore: round(monteCarloRobustnessScore),
      drawdownScore: round(drawdownScore),
      riskOfRuinScore: round(riskOfRuinScore),
      tradeCountSufficiency: round(tradeCountSufficiency),
      overfittingWarning,
      regimeSensitivity,
      symbolSuitability: round(symbolSuitability),
      overallScore,
      verdict,
      reasons,
      evaluatedAt: new Date().toISOString(),
      liveExecutionAuthorized: false,
    };
  }

  unvalidated(strategyId: string, instrument: string): StrategyValidationScorecard {
    return this.evaluate({
      strategyId,
      instrument,
      backtest: { netReturnPct: 0, sharpe: 0, profitFactor: 0, maxDrawdownPct: 100, tradeCount: 0 },
      walkForward: { profitableWindowsPct: 0, outOfSampleReturnPct: 0, degradationPct: 100 },
      monteCarlo: { profitableRunsPct: 0, medianEndingReturnPct: 0, riskOfRuinPct: 100 },
      regimePerformance: {},
      symbolPerformance: {},
    });
  }
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function round(value: number) {
  return Number(value.toFixed(2));
}

export const strategyValidationService = new StrategyValidationService();
