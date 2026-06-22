import assert from "node:assert/strict";
import { EventLogService } from "./eventLogService";
import { InMemoryGovernanceRepository } from "./execution/governanceRepository";
import { ExecutionAuditLog } from "./execution/riskControls";
import { SemiAutonomousApprovalService } from "./execution/semiAutonomousApprovalService";

const repository = new InMemoryGovernanceRepository();
const events = new EventLogService();
const audit = new ExecutionAuditLog();
const service = new SemiAutonomousApprovalService(repository, events, audit);
const requestedAt = new Date("2026-06-20T12:00:00.000Z");
const request = await service.request({
  requestedBy: "automation-owner",
  justification: "Bounded sandbox automation for a validated strategy under continuous monitoring.",
  durationMinutes: 60,
  scope: {
    strategyIds: ["strategy-1"],
    allowedInstruments: ["EUR/USD"],
    maxRiskPerTradePct: 0.5,
    maxDailyLoss: 100,
    maxOpenPositions: 1,
    maxNotional: 10_000,
    referenceEquity: 100_000,
    monitoringIntervalSeconds: 10,
    sandboxOnly: true,
  },
}, requestedAt);
assert.equal(request.status, "pending");
await assert.rejects(
  () => service.review(request.id, {
    reviewerId: "automation-owner",
    role: "risk_officer",
    decision: "approved",
    rationale: "Requester cannot self approve this request.",
  }, requestedAt),
  /cannot review/,
);
const riskReview = await service.review(request.id, {
  reviewerId: "risk-reviewer",
  role: "risk_officer",
  decision: "approved",
  rationale: "Risk constraints are bounded and acceptable.",
}, new Date("2026-06-20T12:05:00.000Z"));
assert.equal(riskReview.status, "pending");
const approved = await service.review(request.id, {
  reviewerId: "compliance-reviewer",
  role: "compliance_officer",
  decision: "approved",
  rationale: "Compliance controls and sandbox limitation are acceptable.",
}, new Date("2026-06-20T12:06:00.000Z"));
assert.equal(approved.status, "approved");
assert.equal((await service.active(new Date("2026-06-20T12:10:00.000Z")))?.id, request.id);
assert.equal(await service.active(new Date("2026-06-20T13:01:00.000Z")), null);
assert.equal(events.countByType("automation.approval_requested"), 1);
assert.equal(events.countByType("automation.approval_reviewed"), 2);
assert.ok(audit.list().some((entry) => entry.action === "automation.approval.approved"));

const concurrent = await service.request({
  requestedBy: "concurrent-owner",
  justification: "Concurrent reviewer test for row-locked separation of duties.",
  durationMinutes: 60,
  scope: {
    strategyIds: ["strategy-3"],
    allowedInstruments: ["EUR/USD"],
    maxRiskPerTradePct: 0.25,
    maxDailyLoss: 50,
    maxOpenPositions: 1,
    maxNotional: 5_000,
    referenceEquity: 100_000,
    monitoringIntervalSeconds: 10,
    sandboxOnly: true,
  },
});
const concurrentReviews = await Promise.allSettled([
  service.review(concurrent.id, {
    reviewerId: "risk-a",
    role: "risk_officer",
    decision: "approved",
    rationale: "First concurrent risk review is acceptable.",
  }),
  service.review(concurrent.id, {
    reviewerId: "risk-b",
    role: "risk_officer",
    decision: "approved",
    rationale: "Second concurrent risk review must be rejected.",
  }),
]);
assert.equal(concurrentReviews.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(concurrentReviews.filter((result) => result.status === "rejected").length, 1);

const revocable = await service.request({
  requestedBy: "owner-2",
  justification: "Second bounded request used to prove immediate governance revocation.",
  durationMinutes: 60,
  scope: {
    strategyIds: ["strategy-2"],
    allowedInstruments: ["GBP/USD"],
    maxRiskPerTradePct: 0.25,
    maxDailyLoss: 50,
    maxOpenPositions: 1,
    maxNotional: 5_000,
    referenceEquity: 100_000,
    monitoringIntervalSeconds: 10,
    sandboxOnly: true,
  },
});
const revoked = await service.revoke(revocable.id, "security-officer", "Emergency governance revocation");
assert.equal(revoked.status, "revoked");
assert.equal(revoked.automaticallyApplied, false);

console.log("semiAutonomousApprovalService smoke tests passed");
