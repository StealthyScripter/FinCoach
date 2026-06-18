import { createHash } from "crypto";
import type { AuditLog, ComplianceAuditEvent, ComplianceAuditSummary } from "@shared/schema";

const requiredEvidence = {
  riskEvaluation: "Risk Officer evaluation",
  orderPreview: "Order preview",
  complianceAcknowledgement: "Compliance acknowledgement",
  paperFill: "Paper fill",
};

export class ComplianceAuditService {
  summarize({
    events,
    target = null,
    now = new Date(),
  }: {
    events: AuditLog[];
    target?: string | null;
    now?: Date;
  }): ComplianceAuditSummary {
    const filtered = target ? events.filter((event) => event.target === target) : events;
    const chronological = [...filtered].sort((left, right) => {
      const byTime = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
    });
    const chained: ComplianceAuditEvent[] = [];
    let previousDigest: string | null = null;

    for (let index = 0; index < chronological.length; index += 1) {
      const event = chronological[index];
      const digest = digestEvent(event, previousDigest);
      chained.push({
        ...event,
        metadata: event.metadata ?? {},
        sequence: index + 1,
        previousDigest,
        digest,
      });
      previousDigest = digest;
    }

    const evidence = {
      riskEvaluation: chained.some((event) => event.action.startsWith("evaluated_ticket_")),
      orderPreview: chained.some((event) => event.action === "generated_order_preview"),
      complianceAcknowledgement: chained.some((event) => event.action === "acknowledged_paper_fill_compliance"),
      paperFill: chained.some((event) => event.action === "paper_filled_ticket"),
    };
    const missingEvidence = Object.entries(requiredEvidence)
      .filter(([key]) => !evidence[key as keyof typeof evidence])
      .map(([, label]) => label);

    return {
      target,
      generatedAt: now.toISOString(),
      eventCount: chained.length,
      latestDigest: previousDigest,
      completePaperFillChain: missingEvidence.length === 0,
      evidence,
      missingEvidence,
      events: chained.reverse(),
    };
  }
}

export const complianceAuditService = new ComplianceAuditService();

function digestEvent(event: AuditLog, previousDigest: string | null) {
  return createHash("sha256")
    .update(JSON.stringify({
      previousDigest,
      id: event.id,
      actor: event.actor,
      action: event.action,
      target: event.target,
      metadata: stableObject(event.metadata ?? {}),
      createdAt: event.createdAt,
    }))
    .digest("hex");
}

function stableObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
