import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { deploymentMetadata } from "./deploymentMetadata";
import { emitReportDeliverySummary, emitResearchCycleObserverSummaries, emitSafetyStateSnapshot } from "./observerTelemetry";
import { StructuredLogger } from "./structuredLogger";

const root = "/tmp/fincoach-observer-telemetry-test";
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const logger = new StructuredLogger({ logDir: root, maxBytes: 1024 * 1024, retentionDays: 7, now: () => new Date("2026-08-12T12:00:00.000Z") });
const revision = deploymentMetadata({
  FINCOACH_BUILD_COMMIT: "abc123def456",
  FINCOACH_BUILD_ID: "build-17",
} as NodeJS.ProcessEnv);

assert.equal(revision.commit, "abc123def456");
assert.equal(revision.buildId, "build-17");
assert.equal(revision.source, "FINCOACH_BUILD_COMMIT");
assert.equal(revision.runtimeCommit, "abc123def456");
assert.equal(revision.runtimeMetadataState, "runtime_only");
assert.equal(revision.revisionMatch, null);

const mismatchedRevision = deploymentMetadata({
  FINCOACH_BUILD_COMMIT: "runtime-old",
  FINCOACH_BUILD_ID: "runtime-old-build",
  GIT_COMMIT: "runtime-newer",
} as NodeJS.ProcessEnv, { buildCommit: "embedded-new", buildId: "embedded-new" });
assert.equal(mismatchedRevision.commit, "embedded-new");
assert.equal(mismatchedRevision.buildId, "embedded-new");
assert.equal(mismatchedRevision.buildCommit, "embedded-new");
assert.equal(mismatchedRevision.runtimeCommit, "runtime-old");
assert.equal(mismatchedRevision.runtimeBuildId, "runtime-old-build");
assert.equal(mismatchedRevision.runtimeMetadataState, "stale");
assert.equal(mismatchedRevision.revisionMatch, false);

const absentRuntimeRevision = deploymentMetadata({} as NodeJS.ProcessEnv, { buildCommit: "embedded-only", buildId: "artifact-1" });
assert.equal(absentRuntimeRevision.commit, "embedded-only");
assert.equal(absentRuntimeRevision.buildId, "artifact-1");
assert.equal(absentRuntimeRevision.runtimeMetadataState, "absent");
assert.equal(absentRuntimeRevision.revisionMatch, true);

const pm2StaleEnvRevision = deploymentMetadata({
  FINCOACH_BUILD_COMMIT: "old-pm2-env",
  FINCOACH_BUILD_ID: "old-pm2-build",
} as NodeJS.ProcessEnv, { buildCommit: "new-artifact", buildId: "new-artifact" });
assert.equal(pm2StaleEnvRevision.commit, "new-artifact");
assert.equal(pm2StaleEnvRevision.buildId, "new-artifact");
assert.equal(pm2StaleEnvRevision.runtimeMetadataState, "stale");
assert.equal(pm2StaleEnvRevision.revisionMatch, false);

const input = {
  cycleId: "cycle-1",
  correlationId: "corr-1",
  runtimeInstanceId: "runtime-1",
  durationMs: 42,
  result: "completed_with_blockers" as const,
  observationsAttempted: 3,
  observationsCreated: 2,
  observationsDeduplicated: 1,
  hypothesesEvaluated: 2,
  hypothesesCreated: 1,
  experimentsRun: 1,
  backtestsCompleted: 1,
  rankedCandidates: 1,
  forwardTestsStarted: 0,
  blockers: [{ code: "hypothesis_insufficient_independent_occurrences", secretToken: "must-not-leak" }],
  pipeline: {
    ingested: 3,
    parsed: 2,
    candidates: 1,
    riskApproved: 1,
    riskRejected: 1,
    executionRequested: 0,
    executionSucceeded: 0,
    executionFailed: 0,
    reconciled: 0,
    closed: 0,
  },
  marketDataCoverage: [{
    symbol: "EUR_USD",
    timeframe: "15m",
    session: "london",
    provider: "oanda-practice-historical",
    requested: 3,
    successful: 2,
    latestTimestamp: "2026-08-12T11:45:00.000Z",
    freshnessSeconds: 900,
    stale: false,
  }],
  deployedRevision: revision,
};
const before = JSON.stringify(input);
emitResearchCycleObserverSummaries(input, logger);
assert.equal(JSON.stringify(input), before);

emitSafetyStateSnapshot({
  runtimeInstanceId: "runtime-1",
  reason: "test",
  executionMode: "research_only",
  killSwitchState: "inactive",
  dailyLossBreakerState: "disabled",
  brokerEnvironment: "none",
  riskGateStatus: "passing",
  liveExecutionBlocked: true,
  deployedRevision: revision,
}, logger);

emitReportDeliverySummary({
  correlationId: "corr-1",
  reportId: "report-1",
  deliveryAttempt: 2,
  destinationHash: "hash-1",
  sent: false,
  reason: "rate_limited",
  deployedRevision: revision,
}, logger);

const v2Lines = readFileSync(join(root, "v2-runtime.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
assert.deepEqual(v2Lines.map((line) => line.event), ["research_cycle_summary", "pipeline_summary", "market_data_coverage_summary"]);
assert.equal(v2Lines[0].cycleId, "cycle-1");
assert.equal(v2Lines[0].blockersByReason.hypothesis_insufficient_independent_occurrences, 1);
assert.equal(v2Lines[1].riskRejected, 1);
assert.equal(v2Lines[2].symbol, "EUR_USD");
assert.equal(v2Lines[2].session, "london");
assert.equal(v2Lines[2].successful, 2);
assert.equal(v2Lines[0].deployedRevision.commit, "abc123def456");

const auditLine = JSON.parse(readFileSync(join(root, "audit.log"), "utf8").trim());
assert.equal(auditLine.event, "safety_state_snapshot");
assert.equal(auditLine.liveExecutionBlocked, true);
assert.equal(auditLine.deployedRevision.buildId, "build-17");

const telegramLine = JSON.parse(readFileSync(join(root, "telegram.log"), "utf8").trim());
assert.equal(telegramLine.event, "report_delivery_summary");
assert.equal(telegramLine.reportDeliveryStatus, "failed");
assert.equal(telegramLine.reason, "rate_limited");
assert.equal(telegramLine.destinationHash, "hash-1");

const allLogs = readFileSync(join(root, "v2-runtime.log"), "utf8") + readFileSync(join(root, "audit.log"), "utf8") + readFileSync(join(root, "telegram.log"), "utf8");
assert.ok(!allLogs.includes("must-not-leak"));

console.log("observer telemetry tests passed");
