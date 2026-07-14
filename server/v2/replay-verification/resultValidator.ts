import type { ReplayVerificationFailure, ReplayVerificationResult } from "./contracts";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { hashHistoricalDatasetManifest } from "./historicalDataset";
import { hashReplayManifest } from "./manifest";

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

export function validateReplayOutputDirectory(outputDirectory: string) {
  const failures: ReplayVerificationFailure[] = [];
  let result: ReplayVerificationResult | null = null;
  let artifacts: string[] = [];
  try {
    artifacts = readdirSync(outputDirectory);
  } catch (error) {
    return { ok: false, failures: [{ code: "missing_output_directory", severity: "critical" as const, message: classify(error) }] };
  }
  try {
    result = JSON.parse(readFileSync(join(outputDirectory, "summary.json"), "utf8"));
  } catch (error) {
    failures.push({ code: "malformed_summary_artifact", severity: "critical", message: classify(error) });
  }
  if (result) failures.push(...validateReplayResult(result, artifacts).failures);
  try {
    const manifest = JSON.parse(readFileSync(join(outputDirectory, "manifest.json"), "utf8"));
    const expected = readFileSync(join(outputDirectory, "manifest.sha256"), "utf8").trim();
    const actual = hashReplayManifest(manifest);
    if (expected !== actual) failures.push({ code: "manifest_hash_mismatch", severity: "critical", message: "manifest.sha256 does not match manifest.json" });
    if (result && result.manifestHash !== actual) failures.push({ code: "summary_manifest_hash_mismatch", severity: "critical", message: "summary manifestHash does not match manifest.json" });
  } catch (error) {
    failures.push({ code: "manifest_validation_failed", severity: "critical", message: classify(error) });
  }
  if (result?.inputMode === "historical") {
    try {
      const datasetManifest = JSON.parse(readFileSync(join(outputDirectory, "dataset-manifest.json"), "utf8"));
      const expected = readFileSync(join(outputDirectory, "dataset-manifest.sha256"), "utf8").trim();
      const actual = hashHistoricalDatasetManifest({ ...datasetManifest, manifestHash: undefined });
      if (expected !== actual) failures.push({ code: "dataset_manifest_hash_mismatch", severity: "critical", message: "dataset-manifest.sha256 does not match dataset-manifest.json" });
    } catch (error) {
      failures.push({ code: "dataset_manifest_validation_failed", severity: "critical", message: classify(error) });
    }
    try {
      const partitionValidation = JSON.parse(readFileSync(join(outputDirectory, "partition-validation.json"), "utf8"));
      if (partitionValidation.ok !== true) failures.push({ code: "partition_validation_failed", severity: "critical", message: "partition validation artifact is not ok" });
    } catch (error) {
      failures.push({ code: "partition_validation_malformed", severity: "critical", message: classify(error) });
    }
    try {
      const inputSummary = JSON.parse(readFileSync(join(outputDirectory, "input-summary.json"), "utf8"));
      if (result && inputSummary.inputEventCount !== result.inputEventCount) failures.push({ code: "input_summary_count_mismatch", severity: "critical", message: "input-summary count does not match summary" });
    } catch (error) {
      failures.push({ code: "input_summary_malformed", severity: "critical", message: classify(error) });
    }
  }
  const critical = failures.filter(failure => failure.severity === "critical");
  return { ok: critical.length === 0, failures };
}

function classify(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
