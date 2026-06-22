import { randomUUID } from "crypto";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";

export type StrategyAdaptationType =
  | "tighten_stop"
  | "widen_stop"
  | "reduce_size"
  | "avoid_session"
  | "avoid_symbol"
  | "require_confirmation"
  | "downgrade_strategy"
  | "pause_strategy"
  | "improve_entry_rule";

export type StrategyAdaptationSuggestion = {
  id: string;
  strategyId: string;
  type: StrategyAdaptationType;
  reason: string;
  evidence: string[];
  status: "pending_human_approval" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  automaticallyApplied: false;
};

export class StrategyAdaptationService {
  private suggestions = new Map<string, StrategyAdaptationSuggestion>();

  constructor(private readonly audit: ExecutionAuditLog = executionAuditLog) {}

  generate(input: {
    strategyId: string;
    result: "win" | "loss" | "breakeven";
    exitReason: string;
    missedEvidence: string[];
    riskTaken: number;
    realizedPnL: number;
    symbol: string;
    session?: string;
  }) {
    const candidates: Array<{ type: StrategyAdaptationType; reason: string }> = [];
    if (input.exitReason === "stop_loss" && input.result === "loss") candidates.push({ type: "reduce_size", reason: "A stop-loss exit produced a realized loss." });
    if (input.exitReason === "stop_loss" && input.missedEvidence.some((item) => /noise|volatility|wick/i.test(item))) {
      candidates.push({ type: "widen_stop", reason: "Review whether normal volatility invalidated an overly tight stop." });
    }
    if (input.exitReason === "trailing_stop" && input.realizedPnL > 0) candidates.push({ type: "tighten_stop", reason: "The trailing stop protected a profitable move." });
    if (input.missedEvidence.length) candidates.push({ type: "improve_entry_rule", reason: "Entry review identified evidence that was available but omitted." });
    if (input.riskTaken > Math.max(1, Math.abs(input.realizedPnL) * 3)) candidates.push({ type: "reduce_size", reason: "Risk taken was high relative to the realized outcome." });
    if (input.result === "loss") candidates.push({ type: "require_confirmation", reason: "Require human confirmation while this loss pattern is reviewed." });
    if (input.result === "loss" && input.missedEvidence.length >= 2) candidates.push({ type: "downgrade_strategy", reason: "Multiple missing evidence items weaken current strategy validation." });
    if (input.result === "loss" && input.realizedPnL < -Math.abs(input.riskTaken) * 0.9) candidates.push({ type: "pause_strategy", reason: "Pause the strategy for human review after a near-full-risk loss." });
    if (input.missedEvidence.some((item) => /session|liquidity/i.test(item))) candidates.push({ type: "avoid_session", reason: `Avoid the reviewed session until evidence improves.` });
    if (input.missedEvidence.some((item) => /symbol|instrument/i.test(item))) candidates.push({ type: "avoid_symbol", reason: `Review ${input.symbol} suitability before another entry.` });
    const unique = new Map(candidates.map((candidate) => [candidate.type, candidate]));
    const saved = Array.from(unique.values()).map((candidate) => {
      const suggestion: StrategyAdaptationSuggestion = {
        id: randomUUID(),
        strategyId: input.strategyId,
        type: candidate.type,
        reason: candidate.reason,
        evidence: [...input.missedEvidence],
        status: "pending_human_approval",
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        reviewedBy: null,
        automaticallyApplied: false,
      };
      this.suggestions.set(suggestion.id, suggestion);
      this.audit.append({
        action: "strategy.adaptation.suggested",
        outcome: "created",
        correlationId: suggestion.id,
        detail: { strategyId: input.strategyId, type: suggestion.type, automaticallyApplied: false },
      });
      return { ...suggestion, evidence: [...suggestion.evidence] };
    });
    return saved;
  }

  review(id: string, decision: "approved" | "rejected", reviewedBy: string, now = new Date()) {
    const suggestion = this.suggestions.get(id);
    if (!suggestion) throw new Error("Strategy adaptation suggestion not found");
    suggestion.status = decision;
    suggestion.reviewedAt = now.toISOString();
    suggestion.reviewedBy = reviewedBy;
    this.audit.append({
      action: "strategy.adaptation.reviewed",
      outcome: decision === "approved" ? "accepted" : "rejected",
      correlationId: id,
      detail: { strategyId: suggestion.strategyId, type: suggestion.type, reviewedBy, automaticallyApplied: false },
    });
    return { ...suggestion, evidence: [...suggestion.evidence] };
  }

  list(strategyId?: string) {
    return Array.from(this.suggestions.values())
      .filter((suggestion) => !strategyId || suggestion.strategyId === strategyId)
      .map((suggestion) => ({ ...suggestion, evidence: [...suggestion.evidence] }));
  }
}

export const strategyAdaptationService = new StrategyAdaptationService();
