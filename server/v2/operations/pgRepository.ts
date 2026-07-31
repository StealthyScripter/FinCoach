import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { V2DailyResearchReport, V2ResearchProgress } from "./contracts";
import type { DailyReportDeliveryRecord, DailyReportDeliveryStatus, DailyReportRecord } from "./repository";
import { classifyPostgresError, requireObject, requireSchemaVersion, V2PersistenceError } from "../persistence/errors";

const DAILY_REPORT_SCHEMA_VERSION = "fincoach.v2.daily-research-report.1";

type Queryable = Pick<Pool | PoolClient, "query">;

export type OperationsSaveResult<T> = { inserted: boolean; record: T; conflict?: "idempotent" | "conflicting" };

export class PgV2OperationsRepository {
  constructor(private readonly db: Queryable) {}

  async saveDetectorEvaluation(input: {
    evaluationId: string;
    cycleId: string;
    symbol: string;
    timeframe: string;
    detectorId: string;
    detectorVersion: string;
    strategyFamily?: string | null;
    status: "attempted" | "completed" | "skipped" | "failed" | "duplicate_suppressed";
    reason?: string | null;
    candleStart?: string | null;
    candleEnd?: string | null;
    sourceDataHash?: string | null;
    correlationId: string;
    causationId?: string | null;
    createdAt: string;
  }) {
    await this.db.query(
      `INSERT INTO v2_detector_evaluations
        (evaluation_id, schema_version, cycle_id, symbol, timeframe, detector_id, detector_version, strategy_family, status, reason, candle_start, candle_end, source_data_hash, correlation_id, causation_id, created_at)
       VALUES ($1, 'fincoach.v2.detector-evaluation.1', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (evaluation_id) DO NOTHING`,
      [input.evaluationId, input.cycleId, input.symbol, input.timeframe, input.detectorId, input.detectorVersion, input.strategyFamily ?? null, input.status, input.reason ?? null, input.candleStart ?? null, input.candleEnd ?? null, input.sourceDataHash ?? null, input.correlationId, input.causationId ?? null, input.createdAt],
    );
  }

  async researchProgress(now = new Date()): Promise<V2ResearchProgress> {
    const generatedAt = now.toISOString();
    const currentHour = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())).toISOString();
    const counts = await this.db.query(
      `SELECT
        (SELECT count(*)::int FROM v2_market_observations WHERE created_at >= $1) AS observations_current_hour,
        (SELECT count(*)::int FROM v2_market_observations WHERE created_at >= $2::timestamp - INTERVAL '24 hours') AS observations_24h,
        (SELECT count(*)::int FROM v2_market_observations WHERE created_at >= $2::timestamp - INTERVAL '7 days') AS observations_7d,
        (SELECT count(*)::int FROM v2_market_observations) AS observations_total,
        (SELECT count(*)::int FROM v2_research_hypotheses) AS hypotheses,
        (SELECT count(*)::int FROM v2_strategy_definitions) AS strategies,
        (SELECT count(*)::int FROM v2_research_experiments) AS experiments,
        (SELECT count(*)::int FROM v2_backtest_results) AS backtests,
        (SELECT count(*)::int FROM v2_court_verdicts) AS verdicts,
        (SELECT count(*)::int FROM v2_ranking_decisions) AS ranked_candidates,
        (SELECT count(*)::int FROM v2_forward_tests) AS forward_tests,
        (SELECT count(*)::int FROM v2_research_signals) AS signals,
        (SELECT count(*)::int FROM v2_external_evaluations) AS evaluations,
        (SELECT count(*)::int FROM v2_research_journal_entries) AS journal_entries,
        (SELECT count(*)::int FROM v2_learning_lessons) AS lessons,
        (SELECT count(*)::int FROM v2_strategy_lifecycle_decisions) AS lifecycle_decisions,
        (SELECT count(*)::int FROM v2_pilot_scorecards) AS pilot_scorecards,
        (SELECT count(*)::int FROM v2_detector_evaluations WHERE created_at >= $1) AS evaluations_records_hour,
        (SELECT count(*)::int FROM v2_detector_evaluations WHERE created_at >= $1 AND status = 'attempted') AS evaluations_attempted_hour,
        (SELECT count(*)::int FROM v2_detector_evaluations WHERE created_at >= $1 AND status = 'completed') AS evaluations_completed_hour,
        (SELECT count(*)::int FROM v2_detector_evaluations WHERE created_at >= $1 AND status = 'duplicate_suppressed') AS duplicates_suppressed_hour,
        (SELECT count(*)::int FROM v2_detector_evaluations WHERE created_at >= $1 AND status = 'failed') AS failures_hour,
        (SELECT max(candle_end) FROM v2_market_observations) AS most_recent_market_data_timestamp`,
      [currentHour, generatedAt],
    );
    const row = counts.rows[0] ?? {};
    const grouped = await this.db.query(
      `SELECT 'symbol' AS kind, COALESCE(symbol, 'unknown') AS value, count(*)::int AS count FROM v2_market_observations GROUP BY symbol
       UNION ALL
       SELECT 'timeframe', COALESCE(timeframe, 'unknown'), count(*)::int FROM v2_market_observations GROUP BY timeframe
       UNION ALL
       SELECT 'detector', COALESCE(detector_id, 'unknown'), count(*)::int FROM v2_market_observations GROUP BY detector_id
       UNION ALL
       SELECT 'strategyFamily', COALESCE(strategy_family, 'unknown'), count(*)::int FROM v2_market_observations GROUP BY strategy_family`,
    );
    const byKind = (kind: string) => grouped.rows.filter(item => item.kind === kind).map(item => ({ value: String(item.value), count: Number(item.count) }));
    const latestCycle = await this.db.query("SELECT * FROM v2_orchestration_cycles WHERE status = 'completed' ORDER BY updated_at DESC LIMIT 1");
    return {
      schemaVersion: "fincoach.v2.research-progress.1",
      status: "ok",
      generatedAt,
      runtime: { latestCompletedCycle: latestCycle.rows[0] ?? null },
      windows: {
        currentHour: { observations: Number(row.observations_current_hour ?? 0), startsAt: currentHour },
        running24Hours: { observations: Number(row.observations_24h ?? 0) },
        running7Days: { observations: Number(row.observations_7d ?? 0) },
        total: { observations: Number(row.observations_total ?? 0) },
      },
      coverage: { symbols: byKind("symbol"), timeframes: byKind("timeframe"), detectors: byKind("detector"), strategyFamilies: byKind("strategyFamily"), mostRecentMarketDataTimestamp: toIsoOrNull(row.most_recent_market_data_timestamp) },
      pipeline: {
        observations: Number(row.observations_total ?? 0),
        hypotheses: Number(row.hypotheses ?? 0),
        strategies: Number(row.strategies ?? 0),
        experiments: Number(row.experiments ?? 0),
        backtests: Number(row.backtests ?? 0),
        verdicts: Number(row.verdicts ?? 0),
        rankedCandidates: Number(row.ranked_candidates ?? 0),
        forwardTests: Number(row.forward_tests ?? 0),
        signals: Number(row.signals ?? 0),
        evaluations: Number(row.evaluations ?? 0),
        journalEntries: Number(row.journal_entries ?? 0),
        lessons: Number(row.lessons ?? 0),
        lifecycleDecisions: Number(row.lifecycle_decisions ?? 0),
        pilotScorecards: Number(row.pilot_scorecards ?? 0),
        detectorEvaluations: { recordsCurrentHour: Number(row.evaluations_records_hour ?? 0), attemptedCurrentHour: Number(row.evaluations_attempted_hour ?? 0), completedCurrentHour: Number(row.evaluations_completed_hour ?? 0), duplicatesSuppressedCurrentHour: Number(row.duplicates_suppressed_hour ?? 0), failuresCurrentHour: Number(row.failures_hour ?? 0) },
      },
      readiness: readinessFromCounts(row),
    };
  }

  async researchBlockers(now = new Date()) {
    const progress = await this.researchProgress(now);
    const blockers = deriveBlockers(progress, now);
    return {
      schemaVersion: "fincoach.v2.research-blockers.1",
      generatedAt: now.toISOString(),
      highestSeverity: blockers.some(item => item.severity === "critical") ? "critical" : blockers.some(item => item.severity === "warning") ? "warning" : "info",
      blockers,
    };
  }

  async saveReport(record: DailyReportRecord): Promise<OperationsSaveResult<DailyReportRecord>> {
    try {
      const existing = await this.db.query("SELECT * FROM v2_operations_daily_reports WHERE report_date = $1 OR idempotency_key = $2", [
        record.report.reportDate,
        record.report.reportDate,
      ]);
      if (existing.rowCount) {
        const current = mapReport(existing.rows[0]);
        if (current.report.reportId === record.report.reportId) return { inserted: false, record: current, conflict: "idempotent" };
        return { inserted: false, record: current, conflict: "conflicting" };
      }
      const inserted = await this.db.query(
        `INSERT INTO v2_operations_daily_reports
          (report_id, schema_version, report_date, idempotency_key, status, payload, correlation_id, causation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [record.report.reportId, DAILY_REPORT_SCHEMA_VERSION, record.report.reportDate, record.status, JSON.stringify(record.report), record.correlationId, record.causationId, record.createdAt, record.updatedAt],
      );
      return { inserted: true, record: mapReport(inserted.rows[0]) };
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async getReportByDate(reportDate: string): Promise<DailyReportRecord | null> {
    try {
      const result = await this.db.query("SELECT * FROM v2_operations_daily_reports WHERE report_date = $1", [reportDate]);
      return result.rowCount ? mapReport(result.rows[0]) : null;
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async latestReport(): Promise<DailyReportRecord | null> {
    try {
      const result = await this.db.query("SELECT * FROM v2_operations_daily_reports ORDER BY created_at DESC, report_id DESC LIMIT 1");
      return result.rowCount ? mapReport(result.rows[0]) : null;
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async saveDelivery(record: DailyReportDeliveryRecord): Promise<OperationsSaveResult<DailyReportDeliveryRecord>> {
    try {
      if (record.status === "ambiguous") {
        throw new V2PersistenceError("persistence_integrity_failure", "Ambiguous delivery cannot be recorded as delivered");
      }
      const existing = await this.db.query("SELECT * FROM v2_operations_daily_report_deliveries WHERE idempotency_key = $1 OR (report_id = $2 AND destination = $3 AND delivery_attempt = $4)", [
        record.idempotencyKey,
        record.reportId,
        record.destination,
        record.deliveryAttempt,
      ]);
      if (existing.rowCount) {
        const current = mapDelivery(existing.rows[0]);
        if (current.idempotencyKey === record.idempotencyKey && current.status === record.status) return { inserted: false, record: current, conflict: "idempotent" };
        return { inserted: false, record: current, conflict: "conflicting" };
      }
      const inserted = await this.db.query(
        `INSERT INTO v2_operations_daily_report_deliveries
          (delivery_id, schema_version, report_id, destination, delivery_attempt, idempotency_key, status, error_code, error_message, correlation_id, causation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          record.deliveryId,
          DAILY_REPORT_SCHEMA_VERSION,
          record.reportId,
          record.destination,
          record.deliveryAttempt,
          record.idempotencyKey,
          record.status,
          record.errorCode,
          record.errorMessage,
          record.correlationId,
          record.causationId,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return { inserted: true, record: mapDelivery(inserted.rows[0]) };
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async deliveriesForReport(reportId: string): Promise<DailyReportDeliveryRecord[]> {
    try {
      const result = await this.db.query("SELECT * FROM v2_operations_daily_report_deliveries WHERE report_id = $1 ORDER BY delivery_attempt ASC, destination ASC", [reportId]);
      return result.rows.map(mapDelivery);
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }
}

function mapReport(row: QueryResultRow): DailyReportRecord {
  requireSchemaVersion(row.schema_version, DAILY_REPORT_SCHEMA_VERSION);
  const report = requireObject(row.payload, "daily report") as unknown as V2DailyResearchReport;
  if (report.schemaVersion !== DAILY_REPORT_SCHEMA_VERSION || report.reportId !== row.report_id || report.reportDate !== row.report_date) {
    throw new V2PersistenceError("malformed_persisted_record", "Daily report payload does not match row identity");
  }
  return {
    report,
    status: row.status,
    correlationId: String(row.correlation_id),
    causationId: row.causation_id ? String(row.causation_id) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapDelivery(row: QueryResultRow): DailyReportDeliveryRecord {
  requireSchemaVersion(row.schema_version, DAILY_REPORT_SCHEMA_VERSION);
  return {
    deliveryId: String(row.delivery_id),
    reportId: String(row.report_id),
    destination: String(row.destination),
    deliveryAttempt: Number(row.delivery_attempt),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as DailyReportDeliveryStatus,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    correlationId: String(row.correlation_id),
    causationId: row.causation_id ? String(row.causation_id) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  return toIso(value);
}

function readinessFromCounts(row: Record<string, unknown>) {
  const stages = [
    ["lifecycle decision", Number(row.lifecycle_decisions ?? 0) > 0, "research lifecycle complete"],
    ["lesson", Number(row.lessons ?? 0) > 0, "lifecycle decision"],
    ["journal entry", Number(row.journal_entries ?? 0) > 0, "lesson"],
    ["evaluation", Number(row.evaluations ?? 0) > 0, "journal entry"],
    ["signal", Number(row.signals ?? 0) > 0, "evaluation"],
    ["forward test", Number(row.forward_tests ?? 0) > 0, "signal"],
    ["ranked candidate", Number(row.ranked_candidates ?? 0) > 0, "forward-test eligible"],
    ["verdict", Number(row.verdicts ?? 0) > 0, "ranked candidate"],
    ["backtest", Number(row.backtests ?? 0) > 0, "verdict"],
    ["experiment", Number(row.experiments ?? 0) > 0, "backtest"],
    ["strategy", Number(row.strategies ?? 0) > 0, "experiment"],
    ["hypothesis", Number(row.hypotheses ?? 0) > 0, "strategy"],
    ["observation", Number(row.observations_total ?? 0) > 0, "hypothesis"],
  ] as const;
  const currentStage = stages.find(([, present]) => present);
  const current = currentStage?.[0] ?? "no durable research artifacts";
  const next = currentStage?.[2] ?? "observation";
  return { currentStage: current, nextStage: next, liveExecutionBlocked: true as const, paperExecutionState: "disabled_or_gated", demoExecutionState: "demo_only_gated" };
}

function deriveBlockers(progress: Awaited<ReturnType<PgV2OperationsRepository["researchProgress"]>>, now: Date) {
  const at = now.toISOString();
  const pipeline = progress.pipeline as Record<string, number | Record<string, number>>;
  const mk = (severity: "info" | "warning" | "critical", code: string, phase: string, reason: string, currentValue: unknown, requiredValue: unknown, recommendedAction: string) => ({ code, severity, phase, reason, currentValue, requiredValue, recommendedAction, firstObservedAt: at, lastObservedAt: at });
  const blockers = [];
  if (Number(pipeline.observations ?? 0) === 0) blockers.push(mk("critical", "no_observations", "observations", "No persisted observations exist.", 0, "> 0", "Run a bounded research cycle with complete candle data."));
  if (Number(pipeline.hypotheses ?? 0) === 0) blockers.push(mk("critical", "no_hypotheses", "hypothesis", "No hypotheses have been created from independent observations.", 0, "> 0", "Collect at least two independent observations with complete lineage."));
  if (Number(pipeline.strategies ?? 0) === 0) blockers.push(mk("critical", "no_strategy_rules", "rules", "No strategy rules have been compiled.", 0, "> 0", "Create hypotheses that pass evidence policy."));
  if (Number(pipeline.experiments ?? 0) === 0) blockers.push(mk("warning", "no_experiments", "experiments", "No experiments are queued.", 0, "> 0", "Allow bounded experiment creation after rule compilation."));
  if (Number(pipeline.backtests ?? 0) === 0) blockers.push(mk("critical", "no_backtests", "backtesting", "No backtests have completed.", 0, "> 0", "Run bounded backtests against synthetic or historical demo data."));
  if (Number(pipeline.verdicts ?? 0) === 0) blockers.push(mk("critical", "no_verdicts", "courtroom", "No courtroom verdicts exist.", 0, "> 0", "Submit completed backtests to courtroom review."));
  if (Number(pipeline.rankedCandidates ?? 0) === 0) blockers.push(mk("warning", "no_ranked_candidates", "ranking", "No candidates are ranked.", 0, "> 0", "Rank candidates after acceptable verdicts."));
  blockers.push(mk("info", "live_execution_blocked", "safety", "Live execution remains blocked by design.", true, true, "Keep live disabled until all promotion and human approval gates pass."));
  return blockers;
}
