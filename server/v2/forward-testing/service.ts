import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { ForwardTestRecord, ForwardTestRequest } from "./contracts";
import { ForwardTestingV2EventTypes } from "./events";
import { InMemoryForwardTestingRepository } from "./repository";

export class ForwardTestingV2Service {
  constructor(private readonly repository = new InMemoryForwardTestingRepository()) {}
  create(request: ForwardTestRequest): { record: ForwardTestRecord | null; events: DomainEvent[] } {
    const blocked = validate(request);
    if (blocked) return { record: null, events: [createDomainEvent({ eventType: blocked.eventType, sourceModule: "forward-testing", correlationId: request.correlationId, causationId: request.causationId, payload: { reason: blocked.reason } })] };
    const forwardTestId = createHash("sha256").update(JSON.stringify({ s: request.strategy.strategyId, v: request.strategy.strategyVersion, c: request.courtCaseId, snap: request.snapshot.snapshotId })).digest("hex").slice(0, 32);
    const record: ForwardTestRecord = { forwardTestId, schemaVersion: "fincoach.v2.forward-test.1", strategyId: request.strategy.strategyId, strategyVersion: request.strategy.strategyVersion, courtCaseId: request.courtCaseId, rankingId: request.rankingId, status: "monitoring", demoVerification: request.demoVerification, snapshot: request.snapshot, ruleEvaluation: { entryConditions: request.strategy.entryConditions.length, filters: request.strategy.filters.length }, reason: request.reason, counterargument: request.counterargument, expectedR: request.expectedR, risk: request.risk, createdAt: request.demoVerification.verifiedAt, lineageEventIds: request.lineageEventIds, correlationId: request.correlationId, causationId: request.causationId };
    const saved = this.repository.save(record);
    return { record: saved, events: [createDomainEvent({ eventType: ForwardTestingV2EventTypes.ForwardTestCreated, sourceModule: "forward-testing", correlationId: request.correlationId, causationId: request.causationId, payload: { forwardTestId } })] };
  }
  get(id: string) { return this.repository.get(id); }
  list() { return this.repository.list(); }
}
function validate(r: ForwardTestRequest): { eventType: string; reason: string } | null {
  if (r.killSwitchActive) return { eventType: ForwardTestingV2EventTypes.ForwardTestBlocked, reason: "kill_switch_active" };
  if (!r.demoVerification.demoOnly || !["practice", "sandbox", "paper"].includes(r.demoVerification.environment) || r.demoVerification.accountMode !== r.demoVerification.environment) return { eventType: ForwardTestingV2EventTypes.ForwardTestDemoVerificationFailed, reason: "demo_verification_failed" };
  if (!r.snapshot.fresh) return { eventType: ForwardTestingV2EventTypes.ForwardTestBlocked, reason: "stale_snapshot" };
  if (!r.snapshot.lineageEventIds.length || !r.lineageEventIds.length) return { eventType: ForwardTestingV2EventTypes.ForwardTestLineageMissing, reason: "missing_lineage" };
  if (r.courtVerdict !== "approve_for_forward_test") return { eventType: ForwardTestingV2EventTypes.ForwardTestBlocked, reason: "court_not_approved_for_forward_test" };
  if (!r.strategy.stopLoss || !r.strategy.takeProfit) return { eventType: ForwardTestingV2EventTypes.ForwardTestBlocked, reason: "missing_exits" };
  if (r.expectedR <= 0 || r.risk <= 0) return { eventType: ForwardTestingV2EventTypes.ForwardTestBlocked, reason: "invalid_risk" };
  return null;
}
export const forwardTestingV2Service = new ForwardTestingV2Service();
