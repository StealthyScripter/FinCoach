import assert from "node:assert/strict";
import { readFileSync, rmSync, unlinkSync } from "fs";
import { EventLogService } from "./eventLogService";
import { AuditExportService } from "./execution/auditExportService";
import { InMemoryGovernanceRepository } from "./execution/governanceRepository";
import { ExecutionAuditLog } from "./execution/riskControls";

const events = new EventLogService();
const audit = new ExecutionAuditLog();
events.append({
  type: "risk.check_completed",
  userId: "risk-officer",
  sourceService: "risk",
  correlationId: "audit-test",
  payload: { approved: true },
  createdAt: "2026-06-20T12:00:00.000Z",
});
audit.append({
  action: "risk.check",
  outcome: "accepted",
  correlationId: "audit-test",
  detail: { approved: true },
});
const directory = `/tmp/marketpilot-audit-export-${Date.now()}`;
const archiveDirectory = `/tmp/marketpilot-audit-archive-${Date.now()}`;
const repository = new InMemoryGovernanceRepository();
const service = new AuditExportService(events, audit, repository, {
  MARKETPILOT_AUDIT_EXPORT_SIGNING_KEY: "test-signing-key",
  MARKETPILOT_AUDIT_EXPORT_DIR: directory,
  MARKETPILOT_AUDIT_ARCHIVE_DIR: archiveDirectory,
});
const exported = await service.generate("audit-operator", new Date("2026-06-20T12:05:00.000Z"));
assert.equal(exported.record.signatureAlgorithm, "hmac-sha256");
assert.ok(exported.record.signature);
assert.ok(exported.record.storageLocation);
assert.ok(exported.record.archiveLocation);
assert.ok(readFileSync(exported.record.storageLocation!, "utf8").includes(exported.record.artifactDigest));
assert.ok(readFileSync(exported.record.archiveLocation!, "utf8").includes(exported.record.artifactDigest));
const loaded = await service.get(exported.record.id);
assert.ok(loaded);
assert.equal(loaded?.record.id, exported.record.id);
assert.equal(loaded?.verification?.valid, true);
assert.equal(service.verify(exported.artifact, exported.record.artifactDigest, exported.record.signature).valid, true);
const tampered = structuredClone(exported.artifact);
tampered.generatedBy = "attacker";
assert.equal(service.verify(tampered, exported.record.artifactDigest, exported.record.signature).valid, false);
unlinkSync(exported.record.storageLocation!);
const fallbackLoaded = await service.get(exported.record.id);
assert.ok(fallbackLoaded);
assert.equal(fallbackLoaded?.verification?.valid, true);
const second = await service.generate("audit-operator", new Date("2026-06-20T12:10:00.000Z"));
assert.equal(second.record.previousArtifactDigest, exported.record.artifactDigest);
assert.equal((await service.list()).length, 2);
rmSync(directory, { recursive: true, force: true });
rmSync(archiveDirectory, { recursive: true, force: true });

console.log("auditExportService smoke tests passed");
