# FinCoach V2 Deployment Rollback

Rollback must preserve immutable evidence, historical migrations, unresolved failures, and replay artifacts. Rollback must never enable live trading or discard unresolved work silently.

## Failed Application Deployment

1. Stop the new process or container.
2. Keep PostgreSQL online.
3. Preserve logs and replay artifacts.
4. Return to the previous approved commit or image.
5. Run `npm run check`, `npm test`, `npm run build`, and `npm run test:pgstorage` before resuming.

## Failed Migration

1. Stop application writers.
2. Preserve the database and migration logs.
3. Do not edit or rewrite applied migrations.
4. Restore from the last verified backup if required.
5. Re-run the migration command only after identifying the failed migration boundary.

## Failed Replay Startup

1. Stop the replay gate.
2. Preserve `manifest.json`, `manifest.sha256`, dataset validation artifacts, and logs.
3. Run `npm run v2:replay:validate -- --output <OUTPUT_DIR>`.
4. Fix environment, dataset, or configuration issues before restarting from a new operator-approved gate.

## Corrupted Checkpoint

1. Stop the campaign.
2. Preserve the corrupted checkpoint for diagnosis.
3. Do not manually edit source cursors.
4. Resume only from a valid checkpoint with matching repository commit, manifest hash, dataset hash, and source cursor.

## Incompatible Dataset

1. Stop before replay execution.
2. Preserve dataset validation output.
3. Create a new dataset manifest for changed data.
4. Do not reuse deterministic comparison results from a different dataset hash.

## Resource Exhaustion

For disk, PostgreSQL, or memory exhaustion:

1. Stop the gate.
2. Preserve artifacts.
3. Increase capacity or reduce campaign scope.
4. Re-run preflight with stricter resource gates.
5. Resume only after validation passes.

## Retry Or Dead-Letter Growth

1. Stop the campaign at the current gate.
2. Preserve `failures.json`, telemetry, and dead-letter records.
3. Classify the issue before replaying.
4. Do not suppress critical dead letters to pass validation.
