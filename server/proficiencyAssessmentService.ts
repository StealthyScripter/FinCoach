import { randomUUID } from "crypto";
import type {
  LearningModule,
  ProficiencyAssessmentResult,
  ProficiencyScore,
  Progression,
  QuizResult,
  QuizSubmission,
} from "@shared/schema";

export class ProficiencyAssessmentService {
  assess({
    submission,
    scores,
    modules,
    progression,
    now = new Date(),
  }: {
    submission: QuizSubmission;
    scores: ProficiencyScore[];
    modules: LearningModule[];
    progression: Progression;
    now?: Date;
  }): ProficiencyAssessmentResult {
    const current = scores.find((score) => score.category === submission.category);
    const module = modules.find((item) => item.id === submission.moduleId);

    if (!current) {
      throw Object.assign(new Error("Unknown proficiency category"), { status: 400 });
    }

    if (!module) {
      throw Object.assign(new Error("Unknown learning module"), { status: 400 });
    }

    const passed = submission.score >= module.requiredScore;
    const reflectionBonus = submission.reflection && submission.reflection.length >= 80 ? 2 : 0;
    const weightedScore = Math.round((current.score * 0.7) + (submission.score * 0.3) + reflectionBonus);
    const updatedNumericScore = clamp(passed ? Math.max(current.score, weightedScore) : Math.max(0, weightedScore - 2));
    const unlocked = getUnlocks(submission.category, updatedNumericScore);
    const evidence = [
      `Quiz ${module.title}: ${submission.score}%`,
      ...(submission.reflection ? [`Reflection submitted: ${submission.reflection.slice(0, 120)}`] : []),
    ];
    const updatedScore: ProficiencyScore = {
      ...current,
      score: updatedNumericScore,
      unlocks: Array.from(new Set([...current.unlocks, ...unlocked])),
      evidence: [...evidence, ...current.evidence].slice(0, 8),
      updatedAt: now.toISOString(),
    };
    const updatedModule: LearningModule = {
      ...module,
      progress: clamp(Math.max(module.progress, passed ? Math.min(100, module.progress + 20) : module.progress + 8)),
      status: passed ? "unlocked" : module.status,
    };
    const remediation = passed
      ? []
      : [
          `Retake ${module.title} after reviewing missed concepts.`,
          "Write a short explanation separating fact, interpretation, and prediction.",
          "Complete one paper scenario before attempting the next gate.",
        ];
    const quizResult: QuizResult = {
      id: randomUUID(),
      moduleId: submission.moduleId,
      category: submission.category,
      score: submission.score,
      passed,
      answers: {
        ...submission.answers,
        reflection: submission.reflection ?? null,
      },
      feedback: passed
        ? [`Passed ${module.title}; proficiency evidence updated.`]
        : [`Did not pass ${module.title}; remediation assigned before unlock.`],
      createdAt: now.toISOString(),
    };

    const nextScores = scores.map((score) => score.category === updatedScore.category ? updatedScore : score);
    const nextProgression = deriveProgression(nextScores, progression);

    return {
      quizResult,
      previousScore: current.score,
      updatedScore,
      proficiencyDelta: updatedScore.score - current.score,
      module: updatedModule,
      passed,
      unlocked,
      remediation,
      progression: nextProgression,
    };
  }
}

export const proficiencyAssessmentService = new ProficiencyAssessmentService();

export function deriveProgression(scores: ProficiencyScore[], fallback: Progression): Progression {
  const scoreByCategory = new Map(scores.map((score) => [score.category, score.score]));
  const requirements = {
    marketBasics: scoreByCategory.get("market_basics") ?? 0,
    macro: scoreByCategory.get("macroeconomics") ?? 0,
    risk: scoreByCategory.get("risk_management") ?? 0,
    portfolio: scoreByCategory.get("portfolio_construction") ?? 0,
    options: scoreByCategory.get("options") ?? 0,
  };
  const paperReady = requirements.marketBasics >= 60
    && requirements.macro >= 60
    && requirements.risk >= 60
    && requirements.portfolio >= 60;
  const liveReady = paperReady
    && requirements.options >= 85
    && requirements.risk >= 85
    && requirements.portfolio >= 75;
  const blockedBy = [
    requirements.marketBasics < 60 ? "Market basics score below 60" : null,
    requirements.macro < 60 ? "Macroeconomics score below 60" : null,
    requirements.risk < 60 ? "Risk management score below 60" : null,
    requirements.portfolio < 60 ? "Portfolio construction score below 60" : null,
    requirements.options < 70 ? "Options score below the simulation unlock threshold" : null,
    "Live trading disabled by policy until Stage 3",
  ].filter((item): item is string => Boolean(item));

  return {
    ...fallback,
    currentStage: liveReady ? "supervised_live" : paperReady ? "research_paper" : "foundation",
    stageLabel: liveReady
      ? "Stage 3: Supervised Live Assistance Mode"
      : paperReady
        ? "Stage 2: Research and Paper Portfolio Mode"
        : "Stage 1: Foundation Mode",
    nextStage: liveReady ? null : paperReady ? "supervised_live" : "research_paper",
    paperTradingUnlock: paperReady ? "unlocked" : fallback.paperTradingUnlock,
    liveTradingUnlock: liveReady ? "available" : "locked",
    blockedBy,
  };
}

function getUnlocks(category: ProficiencyScore["category"], score: number) {
  const unlocks: string[] = [];
  if (score >= 60 && ["market_basics", "risk_management", "portfolio_construction"].includes(category)) {
    unlocks.push("Paper trading evidence gate");
  }
  if (category === "options" && score >= 70) unlocks.push("Options simulation");
  if (category === "options" && score >= 85) unlocks.push("Options spreads review");
  if (category === "risk_management" && score >= 90) unlocks.push("Margin safety review");
  return unlocks;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
