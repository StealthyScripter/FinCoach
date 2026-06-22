import { z } from "zod";

export const productionResilienceInputSchema = z.object({
  observabilityConfigured: z.boolean(),
  incidentResponseRunbookAcknowledged: z.boolean(),
  incidentResponseDrillComplete: z.boolean(),
  disasterRecoveryBackupConfigured: z.boolean(),
  disasterRecoveryRestoreTestComplete: z.boolean(),
  providerRecoveryTelemetryVisible: z.boolean(),
  auditExportReplicationConfigured: z.boolean(),
  emergencyControlsAvailable: z.boolean(),
});

export type ProductionResilienceInput = z.infer<typeof productionResilienceInputSchema>;

type ProductionResilienceCheck = {
  id: string;
  passed: boolean;
  detail: string;
  requiredAction?: string;
};

export class ProductionResilienceService {
  evaluate(input: ProductionResilienceInput, now = new Date()) {
    const parsed = productionResilienceInputSchema.parse(input);
    const checks: ProductionResilienceCheck[] = [
      check("observability", parsed.observabilityConfigured, "Observability and audit telemetry are configured", "Configure immutable audit logs, event tracing, and operator-visible health checks"),
      check("incident_response", parsed.incidentResponseRunbookAcknowledged && parsed.incidentResponseDrillComplete, "Incident response runbook is acknowledged and drill-tested", "Acknowledge the incident response runbook and complete a tested response drill"),
      check("disaster_recovery", parsed.disasterRecoveryBackupConfigured && parsed.disasterRecoveryRestoreTestComplete, "Disaster recovery backup and restore test are configured", "Configure a backup target and complete a restore test"),
      check("provider_recovery", parsed.providerRecoveryTelemetryVisible, "Provider recovery telemetry is visible in the operator layer", "Exercise provider recovery telemetry so operators can review recovery attempts and failures"),
      check("audit_replication", parsed.auditExportReplicationConfigured, "Audit exports are mirrored to a separate archive target", "Configure mirrored audit export replication"),
      check("emergency_controls", parsed.emergencyControlsAvailable, "Emergency controls and kill switches are available", "Keep the atomic emergency controls and kill switches available"),
    ];
    const requiredActions = checks.filter((item) => !item.passed && item.requiredAction).map((item) => item.requiredAction as string);
    return {
      ready: requiredActions.length === 0,
      checks,
      requiredActions,
      generatedAt: now.toISOString(),
    };
  }
}

function check(id: string, passed: boolean, detail: string, requiredAction: string): ProductionResilienceCheck {
  return { id, passed, detail, requiredAction: passed ? undefined : requiredAction };
}

export const productionResilienceService = new ProductionResilienceService();
