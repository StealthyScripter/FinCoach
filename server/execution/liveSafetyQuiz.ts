export type LiveSafetyTopic =
  | "leverage"
  | "margin"
  | "slippage"
  | "spreads"
  | "stop_loss_failure"
  | "news_gaps"
  | "commodities_volatility"
  | "forex_rollover"
  | "platform_outages"
  | "emotional_trading"
  | "irreversible_submission";

export type LiveSafetyQuestion = {
  id: string;
  topic: LiveSafetyTopic;
  prompt: string;
  choices: string[];
  correctChoice: number;
  explanation: string;
};

export const LIVE_SAFETY_QUIZ: LiveSafetyQuestion[] = [
  question("leverage", "What does leverage do to trading outcomes?", ["Only increases gains", "Magnifies both gains and losses", "Removes margin risk"], 1, "Leverage magnifies both gains and losses."),
  question("margin", "What can happen when available margin becomes insufficient?", ["The broker may liquidate positions", "Stops become guaranteed", "The trade becomes risk-free"], 0, "Brokers may liquidate positions when margin requirements are not met."),
  question("slippage", "What is slippage?", ["A guaranteed commission", "The difference between expected and actual execution price", "An overnight financing credit"], 1, "Fast or thin markets can fill away from the expected price."),
  question("spreads", "When do spreads commonly widen?", ["Only after a trade closes", "During low liquidity or high volatility", "They never change"], 1, "Spreads can widen materially during volatile or illiquid periods."),
  question("stop_loss_failure", "Can a stop-loss guarantee the requested exit price?", ["Yes, always", "No, gaps and outages can cause worse fills", "Only on commodities"], 1, "Stops can slip or fail to execute at the requested price."),
  question("news_gaps", "What is a major risk around high-impact news?", ["Guaranteed liquidity", "Price gaps and rapid repricing", "No rollover"], 1, "News can cause gaps and rapid repricing."),
  question("commodities_volatility", "Why can commodities require smaller sizing?", ["They cannot use stops", "They may exhibit sharp volatility and contract-specific risk", "They have fixed prices"], 1, "Commodity volatility and contract behavior can amplify loss."),
  question("forex_rollover", "What is forex rollover?", ["A guaranteed profit", "Financing applied when positions are held across the broker cutoff", "A spread refund"], 1, "Overnight positions may incur or receive financing."),
  question("platform_outages", "What should a trader assume about platform availability?", ["It is always available", "Outages can prevent entry, modification, or exit", "Only paper accounts fail"], 1, "Broker, network, or device outages can interrupt control."),
  question("emotional_trading", "What is the appropriate response after repeated losses?", ["Increase size to recover", "Follow cooling-off and risk limits", "Disable the journal"], 1, "Loss chasing violates disciplined risk controls."),
  question("irreversible_submission", "What does final live order confirmation mean?", ["The order can always be undone", "Submission may create an immediate real-money obligation", "It is only a simulation"], 1, "A submitted live order can fill immediately and cannot be assumed reversible."),
];

export class LiveSafetyQuizService {
  readonly passingScore = 90;

  grade(answers: Record<string, number>, now = new Date()) {
    const results = LIVE_SAFETY_QUIZ.map((item) => ({
      questionId: item.id,
      topic: item.topic,
      correct: answers[item.id] === item.correctChoice,
      explanation: item.explanation,
    }));
    const correctCount = results.filter((item) => item.correct).length;
    const score = Math.round(correctCount / LIVE_SAFETY_QUIZ.length * 100);
    const result = {
      score,
      passingScore: this.passingScore,
      passed: score >= this.passingScore,
      correctCount,
      questionCount: LIVE_SAFETY_QUIZ.length,
      results,
      completedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    };
    executionAuditLog.append({
      action: "live.safety_quiz",
      outcome: result.passed ? "accepted" : "rejected",
      correlationId: randomUUID(),
      detail: { score: result.score, passingScore: result.passingScore, passed: result.passed },
    });
    return result;
  }
}

function question(topic: LiveSafetyTopic, prompt: string, choices: string[], correctChoice: number, explanation: string): LiveSafetyQuestion {
  return { id: `live-${topic}`, topic, prompt, choices, correctChoice, explanation };
}

export const liveSafetyQuizService = new LiveSafetyQuizService();
import { randomUUID } from "crypto";
import { executionAuditLog } from "./riskControls";
