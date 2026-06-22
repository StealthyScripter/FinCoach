import assert from "node:assert/strict";
import { ProductionResilienceEvidenceService } from "./productionResilienceEvidence";

const service = new ProductionResilienceEvidenceService();
service.record({
  category: "incident_response",
  actorId: "ops",
  status: "drilled",
  detail: "Completed incident response drill and confirmed escalation path.",
});
service.record({
  category: "disaster_recovery",
  actorId: "ops",
  status: "verified",
  detail: "Completed backup and restore test for disaster recovery.",
});
service.record({
  category: "observability",
  actorId: "ops",
  status: "configured",
  detail: "Configured immutable audit logs and operator-visible telemetry.",
});
service.record({
  category: "provider_recovery",
  actorId: "ops",
  status: "verified",
  detail: "Provider recovery telemetry is visible to operators.",
});
service.record({
  category: "audit_replication",
  actorId: "ops",
  status: "configured",
  detail: "Primary and archive export targets are configured.",
});
service.record({
  category: "emergency_controls",
  actorId: "ops",
  status: "acknowledged",
  detail: "Kill switch and emergency controls remain available.",
});

const snapshot = service.snapshot();
assert.equal(snapshot.observabilityConfigured, true);
assert.equal(snapshot.incidentResponseRunbookAcknowledged, true);
assert.equal(snapshot.incidentResponseDrillComplete, true);
assert.equal(snapshot.disasterRecoveryBackupConfigured, true);
assert.equal(snapshot.disasterRecoveryRestoreTestComplete, true);
assert.equal(snapshot.providerRecoveryTelemetryVisible, true);
assert.equal(snapshot.auditExportReplicationConfigured, true);
assert.equal(snapshot.emergencyControlsAvailable, true);
assert.equal(snapshot.records.length, 6);

console.log("productionResilienceEvidence smoke tests passed");
