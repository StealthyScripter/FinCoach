import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/0001_marketpilot_core.sql", "utf-8");

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

console.log("schema migration smoke tests passed");
