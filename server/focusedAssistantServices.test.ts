import assert from "node:assert/strict";
import {
  decisionCardSchema,
  marketMoveInvestigationSchema,
  predictionReviewSchema,
  prioritizedSignalSchema,
  strategySuggestionSchema,
  tradingAssistantResponseSchema,
  type MarketPilotOverview,
} from "@shared/schema";
import { informationRelevanceFilter } from "./informationRelevanceFilter";
import { marketMoveInvestigationService } from "./marketMoveInvestigationService";
import { predictionReviewService } from "./predictionReviewService";
import { signalPriorityService } from "./signalPriorityService";
import { strategySuggestionService } from "./strategySuggestionService";
import { storage } from "./storage";
import { tradingAssistantIntentService } from "./tradingAssistantIntentService";
import { tradingAssistantService } from "./tradingAssistantService";

const ranked = signalPriorityService.rank([
  {
    id: "critical-risk",
    title: "Critical risk",
    category: "risk_warning",
    summary: "Portfolio risk is elevated.",
    relevanceToGoal: 90,
    marketImpact: 80,
    confidence: 88,
    freshness: 80,
    portfolioExposure: 80,
    riskSeverity: 92,
    learningValue: 70,
    actionability: 85,
    details: [],
  },
  {
    id: "raw-analytics",
    title: "Low-value analytics",
    category: "analytics",
    summary: "Deep metric with little current relevance.",
    relevanceToGoal: 15,
    marketImpact: 20,
    confidence: 50,
    freshness: 30,
    portfolioExposure: 0,
    riskSeverity: 10,
    learningValue: 20,
    actionability: 10,
    details: [],
  },
]);

assert.equal(ranked[0].id, "critical-risk");
assert.equal(ranked[0].displayTier, "primary");
assert.equal(ranked[1].displayTier, "hidden");
prioritizedSignalSchema.parse(ranked[0]);
assert.equal(informationRelevanceFilter.primary(ranked).length, 1);
assert.equal(informationRelevanceFilter.visible(ranked).length, 1);
const primaryView = informationRelevanceFilter.selectForPrimaryView(ranked);
assert.ok(primaryView.length >= 1 && primaryView.length <= 5);
assert.equal(primaryView.some((signal) => signal.displayTier === "hidden"), false);
assert.equal(primaryView[0].id, "critical-risk");

const overview = await storage.getMarketPilotOverview();
const intent = tradingAssistantIntentService.classify("Should I short Boeing?");
assert.equal(intent.intent, "strategy_request");
assert.equal(intent.domain, "stocks");
assert.ok(intent.assetCandidates.includes("BA"));
assert.ok(intent.requiredData.includes("risk officer decision"));
assert.ok(intent.safetyConstraints.some((item) => /No live trading/.test(item)));

const investigation = await marketMoveInvestigationService.investigate("MSFT");
marketMoveInvestigationSchema.parse(investigation);
decisionCardSchema.parse(investigation.decisionCard);
assert.ok(investigation.decisionCard.why.length <= 4);
assert.ok(investigation.decisionCard.details.advancedAnalytics.length > 0);
assert.ok(investigation.decisionCard.learningNote.length > 0);

const strategy = strategySuggestionService.suggest({
  prompt: "Should I short Boeing after this news?",
  explanation: await import("./researchService").then(({ researchService }) => researchService.explainMove("BA")),
  overview: overview as MarketPilotOverview,
});
strategySuggestionSchema.parse(strategy);
assert.ok(strategy.whyItMightFail.length > 0);
assert.ok(strategy.saferAlternatives.some((item) => /Avoid|Wait|smaller|ETF/i.test(item)));
assert.notEqual(strategy.riskOfficerDecision, "approve");

const assistant = await tradingAssistantService.respond({ prompt: "Should I short Boeing?" }, overview);
tradingAssistantResponseSchema.parse(assistant);
assert.equal(assistant.intent, "strategy_request");
assert.equal(assistant.intentClassification.intent, "strategy_request");
assert.ok(assistant.strategyOptions.length >= 1);
assert.ok(/Entry:/.test(assistant.decisionCard.details.facts[0]));
assert.ok(assistant.decisionCard.details.risks.some((item) => /No live execution/.test(item)));
assert.ok(assistant.riskCheck.reasons.some((reason) => /Live execution remains blocked/.test(reason)));
assert.ok(assistant.signals.filter((signal) => signal.displayTier === "primary").length <= 5);

const move = await tradingAssistantService.respond({ prompt: "Why did Microsoft drop?" }, overview);
tradingAssistantResponseSchema.parse(move);
assert.equal(move.intent, "market_move_explanation");
assert.equal(move.decisionCard.asset, "MSFT");
assert.equal(move.strategyOptions.length, 0);
assert.ok(move.decisionCard.details.advancedAnalytics.some((item) => /Trade\/investment implication/.test(item)));

const lesson = await tradingAssistantService.respond({ prompt: "Teach me credit scores" }, overview);
tradingAssistantResponseSchema.parse(lesson);
assert.equal(lesson.intent, "credit_or_loan_question");
assert.equal(lesson.domain, "credit");
assert.equal(lesson.strategyOptions.length, 0);
assert.ok(lesson.decisionCard.details.advancedAnalytics.some((item) => /Mini quiz/.test(item)));

const portfolio = await tradingAssistantService.respond({ prompt: "Review my portfolio risk" }, overview);
tradingAssistantResponseSchema.parse(portfolio);
assert.equal(portfolio.intent, "portfolio_review");
assert.equal(portfolio.domain, "portfolio");
assert.ok(portfolio.decisionCard.details.advancedAnalytics.length > 0);
assert.ok(portfolio.signals.length <= 4);

const scan = await tradingAssistantService.respond({ prompt: "Find forex setups" }, overview);
tradingAssistantResponseSchema.parse(scan);
assert.equal(scan.intent, "opportunity_scan");
assert.equal(scan.domain, "forex");
assert.ok(scan.signals.filter((signal) => signal.displayTier !== "hidden").length <= 5);

const review = predictionReviewService.review({
  predictionId: assistant.predictionTrackingId,
  actualOutcome: "The thesis was wrong and the move reversed.",
  missingEvidence: ["Sector flow contradicted the headline thesis"],
});
predictionReviewSchema.parse(review);
assert.equal(review.shouldConfidenceModelChange, true);
assert.equal(review.shouldStrategyBeDowngraded, true);
assert.ok(review.feeds.knowledgeGraph.length > 0);

console.log("focused assistant service tests passed");
