import { randomUUID } from "crypto";
import { z } from "zod";
import { eventLogService, type EventLogService } from "../eventLogService";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";
import { governanceRepository, type GovernanceRepository } from "./governanceRepository";

export const semiAutonomousScopeSchema = z.object({
  strategyIds: z.array(z.string().min(1)).min(1).max(10),
  allowedInstruments: z.array(z.string().min(1)).min(1).max(20),
  maxRiskPerTradePct: z.number().positive().max(1),
  maxDailyLoss: z.number().positive(),
  maxOpenPositions: z.number().int().positive().max(10),
  maxNotional: z.number().positive(),
  referenceEquity: z.number().positive(),
  monitoringIntervalSeconds: z.number().int().min(5).max(60),
  sandboxOnly: z.literal(true),
});

export const semiAutonomousRequestSchema = z.object({
  requestedBy: z.string().min(1),
  justification: z.string().min(20),
  durationMinutes: z.number().int().min(15).max(24 * 60),
  scope: semiAutonomousScopeSchema,
});

export const semiAutonomousReviewSchema = z.object({
  reviewerId: z.string().min(1),
  role: z.enum(["risk_officer", "compliance_officer"]),
  decision: z.enum(["approved", "rejected"]),
  rationale: z.string().min(10),
});

export type SemiAutonomousApproval = {
  id: string;
  requestedBy: string;
  justification: string;
  status: "pending" | "approved" | "rejected" | "revoked" | "expired";
  scope: z.infer<typeof semiAutonomousScopeSchema>;
  reviews: Array<{
    reviewerId: string;
    role: "risk_officer" | "compliance_officer";
    decision: "approved" | "rejected";
    rationale: string;
    reviewedAt: string;
  }>;
  requestedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revocationReason: string | null;
  automaticallyApplied: false;
  productionOrderSubmissionEnabled: false;
};

export class SemiAutonomousApprovalService {
  constructor(
    private readonly repository: GovernanceRepository = governanceRepository,
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
  ) {}

  async request(input: z.infer<typeof semiAutonomousRequestSchema>, now = new Date()) {
    const parsed = semiAutonomousRequestSchema.parse(input);
    const approval: SemiAutonomousApproval = {
      id: randomUUID(),
      requestedBy: parsed.requestedBy,
      justification: parsed.justification,
      status: "pending",
      scope: parsed.scope,
      reviews: [],
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + parsed.durationMinutes * 60_000).toISOString(),
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
      automaticallyApplied: false,
      productionOrderSubmissionEnabled: false,
    };
    await this.repository.saveApproval(approval);
    this.record("requested", approval, parsed.requestedBy, now);
    return clone(approval);
  }

  async review(id: string, input: z.infer<typeof semiAutonomousReviewSchema>, now = new Date()) {
    const parsed = semiAutonomousReviewSchema.parse(input);
    const approval = await this.repository.mutateApproval(id, (record) => {
      const current = record as SemiAutonomousApproval;
      if (Date.parse(current.expiresAt) <= now.getTime()) {
        current.status = "expired";
        throw new Error("Semi-autonomous approval request expired");
      }
      if (current.status !== "pending") throw new Error("Semi-autonomous approval is no longer pending");
      if (current.requestedBy === parsed.reviewerId) throw new Error("The requester cannot review their own autonomy request");
      if (current.reviews.some((review) => review.reviewerId === parsed.reviewerId)) throw new Error("Reviewer has already submitted a decision");
      if (current.reviews.some((review) => review.role === parsed.role)) throw new Error(`A ${parsed.role} review already exists`);
      current.reviews.push({ ...parsed, reviewedAt: now.toISOString() });
      if (parsed.decision === "rejected") current.status = "rejected";
      else if (requiredRoles.every((role) => current.reviews.some((review) => review.role === role && review.decision === "approved"))) {
        current.status = "approved";
      }
      return current;
    }) as SemiAutonomousApproval;
    this.record(parsed.decision === "approved" ? "approved" : "rejected", approval, parsed.reviewerId, now, parsed.role);
    return clone(approval);
  }

  async revoke(id: string, revokedBy: string, reason: string, now = new Date()) {
    if (!revokedBy.trim() || reason.trim().length < 10) throw new Error("Named revoker and reason are required");
    const approval = await this.repository.mutateApproval(id, (record) => {
      const current = record as SemiAutonomousApproval;
      if (!["pending", "approved"].includes(current.status)) throw new Error("Approval cannot be revoked from its current state");
      current.status = "revoked";
      current.revokedAt = now.toISOString();
      current.revokedBy = revokedBy;
      current.revocationReason = reason;
      return current;
    }) as SemiAutonomousApproval;
    this.record("revoked", approval, revokedBy, now);
    return clone(approval);
  }

  async active(now = new Date()) {
    const approvals = await this.list(now);
    return approvals.find((approval) => approval.status === "approved" && Date.parse(approval.expiresAt) > now.getTime()) ?? null;
  }

  async list(now = new Date()) {
    const approvals = await this.repository.listApprovals<SemiAutonomousApproval>();
    for (const approval of approvals) {
      if (["pending", "approved"].includes(approval.status) && Date.parse(approval.expiresAt) <= now.getTime()) {
        const expired = await this.repository.mutateApproval(approval.id, (record) => {
          const current = record as SemiAutonomousApproval;
          if (["pending", "approved"].includes(current.status) && Date.parse(current.expiresAt) <= now.getTime()) {
            current.status = "expired";
          }
          return current;
        }) as SemiAutonomousApproval;
        Object.assign(approval, expired);
      }
    }
    return approvals.sort((left, right) => right.requestedAt.localeCompare(left.requestedAt)).map(clone);
  }

  health() {
    return this.repository.health();
  }

  private record(
    action: "requested" | "approved" | "rejected" | "revoked",
    approval: SemiAutonomousApproval,
    actorId: string,
    now: Date,
    role?: string,
  ) {
    this.events.append({
      type: eventType[action],
      userId: actorId,
      sourceService: "semi-autonomous-approval",
      correlationId: approval.id,
      payload: { approvalId: approval.id, status: approval.status, role: role ?? null, expiresAt: approval.expiresAt },
      createdAt: now.toISOString(),
    });
    this.audit.append({
      action: `automation.approval.${action}`,
      outcome: action === "rejected" ? "rejected" : "accepted",
      correlationId: approval.id,
      detail: { actorId, role: role ?? null, status: approval.status, scope: approval.scope },
    });
  }
}

const requiredRoles = ["risk_officer", "compliance_officer"] as const;
const eventType = {
  requested: "automation.approval_requested",
  approved: "automation.approval_reviewed",
  rejected: "automation.approval_reviewed",
  revoked: "automation.approval_revoked",
} as const;

function clone(approval: SemiAutonomousApproval): SemiAutonomousApproval {
  return {
    ...approval,
    scope: { ...approval.scope, strategyIds: [...approval.scope.strategyIds], allowedInstruments: [...approval.scope.allowedInstruments] },
    reviews: approval.reviews.map((review) => ({ ...review })),
  };
}

export const semiAutonomousApprovalService = new SemiAutonomousApprovalService();
