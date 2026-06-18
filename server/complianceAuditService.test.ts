import assert from "node:assert/strict";
import { complianceAuditSummarySchema, type AuditLog } from "@shared/schema";
import { complianceAuditService } from "./complianceAuditService";

const events: AuditLog[] = [
  {
    id: "risk",
    actor: "risk_officer",
    action: "evaluated_ticket_approve",
    target: "ticket-1",
    metadata: { score: 90 },
    createdAt: "2026-06-15T12:00:00.000Z",
  },
  {
    id: "preview",
    actor: "paper_broker",
    action: "generated_order_preview",
    target: "ticket-1",
    metadata: { previewId: "preview-1" },
    createdAt: "2026-06-15T12:01:00.000Z",
  },
  {
    id: "ack",
    actor: "user",
    action: "acknowledged_paper_fill_compliance",
    target: "ticket-1",
    metadata: { previewId: "preview-1" },
    createdAt: "2026-06-15T12:02:00.000Z",
  },
  {
    id: "fill",
    actor: "paper_broker",
    action: "paper_filled_ticket",
    target: "ticket-1",
    metadata: { previewId: "preview-1" },
    createdAt: "2026-06-15T12:03:00.000Z",
  },
  {
    id: "unrelated",
    actor: "system",
    action: "initialized_marketpilot_mvp",
    target: "demo-user",
    metadata: {},
    createdAt: "2026-06-15T11:00:00.000Z",
  },
];

const summary = complianceAuditService.summarize({
  events,
  target: "ticket-1",
  now: new Date("2026-06-15T12:05:00.000Z"),
});

complianceAuditSummarySchema.parse(summary);
assert.equal(summary.target, "ticket-1");
assert.equal(summary.eventCount, 4);
assert.equal(summary.completePaperFillChain, true);
assert.equal(summary.missingEvidence.length, 0);
assert.equal(summary.events[0].action, "paper_filled_ticket");
assert.ok(summary.latestDigest);
assert.notEqual(summary.events[0].digest, summary.events[1].digest);

const incomplete = complianceAuditService.summarize({
  events: events.filter((event) => event.action !== "acknowledged_paper_fill_compliance"),
  target: "ticket-1",
});
assert.equal(incomplete.completePaperFillChain, false);
assert.ok(incomplete.missingEvidence.includes("Compliance acknowledgement"));

console.log("compliance audit service tests passed");
