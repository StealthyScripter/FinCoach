import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/0001_marketpilot_core.sql", "utf-8");
const reliabilityMigration = readFileSync("migrations/0002_execution_reliability.sql", "utf-8");
const governanceMigration = readFileSync("migrations/0003_execution_governance.sql", "utf-8");
const memoryMigration = readFileSync("migrations/0004_memory_persistence.sql", "utf-8");
const vectorMigration = readFileSync("migrations/0005_vector_persistence.sql", "utf-8");
const ragMigration = readFileSync("migrations/0006_rag_corpus_persistence.sql", "utf-8");
const aiEvaluationMigration = readFileSync("migrations/0007_ai_evaluations_persistence.sql", "utf-8");
const timeSeriesMigration = readFileSync("migrations/0009_time_series_persistence.sql", "utf-8");

const requiredTables = [
  "users",
  "proficiency_scores",
  "learning_modules",
  "quiz_results",
  "verification_checks",
  "research_reports",
  "agent_outputs",
  "market_prices",
  "economic_events",
  "news_articles",
  "risk_rules",
  "risk_settings",
  "risk_checks",
  "paper_portfolios",
  "holdings",
  "trade_tickets",
  "journal_entries",
  "journal_reviews",
  "audit_logs",
  "alerts",
  "order_previews",
  "broker_connections",
  "compliance_profiles",
];

for (const table of requiredTables) {
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"),
    `missing migration table ${table}`,
  );
}

for (const index of [
  "idx_trade_tickets_status",
  "idx_quiz_results_user_id",
  "idx_agent_outputs_agent",
  "idx_market_prices_symbol_observed_at",
  "idx_economic_events_starts_at",
  "idx_news_articles_published_at",
  "idx_risk_settings_user_id",
  "idx_journal_entries_user_id",
  "idx_journal_reviews_journal_entry_id",
  "idx_audit_logs_target",
  "idx_alerts_status",
  "idx_order_previews_trade_ticket_id",
  "idx_broker_connections_user_id",
  "idx_compliance_profiles_user_id",
]) {
  assert.match(migration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}\\b`, "i"));
}

for (const column of [
  "label text NOT NULL",
  "unlocks jsonb NOT NULL",
  "supporting_evidence jsonb NOT NULL",
  "portfolio_impact text NOT NULL",
  "alternative_choices jsonb NOT NULL",
  "exit_criteria text NOT NULL",
  "invalidation_condition text NOT NULL",
  "related_assets jsonb NOT NULL",
  "related_symbols jsonb NOT NULL",
  "max_risk_per_trade_pct real NOT NULL",
  "no_trade_before_high_impact_event_hours integer NOT NULL",
  "disclosures_accepted boolean NOT NULL",
  "disclosure_version text NOT NULL",
]) {
  assert.match(migration, new RegExp(column.replaceAll(" ", "\\s+"), "i"));
}

for (const table of [
  "execution_submission_idempotency",
  "execution_strategy_leases",
  "execution_reconciliation_reports",
]) {
  assert.match(reliabilityMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
}

for (const index of [
  "idx_execution_submission_status",
  "idx_execution_strategy_leases_expires_at",
  "idx_execution_reconciliation_provider_time",
]) {
  assert.match(reliabilityMigration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}\\b`, "i"));
}

assert.match(reliabilityMigration, /BEGIN;/i);
assert.match(reliabilityMigration, /COMMIT;/i);

for (const table of [
  "semi_autonomous_approvals",
  "execution_audit_exports",
  "marketpilot_events",
  "execution_audit_entries",
]) {
  assert.match(governanceMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
}
for (const index of [
  "idx_semi_autonomous_approvals_status_expiry",
  "idx_execution_audit_exports_generated_at",
  "idx_marketpilot_events_created_at",
  "idx_marketpilot_events_correlation",
  "idx_execution_audit_entries_created_at",
  "idx_execution_audit_entries_correlation",
]) {
  assert.match(governanceMigration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}\\b`, "i"));
}
assert.match(governanceMigration, /archive_location\s+text/i);
assert.match(governanceMigration, /BEGIN;/i);
assert.match(governanceMigration, /COMMIT;/i);

for (const table of [
  "memory_records",
]) {
  assert.match(memoryMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
}
assert.match(memoryMigration, /idx_memory_records_user_scope_created_at/i);
assert.match(memoryMigration, /BEGIN;/i);
assert.match(memoryMigration, /COMMIT;/i);

for (const table of [
  "vector_records",
]) {
  assert.match(vectorMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
}
assert.match(vectorMigration, /idx_vector_records_text/i);
assert.match(vectorMigration, /BEGIN;/i);
assert.match(vectorMigration, /COMMIT;/i);

for (const table of [
  "rag_runs",
  "rag_documents",
]) {
  assert.match(ragMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
}
for (const index of [
  "idx_rag_runs_user_created_at",
  "idx_rag_documents_run_id",
  "idx_rag_documents_user_created_at",
]) {
  assert.match(ragMigration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}\\b`, "i"));
}
assert.match(ragMigration, /BEGIN;/i);
assert.match(ragMigration, /COMMIT;/i);

for (const table of [
  "ai_evaluations",
]) {
  assert.match(aiEvaluationMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
}
for (const index of [
  "idx_ai_evaluations_user_generated_at",
  "idx_ai_evaluations_artifact_id",
]) {
  assert.match(aiEvaluationMigration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}\\b`, "i"));
}
assert.match(aiEvaluationMigration, /BEGIN;/i);
assert.match(aiEvaluationMigration, /COMMIT;/i);

for (const table of [
  "time_series_price_bars",
  "time_series_economic_observations",
  "time_series_options_snapshots",
  "time_series_ingestion_runs",
]) {
  assert.match(timeSeriesMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
}
for (const index of [
  "idx_time_series_price_bars_symbol_timestamp",
  "idx_time_series_economic_observations_series_timestamp",
  "idx_time_series_options_snapshots_underlying_timestamp",
  "idx_time_series_ingestion_runs_completed_at",
]) {
  assert.match(timeSeriesMigration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}\\b`, "i"));
}
assert.match(timeSeriesMigration, /BEGIN;/i);
assert.match(timeSeriesMigration, /COMMIT;/i);

console.log("schema migration smoke tests passed");
