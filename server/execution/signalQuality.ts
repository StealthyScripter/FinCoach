export type SignalQualityInput = {
  sourceReliability: number;
  strategyValidationScore: number;
  timeframeQuality: number;
  trendAlignment: number;
  volatilityRegime: number;
  spreadLiquidityCondition: number;
  recentFalseSignalRate: number;
  newsRisk: number;
  riskRewardRatio: number;
};

export type SignalQualityDecision = "accept" | "reject" | "paper_only" | "watch_only";

export class SignalQualityFilter {
  evaluate(input: SignalQualityInput) {
    for (const [key, value] of Object.entries(input)) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid signal quality metric: ${key}`);
    }
    const riskRewardScore = Math.min(100, input.riskRewardRatio / 3 * 100);
    const score = round(
      bounded(input.sourceReliability) * 0.16
      + bounded(input.strategyValidationScore) * 0.2
      + bounded(input.timeframeQuality) * 0.1
      + bounded(input.trendAlignment) * 0.12
      + bounded(input.volatilityRegime) * 0.1
      + bounded(input.spreadLiquidityCondition) * 0.12
      + (100 - bounded(input.recentFalseSignalRate)) * 0.08
      + (100 - bounded(input.newsRisk)) * 0.06
      + riskRewardScore * 0.06,
    );
    const hardReject = input.sourceReliability < 30
      || input.strategyValidationScore < 30
      || input.spreadLiquidityCondition < 20
      || input.newsRisk > 90
      || input.riskRewardRatio < 0.75;
    let decision: SignalQualityDecision = "reject";
    if (!hardReject && score >= 75 && input.riskRewardRatio >= 1.5) decision = "accept";
    else if (!hardReject && score >= 60) decision = "paper_only";
    else if (!hardReject && score >= 45) decision = "watch_only";
    return {
      score,
      decision,
      reasons: [
        input.sourceReliability < 50 ? "Source reliability is weak" : null,
        input.strategyValidationScore < 50 ? "Strategy validation is weak" : null,
        input.recentFalseSignalRate > 40 ? "Recent false-signal rate is elevated" : null,
        input.newsRisk > 70 ? "News risk is elevated" : null,
        input.riskRewardRatio < 1.5 ? "Risk/reward is below the preferred threshold" : null,
      ].filter((reason): reason is string => Boolean(reason)),
      evaluatedAt: new Date().toISOString(),
    };
  }
}

function bounded(value: number) {
  return Math.max(0, Math.min(100, value));
}

function round(value: number) {
  return Number(value.toFixed(2));
}

export const signalQualityFilter = new SignalQualityFilter();
