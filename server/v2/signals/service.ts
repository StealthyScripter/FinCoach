import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { SignalRequest, V2ResearchSignal } from "./contracts";
import { SignalsV2EventTypes } from "./events";
import { InMemorySignalRepository } from "./repository";

export class SignalsV2Service {
  constructor(private readonly repository = new InMemorySignalRepository()) {}
  publish(request: SignalRequest): { signal: V2ResearchSignal | null; events: DomainEvent[] } {
    const rejected = validate(request);
    if (rejected) return { signal: null, events: [createDomainEvent({ eventType: SignalsV2EventTypes.SignalRejected, sourceModule: "signals", correlationId: request.correlationId, causationId: request.causationId, payload: { reason: rejected } })] };
    const signalId = createHash("sha256").update(JSON.stringify({ symbol: request.symbol, side: request.side, entry: request.entryPrice, sl: request.stopLoss, tp: request.takeProfit, strategy: request.strategyId, forward: request.forwardTestId })).digest("hex").slice(0, 32);
    const signal: V2ResearchSignal = { ...request, schema: "fincoach.signal.v2", signalId, createdAt: request.createdAt ?? new Date().toISOString() };
    const saved = this.repository.save(signal);
    return { signal: saved.signal, events: [createDomainEvent({ eventType: saved.inserted ? SignalsV2EventTypes.SignalPublished : SignalsV2EventTypes.SignalDuplicateSuppressed, sourceModule: "signals", correlationId: request.correlationId, causationId: request.causationId, payload: { signalId } })] };
  }
  get(id: string) { return this.repository.get(id); }
  list() { return this.repository.list(); }
}
function validate(r: SignalRequest): string | null {
  if (!r.demoOnly) return "demo_only_required";
  if (r.killSwitchActive) return "kill_switch_active";
  if (!r.marketSnapshotFresh) return "stale_market_snapshot";
  if (r.forwardTestStatus !== "monitoring") return "forward_test_not_monitoring";
  if (!r.lineageEventIds.length) return "missing_lineage";
  if (![r.entryPrice, r.stopLoss, r.takeProfit, r.confidence, r.evidenceScore].every(Number.isFinite)) return "malformed_prices_or_scores";
  if (r.entryPrice <= 0 || r.stopLoss <= 0 || r.takeProfit <= 0) return "invalid_prices";
  if (r.side === "buy" && !(r.stopLoss < r.entryPrice && r.takeProfit > r.entryPrice)) return "invalid_buy_risk_reward";
  if (r.side === "sell" && !(r.stopLoss > r.entryPrice && r.takeProfit < r.entryPrice)) return "invalid_sell_risk_reward";
  if (r.confidence < 0 || r.confidence > 1 || r.evidenceScore < 0 || r.evidenceScore > 1) return "score_out_of_bounds";
  if (Date.parse(r.validUntil) <= Date.parse(r.createdAt ?? new Date().toISOString())) return "expired_signal";
  return null;
}
export const signalsV2Service = new SignalsV2Service();
