import { randomUUID } from "crypto";
import type {
  DecisionCard,
  HistoricalAnalogue,
  MarketMovementExplanation,
  MarketPilotOverview,
  MemoryRecord,
  SignalPriorityInput,
  StrategySuggestion,
  TradingAssistantRequest,
  TradingAssistantResponse,
} from "@shared/schema";
import { agentMemoryService } from "./memoryService";
import type { MemoryRecallItem } from "./memoryService";
import { marketMoveInvestigationService } from "./marketMoveInvestigationService";
import { predictionReviewService } from "./predictionReviewService";
import { ragContextBuilder, type RetrievedContext } from "./ragService";
import { researchService } from "./researchService";
import { signalPriorityService } from "./signalPriorityService";
import { strategySuggestionService } from "./strategySuggestionService";
import { tradingAssistantIntentService, type TradingAssistantIntentClassification } from "./tradingAssistantIntentService";

export class TradingAssistantService {
  async respond(request: TradingAssistantRequest, overview: MarketPilotOverview): Promise<TradingAssistantResponse> {
    const prompt = request.prompt.trim();
    const classification = tradingAssistantIntentService.classify(prompt);
    await agentMemoryService.hydrateFromOverview(overview);
    const asset = classification.assetCandidates[0] ?? fallbackAsset(classification);
    const investigation = await marketMoveInvestigationService.investigate(asset);
    const strategy = shouldBuildStrategy(classification.intent)
      ? strategySuggestionService.suggest({
          prompt,
          explanation: toExplanation(investigation),
          overview,
        })
      : null;

    const decisionCard = buildCardForIntent({ classification, overview, investigation, strategy, prompt });
    const memoryRecall = agentMemoryService.recall(
      [prompt, classification.domain, decisionCard.mainConclusion, ...classification.requiredData].join(" "),
      3,
    );
    const memoryCue = buildMemoryCue(memoryRecall);
    if (memoryCue) {
      decisionCard.details.advancedAnalytics = [...decisionCard.details.advancedAnalytics, memoryCue];
      decisionCard.learningNote = `${decisionCard.learningNote} ${memoryCue}`;
    }
    const ragContext = await ragContextBuilder.build(overview, prompt);
    const ragCue = buildRagCue(ragContext);
    if (ragCue) {
      decisionCard.details.advancedAnalytics = [...decisionCard.details.advancedAnalytics, ragCue];
    }
    const historicalAnalogues = buildHistoricalAnalogues({
      prompt,
      classification,
      overview,
      decisionCard,
    });
    const prediction = predictionReviewService.record({
      originalThesis: decisionCard.mainConclusion,
      confidence: decisionCard.confidence,
      evidenceUsed: decisionCard.why,
      missingEvidence: decisionCard.whatCouldProveWrong,
      expectedOutcome: strategy?.possibleStrategy ?? decisionCard.nextStep,
      actualOutcome: null,
      timeHorizon: strategy?.timeHorizon ?? "Learning/review cycle",
      agent: classification.domain === "portfolio" ? "portfolio" : "verification",
      strategyDowngraded: strategy ? strategy.riskOfficerDecision !== "approve" : false,
    });
    const signals = signalPriorityService.rank(buildSignals({ overview, investigation, strategy, prompt, classification, decisionCard }), 12, {
      memoryLesson: memoryCue,
    });

    return {
      id: `assistant-${randomUUID()}`,
      intent: classification.intent,
      domain: classification.domain,
      intentClassification: classification,
      decisionCard,
      researchSummary: buildResearchSummary(decisionCard, ragContext),
      strategyOptions: strategy ? [strategy] : [],
      riskCheck: {
        decision: strategy?.riskOfficerDecision ?? "require_more_research",
        reasons: [
          "Live execution remains blocked.",
          "Human confirmation is required before any paper ticket.",
          ...(strategy?.whyItMightFail.slice(0, 2) ?? decisionCard.whatCouldProveWrong.slice(0, 2)),
        ],
        requiredActions: strategy?.requiredConfirmation ?? classification.requiredData,
      },
      verificationStatus: decisionCard.verificationStatus,
      learningNote: decisionCard.learningNote,
      predictionTrackingId: prediction.id,
      historicalAnalogues,
      signals,
    };
  }
}

export const tradingAssistantService = new TradingAssistantService();

function buildCardForIntent({
  classification,
  overview,
  investigation,
  strategy,
  prompt,
}: {
  classification: TradingAssistantIntentClassification;
  overview: MarketPilotOverview;
  investigation: Awaited<ReturnType<typeof marketMoveInvestigationService.investigate>>;
  strategy: StrategySuggestion | null;
  prompt: string;
}): DecisionCard {
  if (classification.intent === "portfolio_review") return portfolioDecisionCard(overview);
  if (classification.intent === "learning_request" || classification.intent === "credit_or_loan_question") return learningDecisionCard(classification, overview, prompt);
  if (classification.intent === "strategy_request") return strategyDecisionCard(investigation, strategy);
  if (classification.intent === "opportunity_scan") return opportunityDecisionCard(classification, overview);
  if (classification.intent === "risk_warning") return riskWarningDecisionCard(classification, overview, investigation);

  return {
    ...investigation.decisionCard,
    title: `${investigation.asset} Move: Most Likely Cause`,
    situation: `MarketPilot investigated what happened to ${investigation.asset} and reduced the answer to one primary view.`,
    suggestedAction: investigation.confidence >= 75
      ? "Watch the confirmation points before considering a paper strategy."
      : "Avoid acting until evidence improves.",
    nextStep: investigation.whatToWatchNext[0] ?? investigation.decisionCard.nextStep,
    details: {
      ...investigation.decisionCard.details,
      advancedAnalytics: [
        "Trade/investment implication: do not convert this into a trade until risk and confirmation checks pass.",
        ...investigation.tradeImplications,
        ...investigation.decisionCard.details.advancedAnalytics,
      ],
    },
  };
}

function buildHistoricalAnalogues({
  prompt,
  classification,
  overview,
  decisionCard,
}: {
  prompt: string;
  classification: TradingAssistantIntentClassification;
  overview: MarketPilotOverview;
  decisionCard: DecisionCard;
}): HistoricalAnalogue[] {
  const query = [prompt, classification.domain, decisionCard.mainConclusion, ...classification.requiredData].join(" ");
  const recallMatches = agentMemoryService.recall(query, 3).map((item) => item as MemoryRecord);
  const semanticMatches = agentMemoryService.semantic.searchSimilar(query, 3);
  const fallbackMatches = agentMemoryService.longTerm.recent(3);
  const selected: MemoryRecord[] = recallMatches.length >= 2
    ? dedupeMemoryRecords([...recallMatches, ...semanticMatches, ...fallbackMatches].slice(0, 3))
    : semanticMatches.length >= 2
      ? semanticMatches
      : dedupeMemoryRecords([...semanticMatches, ...fallbackMatches].slice(0, 3));

  return selected.map((record, index) => ({
    id: `analogue-${record.id}-${index}`,
    kind: record.kind,
    title: titleFromMemoryRecord(record),
    summary: record.text,
    whySimilar: similarityReason(record, prompt, classification, overview),
    lesson: lessonFromMemoryRecord(record),
    sourceTags: record.tags,
    confidence: confidenceFromMemoryRecord(record, index),
    createdAt: record.createdAt,
  }));
}

function buildResearchSummary(decisionCard: DecisionCard, ragContext: RetrievedContext) {
  const summary = decisionCard.why.slice(0, 2);
  const evidence = buildRagCue(ragContext);
  return evidence ? [...summary, evidence] : decisionCard.why.slice(0, 3);
}

function buildMemoryCue(recallMatches: MemoryRecallItem[]) {
  const predictionReview = recallMatches.find((item) => typeof item.metadata.predictionId === "string");
  if (predictionReview) {
    return `Memory recall: prior prediction review ${String(predictionReview.metadata.predictionId)} should lower confidence until the newer evidence is verified.`;
  }

  const lesson = recallMatches.find((item) => item.kind === "lesson_learned");
  if (lesson) {
    return `Memory recall: ${lesson.text}`;
  }

  return null;
}

function buildRagCue(ragContext: RetrievedContext) {
  const topCitation = ragContext.citations[0];
  if (!topCitation) return null;
  const freshness = ragContext.sourceFreshness === "fresh"
    ? "fresh"
    : ragContext.sourceFreshness === "mixed"
      ? "mixed freshness"
      : "stale";
  const contradiction = ragContext.contradictionHints[0] ? ` Contradiction hint: ${ragContext.contradictionHints[0]}` : "";
  return `Retrieved evidence (${freshness}): ${topCitation.label}.${contradiction}`;
}

function strategyDecisionCard(
  investigation: Awaited<ReturnType<typeof marketMoveInvestigationService.investigate>>,
  strategy: StrategySuggestion | null,
): DecisionCard {
  const suggestion = strategy ?? fallbackStrategy(investigation);

  return {
    id: `decision-strategy-${randomUUID()}`,
    title: `${investigation.asset} Strategy Review`,
    asset: investigation.asset,
    situation: "MarketPilot converted the question into a paper-only strategy review with risk officer checks.",
    mainConclusion: suggestion.riskOfficerDecision === "approve"
      ? suggestion.possibleStrategy
      : `${suggestion.possibleStrategy}; risk officer says ${suggestion.riskOfficerDecision}.`,
    confidence: suggestion.confidence,
    suggestedAction: "Treat this as a paper-trade candidate only after confirmation; live execution is blocked.",
    riskLevel: suggestion.riskOfficerDecision === "reject" || suggestion.riskOfficerDecision === "require_more_research" ? "avoid" : "high",
    why: suggestion.whyItMightWork.slice(0, 4),
    whatCouldProveWrong: suggestion.whyItMightFail.slice(0, 4),
    learningNote: "A valid strategy includes entry, exit, stop, position size, invalidation, and a clear reason not to trade.",
    verificationStatus: investigation.decisionCard.verificationStatus,
    nextStep: suggestion.requiredConfirmation[0] ?? "Wait for confirmation before paper trading.",
    details: {
      facts: [
        `Entry: ${suggestion.entryLogic}`,
        `Exit: ${suggestion.exitLogic}`,
        `Stop: ${suggestion.stopLossLogic}`,
        `Position size: ${suggestion.positionSize}`,
      ],
      interpretations: [
        `Instrument: ${suggestion.bestInstrument}`,
        `Risk/reward: ${suggestion.riskReward}`,
        `Time horizon: ${suggestion.timeHorizon}`,
      ],
      contradictoryEvidence: suggestion.whyItMightFail,
      risks: [
        `Risk officer result: ${suggestion.riskOfficerDecision}`,
        "No live execution.",
        "Paper-trade suggestion only.",
        "Required confirmation: human approval.",
      ],
      verificationStatus: investigation.decisionCard.verificationStatus,
      advancedAnalytics: [
        ...suggestion.saferAlternatives.map((item) => `Alternative: ${item}`),
        `Why not to trade: ${suggestion.whyItMightFail[0] ?? "The thesis can be invalidated."}`,
      ],
    },
  };
}

function learningDecisionCard(
  classification: TradingAssistantIntentClassification,
  overview: MarketPilotOverview,
  prompt: string,
): DecisionCard {
  const topic = classification.domain === "credit" ? "credit scores" : classification.domain.replace("_", " ");
  const score = overview.proficiencyScores.find((item) => item.category === proficiencyCategoryFor(classification.domain))?.score ?? 50;

  return {
    id: `decision-lesson-${randomUUID()}`,
    title: `Learn ${titleCase(topic)}`,
    asset: classification.domain,
    situation: `MarketPilot turned "${prompt}" into a short lesson instead of an analytics report.`,
    mainConclusion: lessonSummary(classification.domain),
    confidence: Math.max(65, Math.min(90, score + 20)),
    suggestedAction: "Study the example, answer the mini quiz, then apply the lesson to one real decision.",
    riskLevel: "low",
    why: [
      `Current proficiency signal is ${score}/100.`,
      `The lesson is scoped to ${classification.domain}.`,
      mistakeToAvoid(classification.domain),
    ],
    whatCouldProveWrong: ["If your goal is an immediate trade, this should be reclassified as a strategy request."],
    learningNote: "Simple explanation, example, mistake, quiz, application, and next lesson are shown before deeper material.",
    verificationStatus: "partially_verified",
    nextStep: nextLesson(classification.domain),
    details: {
      facts: [lessonSummary(classification.domain), exampleFor(classification.domain)],
      interpretations: [realWorldApplication(classification.domain)],
      contradictoryEvidence: [mistakeToAvoid(classification.domain)],
      risks: ["Educational guidance only.", "Credit and loan topics are planning guidance, not trading signals."],
      verificationStatus: "partially_verified",
      advancedAnalytics: [
        `Mini quiz: ${miniQuiz(classification.domain)}`,
        `Next lesson: ${nextLesson(classification.domain)}`,
      ],
    },
  };
}

function portfolioDecisionCard(overview: MarketPilotOverview): DecisionCard {
  const largest = largestRiskContributor(overview);

  return {
    id: `decision-portfolio-${randomUUID()}`,
    title: "Portfolio Risk Coach",
    asset: overview.portfolio.name,
    situation: "MarketPilot reviewed allocation, concentration, cash, and current risk score.",
    mainConclusion: `${largest.symbol} is the biggest risk contributor at ${largest.riskContribution.toFixed(1)}%.`,
    confidence: 82,
    suggestedAction: "Review allocation drift and avoid adding correlated exposure until risk is checked.",
    riskLevel: overview.portfolio.riskScore >= 65 ? "high" : "medium",
    why: [
      `Risk score is ${overview.portfolio.riskScore}/100.`,
      `Cash is $${overview.portfolio.cash.toLocaleString()}.`,
      `${largest.symbol} allocation is ${largest.allocation.toFixed(1)}%.`,
    ],
    whatCouldProveWrong: ["Updated holdings or cash balances materially change the risk contribution ranking."],
    learningNote: "Portfolio coaching starts with the single largest risk before factor, correlation, or Monte Carlo analytics.",
    verificationStatus: "partially_verified",
    nextStep: "Make one improvement: reduce drift, add cash, or avoid new correlated risk.",
    details: {
      facts: overview.portfolio.holdings.map((holding) => `${holding.symbol}: ${holding.allocation.toFixed(1)}% allocation.`),
      interpretations: ["Concentrated risk should be addressed before adding new trades."],
      contradictoryEvidence: ["Cash, hedges, or external holdings not represented here could change the ranking."],
      risks: overview.riskRules.map((rule) => rule.description),
      verificationStatus: "partially_verified",
      advancedAnalytics: ["Correlation, factor exposure, Monte Carlo, Greeks, and stress tests remain available in System details."],
    },
  };
}

function opportunityDecisionCard(classification: TradingAssistantIntentClassification, overview: MarketPilotOverview): DecisionCard {
  const largest = largestRiskContributor(overview);

  return {
    id: `decision-opportunity-${randomUUID()}`,
    title: "Opportunity Scan",
    asset: classification.domain,
    situation: "MarketPilot ranked possible actions into focused decision categories instead of showing a dense signal table.",
    mainConclusion: overview.tradeTickets.length > 0
      ? "Best first step is to review the highest-confidence paper idea and its risk warning."
      : "No high-conviction trade should be forced from the current evidence.",
    confidence: 76,
    suggestedAction: "Use the Opportunities screen categories: High conviction, Watchlist, Risk warning, Learning opportunity, Avoid trade.",
    riskLevel: overview.portfolio.riskScore >= 70 ? "high" : "medium",
    why: [
      `${largest.symbol} is the largest current risk contributor.`,
      `${overview.researchReports.length} research items are available for ranking.`,
      `${overview.tradeTickets.length} paper ideas are available for risk screening.`,
    ],
    whatCouldProveWrong: ["Fresh market data or stronger verification could change the ranking."],
    learningNote: "A scan is useful only when it also highlights what to avoid and what to learn.",
    verificationStatus: "partially_verified",
    nextStep: "Open Opportunities and start with the top 3-5 decision cards.",
    details: {
      facts: overview.researchReports.slice(0, 5).map((report) => report.mainCause),
      interpretations: ["Rank by confidence, actionability, risk severity, exposure, and learning value."],
      contradictoryEvidence: ["Low-confidence signals are collapsed behind advanced details."],
      risks: overview.riskRules.map((rule) => rule.description),
      verificationStatus: "partially_verified",
      advancedAnalytics: ["Raw analytics remain available only after expansion."],
    },
  };
}

function riskWarningDecisionCard(
  classification: TradingAssistantIntentClassification,
  overview: MarketPilotOverview,
  investigation: Awaited<ReturnType<typeof marketMoveInvestigationService.investigate>>,
): DecisionCard {
  const largest = largestRiskContributor(overview);

  return {
    id: `decision-risk-${randomUUID()}`,
    title: "Risk Warning",
    asset: classification.assetCandidates[0] ?? largest.symbol,
    situation: "MarketPilot looked for the largest reason to slow down before considering action.",
    mainConclusion: `${largest.symbol} concentration and unresolved contradictory evidence are the key risks to review first.`,
    confidence: 84,
    suggestedAction: "Avoid adding exposure until the risk warning is resolved or explicitly accepted in the journal.",
    riskLevel: "high",
    why: [
      `${largest.symbol} contributes ${largest.riskContribution.toFixed(1)}% of portfolio risk.`,
      ...investigation.contradictoryEvidence.slice(0, 2),
    ],
    whatCouldProveWrong: ["Updated portfolio data or new hedges could lower the effective risk."],
    learningNote: "Risk warnings should change sizing, timing, or the decision to avoid a trade.",
    verificationStatus: investigation.decisionCard.verificationStatus,
    nextStep: "Review the risk officer result and write the invalidation rule before any paper action.",
    details: {
      facts: investigation.facts,
      interpretations: investigation.interpretations,
      contradictoryEvidence: investigation.contradictoryEvidence,
      risks: overview.riskRules.map((rule) => rule.description),
      verificationStatus: investigation.decisionCard.verificationStatus,
      advancedAnalytics: investigation.decisionCard.details.advancedAnalytics,
    },
  };
}

function buildSignals({
  overview,
  investigation,
  strategy,
  prompt,
  classification,
  decisionCard,
}: {
  overview: MarketPilotOverview;
  investigation: Awaited<ReturnType<typeof marketMoveInvestigationService.investigate>>;
  strategy: StrategySuggestion | null;
  prompt: string;
  classification: TradingAssistantIntentClassification;
  decisionCard: DecisionCard;
}): SignalPriorityInput[] {
  const largest = largestRiskContributor(overview);
  const riskSeverity = strategy?.riskOfficerDecision === "approve" ? 45 : 85;

  return [
    {
      id: "primary-decision",
      title: decisionCard.title,
      category: classification.intent === "learning_request" ? "learning" : "explanation",
      summary: decisionCard.mainConclusion,
      relevanceToGoal: 96,
      marketImpact: classification.intent === "learning_request" || classification.intent === "credit_or_loan_question" ? 25 : 72,
      confidence: decisionCard.confidence,
      freshness: 72,
      portfolioExposure: exposureFor(overview, investigation.asset),
      riskSeverity: decisionCard.riskLevel === "high" || decisionCard.riskLevel === "avoid" ? 82 : 45,
      learningValue: 85,
      actionability: 78,
      details: decisionCard.why,
    },
    {
      id: "risk-officer",
      title: "Risk Officer Result",
      category: "risk_warning",
      summary: strategy ? `Risk officer decision: ${strategy.riskOfficerDecision}.` : "No trade action approved.",
      relevanceToGoal: classification.intent === "strategy_request" ? 96 : 72,
      marketImpact: 62,
      confidence: 86,
      freshness: 80,
      portfolioExposure: exposureFor(overview, investigation.asset),
      riskSeverity,
      learningValue: 70,
      actionability: 88,
      details: strategy?.whyItMightFail ?? ["Live execution remains blocked."],
    },
    {
      id: "portfolio-risk",
      title: "Portfolio Risk Focus",
      category: "critical",
      summary: `${largest.symbol} is the largest risk contributor at ${largest.riskContribution.toFixed(1)}%.`,
      relevanceToGoal: /\bportfolio|risk|allocation\b/i.test(prompt) ? 98 : 68,
      marketImpact: 58,
      confidence: 82,
      freshness: 72,
      portfolioExposure: largest.allocation,
      riskSeverity: overview.portfolio.riskScore,
      learningValue: 76,
      actionability: 74,
      details: overview.riskRules.map((rule) => rule.description),
    },
    {
      id: "learning-note",
      title: "Learning Task",
      category: "learning",
      summary: decisionCard.learningNote,
      relevanceToGoal: classification.intent === "learning_request" || classification.intent === "credit_or_loan_question" ? 98 : 70,
      marketImpact: 35,
      confidence: 80,
      freshness: 65,
      portfolioExposure: 0,
      riskSeverity: 20,
      learningValue: 95,
      actionability: 70,
      details: ["Mini quiz and mistake review should follow the decision."],
    },
  ];
}

function shouldBuildStrategy(intent: TradingAssistantResponse["intent"]) {
  return intent === "strategy_request" || intent === "opportunity_scan";
}

function fallbackAsset(classification: TradingAssistantIntentClassification) {
  if (classification.domain === "crypto") return "BTC";
  if (classification.domain === "forex") return "EURUSD";
  if (classification.domain === "stocks") return "MSFT";
  return "SPY";
}

function exposureFor(overview: MarketPilotOverview, asset: string) {
  return overview.portfolio.holdings.find((holding) => holding.symbol.toUpperCase() === asset.toUpperCase())?.allocation ?? 0;
}

function largestRiskContributor(overview: MarketPilotOverview) {
  return overview.portfolio.holdings.reduce((max, holding) =>
    holding.riskContribution > max.riskContribution ? holding : max,
  overview.portfolio.holdings[0]);
}

function toExplanation(investigation: Awaited<ReturnType<typeof marketMoveInvestigationService.investigate>>): MarketMovementExplanation {
  return {
    symbol: investigation.asset,
    primaryCause: investigation.mainCause,
    mainCause: investigation.mainCause,
    secondaryCauses: investigation.interpretations,
    facts: investigation.facts,
    interpretations: investigation.interpretations,
    predictions: investigation.tradeImplications,
    evidence: investigation.supportingEvidence,
    confidence: investigation.confidence,
    contradictoryEvidence: investigation.contradictoryEvidence,
    whatWouldInvalidate: investigation.whatWouldDisprove,
    whatCouldReverse: investigation.whatWouldDisprove,
    affectedAssets: [investigation.asset],
    relatedAssets: [investigation.asset],
    riskFactors: investigation.decisionCard.details.risks,
    whatWouldStrengthen: investigation.whatWouldConfirm,
    whatWouldWeaken: investigation.decisionCard.whatCouldProveWrong,
    alternativeExplanations: investigation.contradictoryEvidence,
    consensusScore: investigation.confidence,
    agentAgreementScore: Math.max(0, investigation.confidence - 8),
    historicalAnalogues: [],
    pastSimilarEvents: [],
    scenarioProbabilities: [],
    sourceTimestamps: [],
    verification: {
      id: `assistant-verification-${randomUUID()}`,
      status: investigation.decisionCard.verificationStatus,
      confidence: investigation.confidence,
      evidenceSummary: investigation.supportingEvidence.join(" "),
      contradictoryEvidence: investigation.contradictoryEvidence,
      whatWouldDisprove: investigation.whatWouldDisprove,
      sources: [],
    },
  };
}

function fallbackStrategy(investigation: Awaited<ReturnType<typeof marketMoveInvestigationService.investigate>>): StrategySuggestion {
  return strategySuggestionService.suggest({
    prompt: "Avoid trade or wait for confirmation",
    explanation: toExplanation(investigation),
    overview: {
      user: { id: "fallback", name: "Fallback", liveTradingEnabled: false, paperTradingEnabled: true },
      progression: {
        currentStage: "foundation",
        stageLabel: "Foundation",
        nextStage: null,
        paperTradingUnlock: "available",
        liveTradingUnlock: "locked",
        requirementsToAdvance: [],
        blockedBy: [],
      },
      proficiencyScores: [],
      modules: [],
      researchReports: [],
      riskRules: [],
      riskSettings: {
        id: "fallback",
        maxRiskPerTradePct: 1,
        reduceSizeAbovePct: 0.5,
        maxDailyLossPct: 2,
        maxWeeklyLossPct: 4,
        maxSinglePositionPct: 15,
        maxOptionsPremiumPct: 1,
        noTradeBeforeHighImpactEventHours: 24,
        updatedAt: new Date().toISOString(),
      },
      complianceProfile: {
        id: "fallback",
        disclosuresAccepted: false,
        disclosureVersion: "marketpilot-risk-v1",
        acceptedAt: null,
        userConfirmation: null,
        requiredDisclosures: ["Live execution remains blocked."],
        updatedAt: new Date().toISOString(),
      },
      portfolio: {
        id: "fallback",
        name: "Fallback",
        totalValue: 0,
        cash: 0,
        ytdReturnPct: 0,
        maxDrawdownPct: 0,
        riskScore: 0,
        holdings: [],
      },
      tradeTickets: [],
      journalEntries: [],
      auditLogs: [],
    },
  });
}

function proficiencyCategoryFor(domain: TradingAssistantIntentClassification["domain"]) {
  if (domain === "credit" || domain === "loans") return "market_basics";
  if (domain === "portfolio") return "portfolio_construction";
  if (domain === "interest_rates" || domain === "macroeconomics") return "macroeconomics";
  if (domain === "risk_management") return "risk_management";
  if (domain === "trading_psychology") return "trading_psychology";
  return domain === "crypto" || domain === "commodities" ? "market_basics" : domain;
}

function lessonSummary(domain: TradingAssistantIntentClassification["domain"]) {
  if (domain === "credit") return "Credit scores mostly measure payment history, debt utilization, credit age, account mix, and recent hard inquiries.";
  if (domain === "forex") return "Forex moves come from interest-rate expectations, relative growth, positioning, and risk sentiment.";
  if (domain === "options") return "Options require understanding max loss, breakeven, time decay, implied volatility, and assignment risk.";
  return "Start with the core driver, then ask what evidence would confirm or disprove it.";
}

function exampleFor(domain: TradingAssistantIntentClassification["domain"]) {
  if (domain === "credit") return "Example: lowering card utilization from 80% to below 30% can help because utilization is a major scoring input.";
  if (domain === "forex") return "Example: EUR/USD can rise when euro-area rate expectations improve relative to U.S. expectations.";
  return "Example: a stock drop after earnings may be about guidance, not the headline EPS number.";
}

function mistakeToAvoid(domain: TradingAssistantIntentClassification["domain"]) {
  if (domain === "credit") return "Mistake to avoid: closing old accounts without checking how it affects credit age and utilization.";
  if (domain === "options") return "Mistake to avoid: buying options without knowing breakeven and max loss.";
  return "Mistake to avoid: treating a plausible story as proof without contradictory evidence.";
}

function miniQuiz(domain: TradingAssistantIntentClassification["domain"]) {
  if (domain === "credit") return "Which is usually better for utilization: 85% card usage or 25% card usage?";
  if (domain === "forex") return "If U.S. rate expectations rise faster than Europe, what usually pressures EUR/USD?";
  return "What single observation would prove the thesis wrong?";
}

function realWorldApplication(domain: TradingAssistantIntentClassification["domain"]) {
  if (domain === "credit") return "Before applying for a loan, check utilization, payment history, and recent inquiries.";
  if (domain === "portfolio") return "Before adding a position, check whether it increases your largest existing risk.";
  return "Before trading, write the catalyst, confirmation signal, stop logic, and invalidation rule.";
}

function nextLesson(domain: TradingAssistantIntentClassification["domain"]) {
  if (domain === "credit") return "Next lesson: utilization, payment history, and loan approval tradeoffs.";
  if (domain === "forex") return "Next lesson: interest-rate differentials and central-bank expectations.";
  if (domain === "options") return "Next lesson: defined-risk spreads and breakeven math.";
  return "Next lesson: confirmation signals and invalidation rules.";
}

function titleFromMemoryRecord(record: MemoryRecord) {
  if (record.kind === "lesson_learned") return "Prior lesson learned";
  if (record.kind === "trade_journal") return "Prior trade journal";
  if (record.kind === "research_report") return "Prior research report";
  if (record.kind === "market_explanation") return "Prior market explanation";
  if (record.kind === "agent_decision") return "Prior agent decision";
  return "Related memory";
}

function lessonFromMemoryRecord(record: MemoryRecord) {
  if (record.kind === "lesson_learned") return record.text;
  if (record.kind === "trade_journal") return record.text;
  if (record.kind === "research_report") return "Use the same evidence discipline: summarize the main cause, contradictions, and risk factors.";
  if (record.kind === "market_explanation") return "Separate the main cause from secondary causes before turning the move into a trade idea.";
  return "Check whether the prior decision changed after new evidence arrived.";
}

function similarityReason(
  record: MemoryRecord,
  prompt: string,
  classification: TradingAssistantIntentClassification,
  overview: MarketPilotOverview,
) {
  const cues: string[] = [];
  if (record.tags.includes(classification.domain)) cues.push(`matches the ${classification.domain} domain`);
  if (classification.assetCandidates.some((asset) => record.tags.includes(asset) || record.text.includes(asset))) cues.push("mentions a related asset");
  if (record.text.toLowerCase().includes(prompt.split(/\s+/)[0]?.toLowerCase() ?? "")) cues.push("shares wording with the current question");
  if (overview.tradeTickets.length > 0 && record.kind === "trade_journal") cues.push("reflects a prior trade review");
  if (cues.length === 0) cues.push("is one of the closest stored memories available");
  return cues.join("; ");
}

function confidenceFromMemoryRecord(record: MemoryRecord, index: number) {
  const base = record.kind === "lesson_learned" ? 78 : record.kind === "trade_journal" ? 74 : 70;
  return Math.max(55, Math.min(92, base - index * 6 + Math.min(10, record.tags.length * 2)));
}

function dedupeMemoryRecords(records: MemoryRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  });
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
