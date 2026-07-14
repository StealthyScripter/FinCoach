# V2 Instrumentation

## Architecture

V2 instrumentation is provider-neutral and lives under `server/v2/telemetry/`.

The public telemetry contract supports counters, gauges, histograms, timed operations, structured operational events, and health snapshots. Telemetry is observation only. It must not authorize execution, promote strategies, alter replay decisions, or mutate domain outcomes.

## Failure Policy

Noncritical metric sink failures degrade observability and increment dropped metric state. They do not convert a successful domain operation into a failed one and do not report a failed domain operation as successful.

Critical audit evidence remains outside the metric sink and must continue to use governed durable repositories and immutable event lineage.

## Labels

Allowed metric labels are bounded: `module`, `operation`, `eventType`, `resultClass`, `errorClass`, `schemaVersion`, `timeframe`, `assetClass`, `lifecycleState`, `courtroomVerdict`, `rejectionCategory`, `replayMode`, and `workerType`.

Unbounded identifiers such as event IDs, correlation IDs, strategy IDs, signal IDs, account IDs, token values, and raw error messages are rejected as metric labels.

## Structured Events

Structured operational events include timestamp, level, module, operation, result, error class, schema version, correlation ID, causation ID, duration, retry attempt, hashed worker ID, and redacted details.

Credentials, connection strings, account IDs, tokens, chat IDs, and secret-like fields are redacted.

## Health

Telemetry health reports state, last successful record, last failed record, failure class, and dropped metric count. Once a sink drops a metric, health remains `degraded` until a new telemetry sink is installed or the process is restarted.
