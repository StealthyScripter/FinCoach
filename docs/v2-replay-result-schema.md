# V2 Replay Result Schema

## Manifest

Replay manifests use version `fincoach.v2.replay-manifest.1` and include:

- `manifestVersion`
- `runId`
- `repositoryCommit`
- `startedAt`
- `datasetId`
- `datasetVersion`
- `datasetHashes`
- `symbols`
- `timeframes`
- `startTime`
- `endTime`
- `replayMode`
- `seed`
- `checkpointInterval`
- `restartSchedule`
- `workerCount`
- `resourceLimits`
- `featureSchemaVersions`
- `eventSchemaVersions`
- `expectedSafetyState`
- `outputDirectory`

The canonical manifest hash is SHA-256 over stable JSON with sorted object keys.

## Required Artifacts

Every completed run must write:

- `manifest.json`
- `manifest.sha256`
- `run-status.json`
- `domain-event-hashes.json`
- `lineage-validation.json`
- `temporal-validation.json`
- `determinism-validation.json`
- `resource-metrics.jsonl`
- `persistence-validation.json`
- `safety-validation.json`
- `failures.json`
- `summary.json`
- `report.md`

Missing artifacts are critical failures.

## Summary

`summary.json` contains:

- `runId`
- `manifestHash`
- `status`
- `inputEventCount`
- `outputEventCount`
- `domainEventHash`
- `checkpointCount`
- `restartCount`
- `durationMs`
- `peakHeapMb`
- `failures`
- `safety`

`status` is one of:

- `passed`
- `warning`
- `failed`

## Failure Record

Each failure record contains:

- `code`
- `severity`
- `message`
- `module`

`severity` is `critical` or `warning`. Critical failures make the validator return nonzero.

## Safety Record

The safety record includes:

- `liveExecutionBlocked`
- `brokerCalls`
- `telegramMessages`

A valid verification run requires `liveExecutionBlocked=true`, `brokerCalls=0`, and `telegramMessages=0`.
