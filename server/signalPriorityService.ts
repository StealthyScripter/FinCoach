import type { PrioritizedSignal, SignalPriorityInput } from "@shared/schema";

const weights = {
  relevanceToGoal: 0.18,
  marketImpact: 0.15,
  confidence: 0.14,
  freshness: 0.11,
  portfolioExposure: 0.12,
  riskSeverity: 0.13,
  learningValue: 0.07,
  actionability: 0.10,
};

export class SignalPriorityService {
  rank(signals: SignalPriorityInput[], limit = 12): PrioritizedSignal[] {
    return signals
      .map((signal) => {
        const priorityScore = scoreSignal(signal);
        return {
          ...signal,
          priorityScore,
          displayTier: displayTier(priorityScore, signal),
          reason: explainPriority(signal, priorityScore),
        };
      })
      .sort((left, right) => right.priorityScore - left.priorityScore)
      .slice(0, limit);
  }
}

export const signalPriorityService = new SignalPriorityService();

function scoreSignal(signal: SignalPriorityInput) {
  const score = Object.entries(weights).reduce((sum, [key, weight]) => {
    return sum + signal[key as keyof typeof weights] * weight;
  }, 0);

  const criticalBoost = signal.category === "critical" || signal.riskSeverity >= 85 ? 8 : 0;
  return Math.max(0, Math.min(100, Number((score + criticalBoost).toFixed(1))));
}

function displayTier(score: number, signal: SignalPriorityInput): PrioritizedSignal["displayTier"] {
  if (signal.category === "critical" || signal.riskSeverity >= 85 || score >= 75) return "primary";
  if (score >= 55) return "secondary";
  if (score >= 35) return "advanced";
  return "hidden";
}

function explainPriority(signal: SignalPriorityInput, score: number) {
  if (signal.riskSeverity >= 85) return "Promoted because risk severity is high.";
  if (signal.portfolioExposure >= 70) return "Promoted because the user has meaningful portfolio exposure.";
  if (signal.actionability >= 75 && signal.confidence >= 70) return "Promoted because it is actionable and reasonably verified.";
  if (score < 35) return "Collapsed because relevance, confidence, or actionability is low.";
  return "Ranked by goal relevance, impact, confidence, risk, and learning value.";
}
