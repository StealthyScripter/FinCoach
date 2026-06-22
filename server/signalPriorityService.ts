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

export type SignalPriorityContext = {
  memoryLesson?: string | null;
};

export class SignalPriorityService {
  rank(signals: SignalPriorityInput[], limit = 12, context: SignalPriorityContext = {}): PrioritizedSignal[] {
    return signals
      .map((signal) => {
        const priorityScore = scoreSignal(signal, context.memoryLesson ?? null);
        return {
          ...signal,
          priorityScore,
          displayTier: displayTier(priorityScore, signal),
          reason: explainPriority(signal, priorityScore, context.memoryLesson ?? null),
        };
      })
      .sort((left, right) => right.priorityScore - left.priorityScore)
      .slice(0, limit);
  }
}

export const signalPriorityService = new SignalPriorityService();

function scoreSignal(signal: SignalPriorityInput, memoryLesson: string | null) {
  const score = Object.entries(weights).reduce((sum, [key, weight]) => {
    return sum + signal[key as keyof typeof weights] * weight;
  }, 0);

  const criticalBoost = signal.category === "critical" || signal.riskSeverity >= 85 ? 8 : 0;
  const memoryBoost = memoryLesson ? memoryLessonBoost(memoryLesson, signal) : 0;
  return Math.max(0, Math.min(100, Number((score + criticalBoost + memoryBoost).toFixed(1))));
}

function displayTier(score: number, signal: SignalPriorityInput): PrioritizedSignal["displayTier"] {
  if (signal.category === "critical" || signal.riskSeverity >= 85 || score >= 75) return "primary";
  if (score >= 55) return "secondary";
  if (score >= 35) return "advanced";
  return "hidden";
}

function explainPriority(signal: SignalPriorityInput, score: number, memoryLesson: string | null) {
  const lessonReason = memoryLesson ? memoryLessonReason(memoryLesson, signal) : null;
  if (lessonReason) return lessonReason;
  if (signal.riskSeverity >= 85) return "Promoted because risk severity is high.";
  if (signal.portfolioExposure >= 70) return "Promoted because the user has meaningful portfolio exposure.";
  if (signal.actionability >= 75 && signal.confidence >= 70) return "Promoted because it is actionable and reasonably verified.";
  if (score < 35) return "Collapsed because relevance, confidence, or actionability is low.";
  return "Ranked by goal relevance, impact, confidence, risk, and learning value.";
}

function memoryLessonBoost(memoryLesson: string, signal: SignalPriorityInput) {
  const lesson = memoryLesson.toLowerCase();
  const text = `${signal.title} ${signal.summary} ${signal.details.join(" ")}`.toLowerCase();

  if ((/risk|drawdown|loss|sizing|size/.test(lesson)) && (signal.category === "risk_warning" || signal.category === "critical" || signal.riskSeverity >= 70)) {
    return text.includes("risk") || text.includes("loss") || text.includes("size") ? 5 : 3;
  }

  if ((/confirm|confirmation|catalyst|evidence/.test(lesson)) && (signal.category === "learning" || signal.category === "explanation")) {
    return text.includes("confirmation") || text.includes("evidence") || text.includes("catalyst") ? 5 : 3;
  }

  if ((/lesson|review|mistake|update/.test(lesson)) && signal.category === "learning") {
    return 4;
  }

  return 0;
}

function memoryLessonReason(memoryLesson: string, signal: SignalPriorityInput) {
  const lesson = memoryLesson.toLowerCase();
  if ((/risk|drawdown|loss|sizing|size/.test(lesson)) && (signal.category === "risk_warning" || signal.category === "critical" || signal.riskSeverity >= 70)) {
    return "Promoted because it matches the active lesson about risk, sizing, or drawdown control.";
  }
  if ((/confirm|confirmation|catalyst|evidence/.test(lesson)) && (signal.category === "learning" || signal.category === "explanation")) {
    return "Promoted because it matches the active lesson about confirmation and evidence quality.";
  }
  if ((/lesson|review|mistake|update/.test(lesson)) && signal.category === "learning") {
    return "Promoted because it matches the active lesson review loop.";
  }
  return null;
}
