import assert from "node:assert/strict";
import { productionResilienceService } from "./productionResilience";

const ready = productionResilienceService.evaluate({
  observabilityConfigured: true,
  incidentResponseRunbookAcknowledged: true,
  incidentResponseDrillComplete: true,
  disasterRecoveryBackupConfigured: true,
  disasterRecoveryRestoreTestComplete: true,
  providerRecoveryTelemetryVisible: true,
  auditExportReplicationConfigured: true,
  emergencyControlsAvailable: true,
});
assert.equal(ready.ready, true);
assert.equal(ready.requiredActions.length, 0);

const blocked = productionResilienceService.evaluate({
  observabilityConfigured: false,
  incidentResponseRunbookAcknowledged: false,
  incidentResponseDrillComplete: false,
  disasterRecoveryBackupConfigured: false,
  disasterRecoveryRestoreTestComplete: false,
  providerRecoveryTelemetryVisible: false,
  auditExportReplicationConfigured: false,
  emergencyControlsAvailable: false,
});
assert.equal(blocked.ready, false);
assert.ok(blocked.requiredActions.some((item) => /observability/i.test(item)));
assert.ok(blocked.requiredActions.some((item) => /incident response/i.test(item)));
assert.ok(blocked.requiredActions.some((item) => /disaster recovery/i.test(item)));

console.log("productionResilience smoke tests passed");
