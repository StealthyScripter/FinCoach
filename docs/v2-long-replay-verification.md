# V2 Long Replay Verification

## Purpose

The V2 replay verification harness proves that replayed research evidence remains deterministic, restart-safe, lineage-complete, and safe. It coordinates the existing replay module through public contracts and does not implement a second replay engine.

The harness supports these run modes:

- `verify`: short deterministic fixture for local or cloud configuration checks.
- `five_year`: cloud-scale replay manifest for a five-year campaign.
- `ten_year`: cloud-scale replay manifest for a ten-year campaign.
- `custom`: operator-supplied manifest boundaries.
- `resume`: resume from the latest valid checkpoint.
- `compare`: compare completed replay artifacts for deterministic equivalence.

## Local Scope

Local development verification is bounded to deterministic fixtures and moderate stress runs that fit on a laptop. The local suite covers:

- manifest validation and hashing;
- dataset hash validation;
- deterministic repeated replay;
- checkpoint creation;
- restart-schedule metadata;
- required result artifacts;
- critical-result validation;
- safety state proving live execution blocked, no broker calls, and no Telegram messages;
- generated artifact ignore rules.

The local medium replay fixture currently uses 48 deterministic source events across `EUR_USD` and `GBP_USD` on `M15`. It is a tooling validation fixture, not a cloud capacity result.

## Cloud Scope

Five-year and ten-year campaigns are cloud-only unless an operator genuinely runs them on adequate hardware. Cloud runs must record:

- repository commit;
- package and Node versions;
- manifest hash;
- dataset hashes;
- schema versions;
- checkpoint interval;
- restart schedule;
- worker count;
- output directory;
- final status and validation failures.

Cloud output must remain outside tracked source. The default output path is `artifacts/v2-replay/`, which is ignored by Git.

## Critical Checks

A replay run fails when any critical invariant fails:

- future-data access;
- deterministic mismatch;
- broken lineage;
- duplicate immutable event;
- checkpoint divergence;
- live execution enabled;
- broker call detected;
- Telegram message detected;
- malformed persisted evidence;
- missing required artifact;
- unknown terminal error;
- schema incompatibility;
- unrecovered critical dead letter;
- unbounded retry loop;
- non-finite accepted metric.

Warnings must appear in `failures.json`, `summary.json`, and `report.md`; they are not silently converted into success.

## Safety Policy

Replay verification never promotes strategies, publishes external signals, places broker orders, or sends Telegram messages. Manifests must declare:

```json
{
  "liveExecutionBlocked": true,
  "brokerCallsAllowed": false,
  "telegramAllowed": false
}
```

Any manifest that enables broker calls or Telegram delivery is rejected before replay starts.
