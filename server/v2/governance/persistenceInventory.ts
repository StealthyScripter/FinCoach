import { z } from "zod";

export const persistenceRequirementSchema = z.object({
  ownerModule: z.string().min(1),
  recordType: z.string().min(1),
  requirement: z.enum(["durable_required_before_extended_pilot", "durable_recommended", "safe_to_recompute", "ephemeral_by_design", "test_only"]),
  naturalKey: z.string().min(1),
  idempotencyKey: z.string().min(1),
  mutability: z.enum(["append_only", "explicit_operational_update", "recomputable", "ephemeral"]),
  retentionPolicy: z.string().min(1),
  recoveryRequirement: z.string().min(1),
  queryPatterns: z.array(z.string().min(1)).min(1),
  schemaVersion: z.string().min(1),
  migrationStrategy: z.string().min(1),
  postgresMilestone: z.enum(["B", "C", "D", "future", "not_required"]),
});

export type PersistenceRequirement = z.infer<typeof persistenceRequirementSchema>;

export const persistenceInventory: readonly PersistenceRequirement[] = [
  req("orchestration", "orchestration_cycle", "durable_required_before_extended_pilot", "cycleId", "idempotencyKey", "explicit_operational_update", "retain 180 days", "resume active or failed cycle after restart", ["latest by status", "by idempotency key"], "fincoach.v2.orchestration.1", "module-owned PostgreSQL table with unique idempotency key", "B"),
  req("orchestration", "orchestration_checkpoint", "durable_required_before_extended_pilot", "consumerId", "consumerId + sourceEventId", "explicit_operational_update", "retain latest plus 180-day history", "resume without duplicate downstream work", ["latest by consumer", "by source event"], "fincoach.v2.orchestration.1", "module-owned checkpoint table with transactional compare-and-set", "B"),
  req("orchestration", "consumer_acknowledgement", "durable_required_before_extended_pilot", "sourceEventId + consumerId", "idempotencyKey", "append_only", "retain 180 days", "suppress duplicate event after restart", ["by idempotency key", "by event"], "fincoach.v2.orchestration.1", "append-only acknowledgement table", "B"),
  req("orchestration", "retry_state", "durable_required_before_extended_pilot", "sourceEventId + consumerId", "sourceEventId + consumerId + attempt", "explicit_operational_update", "retain 90 days", "continue retry budget after restart", ["pending retries", "exhausted retries"], "fincoach.v2.orchestration.1", "retry table with unique source/consumer", "B"),
  req("orchestration", "worker_lease", "durable_required_before_extended_pilot", "leaseName", "leaseName", "explicit_operational_update", "expire by ttl and retain audit 30 days", "recover stale worker leases", ["active leases", "expired leases"], "fincoach.v2.orchestration.1", "lease table using transactional compare-and-set", "B"),
  req("orchestration", "dead_letter", "durable_required_before_extended_pilot", "deadLetterId", "sourceEventId + reason", "append_only", "retain until reviewed plus 365 days", "preserve poison and terminal failures", ["unresolved critical", "by source event"], "fincoach.v2.orchestration.1", "append-only dead-letter table", "B"),
  req("pilot", "pilot_lifecycle", "durable_required_before_extended_pilot", "pilotId", "pilotId + transition", "explicit_operational_update", "retain pilot lifetime plus 365 days", "resume pilot state after restart", ["current pilot", "by state"], "fincoach.v2.demo-research-pilot.1", "pilot state table plus transition history", "B"),
  req("pilot", "pilot_scorecard", "durable_required_before_extended_pilot", "pilotId", "pilotId + scorecardVersion", "explicit_operational_update", "retain pilot lifetime plus 365 days", "restore scorecard after restart and safe stop", ["latest by pilot", "report by pilot"], "fincoach.v2.demo-research-pilot.1", "scorecard table keyed by pilot and version", "B"),
  req("operations", "daily_report", "durable_required_before_extended_pilot", "reportDate", "reportDate", "append_only", "retain 365 days", "avoid duplicate report creation after restart", ["by date", "latest reports"], "fincoach.v2.daily-research-report.1", "daily report table with unique report date", "B"),
  req("operations", "daily_report_delivery", "durable_required_before_extended_pilot", "reportId + destination", "reportId + destination + deliveryAttempt", "explicit_operational_update", "retain 365 days", "avoid duplicate delivery and preserve failed delivery", ["by report", "failed deliveries"], "fincoach.v2.daily-research-report.1", "delivery table with explicit status transition", "B"),
  req("forward-testing", "forward_test", "durable_recommended", "forwardTestId", "forwardTestId", "append_only", "retain strategy evidence lifetime", "preserve approved demo forward test evidence", ["by strategy", "by status"], "fincoach.v2.forward-test.1", "module-owned forward test table", "C"),
  req("signals", "research_signal", "durable_recommended", "signalId", "signalId", "append_only", "retain signal evidence lifetime", "preserve research-only signal and duplicate prevention", ["by symbol", "by forward test"], "fincoach.signal.v2", "module-owned signal table", "C"),
  req("external-evaluation", "external_evaluation", "durable_recommended", "evaluationId", "evaluationId", "append_only", "retain evidence lifetime", "preserve independent evaluator outcomes", ["by signal", "by outcome"], "fincoach.v2.external-evaluation.1", "module-owned evaluation table", "C"),
  req("journal", "research_journal_entry", "durable_recommended", "journalEntryId", "journalEntryId", "append_only", "retain indefinitely", "preserve institutional research evidence", ["by subject", "by createdAt"], "fincoach.v2.research-journal.1", "append-only journal table", "C"),
  req("learning", "lesson", "durable_recommended", "lessonId", "lessonId", "append_only", "retain evidence lifetime", "preserve lessons and supersession", ["by topic", "by evidence"], "fincoach.v2.learning-lesson.1", "module-owned lessons table", "C"),
  req("strategy-lifecycle", "lifecycle_decision", "durable_recommended", "decisionId", "decisionId", "append_only", "retain strategy lifetime", "preserve promotion/pause/degrade/retire history", ["by strategy", "by state"], "fincoach.v2.strategy-lifecycle.1", "append-only lifecycle table", "C"),
  req("strategy-evolution", "strategy_revision", "durable_recommended", "proposalId", "proposalId", "append_only", "retain strategy lifetime", "preserve parent-child lineage", ["by parent", "by child"], "fincoach.v2.strategy-revision.1", "module-owned revision table", "C"),
  req("courtroom", "court_verdict", "durable_recommended", "courtCaseId", "courtCaseId", "append_only", "retain strategy evidence lifetime", "preserve courtroom challenge evidence", ["by strategy", "by verdict"], "fincoach.v2.court.1", "module-owned court table", "C"),
  req("ranking", "ranking_decision", "durable_recommended", "rankingId", "rankingId", "append_only", "retain portfolio evidence lifetime", "preserve candidate ranking and selection", ["by strategy", "latest ranking"], "fincoach.v2.ranking.1", "module-owned ranking table", "C"),
  req("market-data", "normalized_market_data", "safe_to_recompute", "symbol + timeframe + timestamp", "provider + symbol + timeframe + timestamp", "append_only", "retain per market-data policy", "can reload from historical source when configured", ["by symbol/time"], "fincoach.v2.market-data.1", "existing/future market-data store", "future"),
  req("chart-analysis", "chart_analysis", "safe_to_recompute", "analysisId", "sourceDataHash", "recomputable", "cache only", "recompute deterministically from market data", ["by symbol/time"], "fincoach.v2.chart-analysis.1", "optional cache only", "not_required"),
  req("feature-engineering", "feature_vector", "safe_to_recompute", "featureSetId", "sourceDataHash + registryVersion", "recomputable", "cache only", "recompute from feature registry and source data", ["by source hash"], "fincoach.v2.features.1", "optional cache only", "not_required"),
  req("replay", "replay_cursor", "ephemeral_by_design", "workerId + replayId", "workerId + replayId", "ephemeral", "discard after replay", "replay can restart from deterministic fixture", ["active replay"], "fincoach.v2.replay.1", "no durable table required", "not_required"),
  req("reliability", "audit_chain", "durable_recommended", "auditId", "subjectId + action + payloadHash", "append_only", "retain 365 days", "verify tamper evidence after restart", ["by subject", "latest hash"], "fincoach.v2.reliability.1", "append-only audit table", "future"),
];

export function durableBeforeExtendedPilot() {
  return persistenceInventory.filter(item => item.requirement === "durable_required_before_extended_pilot");
}

function req(
  ownerModule: PersistenceRequirement["ownerModule"],
  recordType: PersistenceRequirement["recordType"],
  requirement: PersistenceRequirement["requirement"],
  naturalKey: string,
  idempotencyKey: string,
  mutability: PersistenceRequirement["mutability"],
  retentionPolicy: string,
  recoveryRequirement: string,
  queryPatterns: string[],
  schemaVersion: string,
  migrationStrategy: string,
  postgresMilestone: PersistenceRequirement["postgresMilestone"],
): PersistenceRequirement {
  return { ownerModule, recordType, requirement, naturalKey, idempotencyKey, mutability, retentionPolicy, recoveryRequirement, queryPatterns, schemaVersion, migrationStrategy, postgresMilestone };
}
