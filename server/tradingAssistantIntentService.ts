import type { AssistantDomain, TradingAssistantIntent } from "@shared/schema";

export type TradingAssistantIntentClassification = {
  intent: TradingAssistantIntent;
  domain: AssistantDomain;
  assetCandidates: string[];
  confidence: number;
  requiredData: string[];
  safetyConstraints: string[];
};

export class TradingAssistantIntentService {
  classify(prompt: string): TradingAssistantIntentClassification {
    const normalized = prompt.trim();
    const intent = detectIntent(normalized);
    const domain = detectDomain(normalized, intent);
    const assetCandidates = detectAssetCandidates(normalized, intent);

    return {
      intent,
      domain,
      assetCandidates,
      confidence: confidenceFor(normalized, intent, assetCandidates),
      requiredData: requiredDataFor(intent, domain),
      safetyConstraints: safetyConstraintsFor(intent),
    };
  }
}

export const tradingAssistantIntentService = new TradingAssistantIntentService();

function detectIntent(prompt: string): TradingAssistantIntent {
  if (/\b(credit score|credit scores|loan|mortgage|refinance|debt|apr|fico)\b/i.test(prompt)) return "credit_or_loan_question";
  if (/\b(teach|learn|lesson|explain|what is|how do|beginner)\b/i.test(prompt)) return "learning_request";
  if (/\b(portfolio|allocation|rebalance|exposure|diversif|risk review)\b/i.test(prompt)) return "portfolio_review";
  if (/\b(risk|danger|warning|avoid|too risky|red flag)\b/i.test(prompt)) return "risk_warning";
  if (/\b(find|scan|setup|opportunit|watchlist)\b/i.test(prompt)) return "opportunity_scan";
  if (/\b(short|buy|sell|trade|strategy|put|call|spread|entry|exit)\b/i.test(prompt)) return "strategy_request";
  if (/\b(why|drop|fall|fell|rally|move|impact|happened|down|up)\b/i.test(prompt)) return "market_move_explanation";
  return "general_finance_question";
}

function detectDomain(prompt: string, intent: TradingAssistantIntent): AssistantDomain {
  if (intent === "portfolio_review") return "portfolio";
  if (intent === "credit_or_loan_question") return /\bcredit|fico\b/i.test(prompt) ? "credit" : "loans";
  if (/\bforex|eur|usd|jpy|gbp|fx\b/i.test(prompt)) return "forex";
  if (/\boption|put|call|spread\b/i.test(prompt)) return "options";
  if (/\bcrypto|bitcoin|btc|eth|solana|sol\b/i.test(prompt)) return "crypto";
  if (/\bbond|treasury|yield|rates|fed|cpi|inflation\b/i.test(prompt)) return "interest_rates";
  if (/\boil|gold|commodity|commodities\b/i.test(prompt)) return "commodities";
  if (/\betf|spy|qqq|vti|index fund\b/i.test(prompt)) return "etfs";
  if (/\bpsychology|discipline|emotion\b/i.test(prompt)) return "trading_psychology";
  if (/\brisk\b/i.test(prompt)) return "risk_management";
  if (/\bmacro|economy|recession\b/i.test(prompt)) return "macroeconomics";
  return "stocks";
}

function detectAssetCandidates(prompt: string, intent: TradingAssistantIntent) {
  if (intent === "portfolio_review" || intent === "credit_or_loan_question" || intent === "learning_request") return [];

  const upper = prompt.toUpperCase();
  const mapped = [
    [/MICROSOFT|MSFT/, "MSFT"],
    [/BOEING|BA\b/, "BA"],
    [/EUR\/?USD/, "EURUSD"],
    [/BITCOIN|BTC/, "BTC"],
    [/ETHEREUM|ETH/, "ETH"],
    [/FED|RATES|MARKET/, "SPY"],
  ].flatMap(([pattern, symbol]) => pattern instanceof RegExp && pattern.test(upper) ? [symbol as string] : []);

  const tickers = upper.match(/\b[A-Z]{2,5}\b/g) ?? [];
  return Array.from(new Set([...mapped, ...tickers])).slice(0, 4);
}

function confidenceFor(prompt: string, intent: TradingAssistantIntent, assetCandidates: string[]) {
  const explicitIntent = intent !== "general_finance_question" ? 32 : 10;
  const assetBoost = assetCandidates.length > 0 ? 20 : 0;
  const lengthBoost = prompt.length > 18 ? 18 : 8;
  return Math.min(95, 40 + explicitIntent + assetBoost + lengthBoost);
}

function requiredDataFor(intent: TradingAssistantIntent, domain: AssistantDomain) {
  if (intent === "market_move_explanation") return ["recent price move", "news/catalysts", "verification evidence", "contradictory evidence"];
  if (intent === "strategy_request") return ["market explanation", "entry/exit thesis", "risk settings", "portfolio exposure", "risk officer decision"];
  if (intent === "portfolio_review") return ["holdings", "allocation", "risk contribution", "cash", "risk rules"];
  if (intent === "learning_request" || intent === "credit_or_loan_question") return ["proficiency graph", "learning modules", `${domain} basics`];
  if (intent === "opportunity_scan") return ["ranked signals", "verification status", "risk severity", "learning value"];
  if (intent === "risk_warning") return ["risk rules", "contradictory evidence", "portfolio exposure"];
  return ["verified context", "risk constraints", "learning context"];
}

function safetyConstraintsFor(intent: TradingAssistantIntent) {
  const base = [
    "No live trading or autonomous execution.",
    "Human confirmation is required before any paper-trade action.",
    "Advanced analytics stay behind drill-down details.",
  ];

  if (intent === "strategy_request" || intent === "opportunity_scan") {
    return [...base, "Every trade idea must include why not to trade and an avoid/wait option."];
  }

  return base;
}
