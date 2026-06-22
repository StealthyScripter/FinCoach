import { randomUUID } from "crypto";
import { z } from "zod";
import { eventLogService, type EventLogService } from "../eventLogService";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";

export const productionResilienceEvidenceSchema = z.object({
  category: z.enum([
    "observability",
    "incident_response",
    "disaster_recovery",
    "provider_recovery",
    "audit_replication",
    "emergency_controls",
  ]),
  actorId: z.string().min(1),
  status: z.enum(["configured", "acknowledged", "drilled", "verified"]),
  detail: z.string().min(12),
});

export type ProductionResilienceEvidenceInput = z.infer<typeof productionResilienceEvidenceSchema>;

export type ProductionResilienceEvidenceRecord = ProductionResilienceEvidenceInput & {
  id: string;
  createdAt: string;
};

export class ProductionResilienceEvidenceService {
  private records = new Map<string, ProductionResilienceEvidenceRecord>();

  constructor(
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
  ) {}

  record(input: ProductionResilienceEvidenceInput, now = new Date()) {
    const parsed = productionResilienceEvidenceSchema.parse(input);
    const record: ProductionResilienceEvidenceRecord = {
      id: randomUUID(),
      ...parsed,
      createdAt: now.toISOString(),
    };
    this.records.set(record.id, record);
    this.events.append({
      type: "production.resilience_recorded",
      userId: parsed.actorId,
      sourceService: "production-resilience",
      correlationId: record.id,
      payload: record,
      createdAt: record.createdAt,
    });
    this.audit.append({
      action: "production.resilience.recorded",
      outcome: "accepted",
      correlationId: record.id,
      detail: record,
    });
    return record;
  }

  list() {
    return Array.from(this.records.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((record) => ({ ...record }));
  }

  snapshot() {
    const latestByCategory = new Map<ProductionResilienceEvidenceInput["category"], ProductionResilienceEvidenceRecord>();
    for (const record of Array.from(this.records.values())) {
      const existing = latestByCategory.get(record.category);
      if (!existing || existing.createdAt < record.createdAt) latestByCategory.set(record.category, record);
    }
    return {
      observabilityConfigured: latestByCategory.has("observability"),
      incidentResponseRunbookAcknowledged: latestByCategory.has("incident_response"),
      incidentResponseDrillComplete: latestByCategory.get("incident_response")?.status === "drilled",
      disasterRecoveryBackupConfigured: latestByCategory.has("disaster_recovery"),
      disasterRecoveryRestoreTestComplete: latestByCategory.get("disaster_recovery")?.status === "verified",
      providerRecoveryTelemetryVisible: latestByCategory.has("provider_recovery"),
      auditExportReplicationConfigured: latestByCategory.has("audit_replication"),
      emergencyControlsAvailable: latestByCategory.has("emergency_controls"),
      records: this.list(),
    };
  }
}

export const productionResilienceEvidenceService = new ProductionResilienceEvidenceService();
