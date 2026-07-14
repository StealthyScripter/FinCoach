import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { V2DailyResearchReport } from "./contracts";
import type { DailyReportDeliveryRecord, DailyReportDeliveryStatus, DailyReportRecord } from "./repository";
import { classifyPostgresError, requireObject, requireSchemaVersion, V2PersistenceError } from "../persistence/errors";

const DAILY_REPORT_SCHEMA_VERSION = "fincoach.v2.daily-research-report.1";

type Queryable = Pick<Pool | PoolClient, "query">;

export type OperationsSaveResult<T> = { inserted: boolean; record: T; conflict?: "idempotent" | "conflicting" };

export class PgV2OperationsRepository {
  constructor(private readonly db: Queryable) {}

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
