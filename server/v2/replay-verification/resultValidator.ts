import type { ReplayVerificationFailure, ReplayVerificationResult } from "./contracts";

const requiredArtifacts = [
  "manifest.json",
  "manifest.sha256",
  "run-status.json",
  "domain-event-hashes.json",
  "lineage-validation.json",
  "temporal-validation.json",
  "determinism-validation.json",
  "resource-metrics.jsonl",
  "persistence-validation.json",
  "safety-validation.json",
  "failures.json",
  "summary.json",
  "report.md",
] as const;

const requiredHistoricalArtifacts = [
  "dataset-manifest.json",
  "dataset-manifest.sha256",
  "partition-validation.json",
  "input-summary.json",
  "telemetry-snapshot.json",
] as const;

export function requiredReplayArtifacts() {
  return [...requiredArtifacts];
}

export function validateReplayResult(result: ReplayVerificationResult, artifacts: readonly string[], options: { enforceHistoricalArtifacts?: boolean } = { enforceHistoricalArtifacts: true }) {
  const failures: ReplayVerificationFailure[] = [...result.failures];
  for (const artifact of requiredArtifacts) {
    if (!artifacts.includes(artifact)) failures.push({ code: "missing_result_artifact", severity: "critical", message: `${artifact} is missing` });
  }
  if (result.inputMode === "historical" && options.enforceHistoricalArtifacts !== false) {
    for (const artifact of requiredHistoricalArtifacts) {
      if (!artifacts.includes(artifact)) failures.push({ code: "missing_historical_result_artifact", severity: "critical", message: `${artifact} is missing` });
    }
  }
  if (result.inputMode === "historical" && result.runId.startsWith("fixture-")) failures.push({ code: "fixture_used_in_historical_mode", severity: "critical", message: "Historical replay used fixture run identity" });
  if (!Number.isFinite(result.peakHeapMb)) failures.push({ code: "non_finite_metric", severity: "critical", message: "peakHeapMb must be finite" });
  if (result.safety.liveExecutionBlocked !== true || result.safety.brokerCalls !== 0 || result.safety.telegramMessages !== 0) failures.push({ code: "unsafe_replay_side_effect", severity: "critical", message: "Replay safety state failed" });
  const critical = failures.filter(failure => failure.severity === "critical");
  return { ok: critical.length === 0, failures };
}
