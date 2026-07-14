import { createHash, randomUUID } from "crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { DemoResearchPilotRecord, DemoResearchPilotReport, DemoResearchPilotScorecard, DemoResearchPilotState } from "./contracts";
import { classifyPostgresError, requireObject, requireSchemaVersion, V2PersistenceError } from "../persistence/errors";

const PILOT_SCHEMA_VERSION = "fincoach.v2.demo-research-pilot.1";
const PILOT_REPORT_SCHEMA_VERSION = "fincoach.v2.demo-research-pilot-report.1";

type Queryable = Pick<Pool | PoolClient, "query">;

export type PilotTransitionResult =
  | { status: "transitioned"; pilot: DemoResearchPilotRecord }
  | { status: "idempotent"; pilot: DemoResearchPilotRecord }
  | { status: "conflict"; pilot: DemoResearchPilotRecord | null };

export class PgDemoResearchPilotRepository {
  constructor(private readonly db: Queryable) {}

  async saveInitial(record: DemoResearchPilotRecord, input: { correlationId: string; causationId?: string | null }): Promise<{ inserted: boolean; pilot: DemoResearchPilotRecord }> {
    try {
      const existing = await this.get(record.pilotId);
      if (existing) return { inserted: false, pilot: existing };
      const inserted = await this.db.query(
        `INSERT INTO v2_pilot_lifecycle
          (pilot_id, schema_version, state, config, scorecard, lineage_event_ids, started_at, stopped_at, version, correlation_id, causation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11, $12)
         RETURNING *`,
        [
          record.pilotId,
          PILOT_SCHEMA_VERSION,
          record.state,
          JSON.stringify(record.config),
          JSON.stringify(record.scorecard),
          JSON.stringify(record.lineageEventIds),
          record.startedAt,
          record.stoppedAt,
          input.correlationId,
          input.causationId ?? null,
          record.startedAt ?? record.updatedAt,
          record.updatedAt,
        ],
      );
      return { inserted: true, pilot: mapPilot(inserted.rows[0]) };
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async transition(input: {
    pilotId: string;
    expectedState: DemoResearchPilotState;
    toState: DemoResearchPilotState;
    idempotencyKey: string;
    correlationId: string;
    causationId?: string | null;
    now?: string;
  }): Promise<PilotTransitionResult> {
    const client = await this.requirePoolClient();
    await client.query("BEGIN");
    try {
      const existingTransition = await client.query("SELECT * FROM v2_pilot_lifecycle_transitions WHERE idempotency_key = $1", [input.idempotencyKey]);
      if (existingTransition.rowCount) {
        const pilot = await queryPilot(client, input.pilotId);
        await client.query("COMMIT");
        return { status: "idempotent", pilot };
      }
      const current = await client.query("SELECT * FROM v2_pilot_lifecycle WHERE pilot_id = $1 FOR UPDATE", [input.pilotId]);
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return { status: "conflict", pilot: null };
      }
      const pilot = mapPilot(current.rows[0]);
      if (pilot.state !== input.expectedState) {
        await client.query("ROLLBACK");
        return { status: "conflict", pilot };
      }
      const now = input.now ?? new Date().toISOString();
      const nextVersion = Number(current.rows[0].version) + 1;
      const updated = await client.query(
        `UPDATE v2_pilot_lifecycle
         SET state = $3,
             stopped_at = CASE WHEN $3 IN ('stopped', 'failed', 'completed') THEN $4 ELSE stopped_at END,
             version = version + 1,
             correlation_id = $5,
             causation_id = $6,
             updated_at = $4
         WHERE pilot_id = $1 AND state = $2
         RETURNING *`,
        [input.pilotId, input.expectedState, input.toState, now, input.correlationId, input.causationId ?? null],
      );
      if (!updated.rowCount) throw new V2PersistenceError("optimistic_concurrency_conflict", "Pilot state changed during transition");
      await client.query(
        `INSERT INTO v2_pilot_lifecycle_transitions
          (transition_id, schema_version, pilot_id, idempotency_key, from_state, to_state, expected_version, resulting_version, correlation_id, causation_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [randomUUID(), PILOT_SCHEMA_VERSION, input.pilotId, input.idempotencyKey, input.expectedState, input.toState, nextVersion - 1, nextVersion, input.correlationId, input.causationId ?? null, now],
      );
      await client.query("COMMIT");
      return { status: "transitioned", pilot: mapPilot(updated.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw classifyPostgresError(error);
    } finally {
      client.release();
    }
  }

  async updateScorecard(input: {
    pilotId: string;
    scorecard: DemoResearchPilotScorecard;
    lineageEventIds: readonly string[];
    idempotencyKey: string;
    correlationId: string;
    causationId?: string | null;
    now?: string;
  }): Promise<DemoResearchPilotRecord> {
    const client = await this.requirePoolClient();
    await client.query("BEGIN");
    try {
      const current = await client.query("SELECT * FROM v2_pilot_lifecycle WHERE pilot_id = $1 FOR UPDATE", [input.pilotId]);
      if (!current.rowCount) throw new V2PersistenceError("persistence_integrity_failure", "Pilot not found for scorecard update");
      const pilot = mapPilot(current.rows[0]);
      const scorecardVersion = Number(current.rows[0].version) + 1;
      const now = input.now ?? new Date().toISOString();
      const lineage = [...new Set([...pilot.lineageEventIds, ...input.lineageEventIds])].sort();
      const existing = await client.query("SELECT * FROM v2_pilot_scorecards WHERE idempotency_key = $1", [input.idempotencyKey]);
      if (!existing.rowCount) {
        await client.query(
          `INSERT INTO v2_pilot_scorecards
            (scorecard_id, schema_version, pilot_id, scorecard_version, idempotency_key, scorecard, lineage_event_ids, correlation_id, causation_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [createHash("sha256").update(`${input.pilotId}:${scorecardVersion}`).digest("hex"), PILOT_SCHEMA_VERSION, input.pilotId, scorecardVersion, input.idempotencyKey, JSON.stringify(input.scorecard), JSON.stringify(lineage), input.correlationId, input.causationId ?? null, now],
        );
      }
      const updated = await client.query(
        `UPDATE v2_pilot_lifecycle
         SET scorecard = $2, lineage_event_ids = $3, version = version + 1, correlation_id = $4, causation_id = $5, updated_at = $6
         WHERE pilot_id = $1
         RETURNING *`,
        [input.pilotId, JSON.stringify(input.scorecard), JSON.stringify(lineage), input.correlationId, input.causationId ?? null, now],
      );
      await client.query("COMMIT");
      return mapPilot(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw classifyPostgresError(error);
    } finally {
      client.release();
    }
  }

  async saveReport(report: DemoResearchPilotReport, input: { correlationId: string; causationId?: string | null }): Promise<{ inserted: boolean; report: DemoResearchPilotReport }> {
    try {
      const existing = await this.db.query("SELECT * FROM v2_pilot_reports WHERE report_id = $1", [report.reportId]);
      if (existing.rowCount) return { inserted: false, report: mapPilotReport(existing.rows[0]) };
      const inserted = await this.db.query(
        `INSERT INTO v2_pilot_reports
          (report_id, schema_version, pilot_id, idempotency_key, payload, correlation_id, causation_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [report.reportId, PILOT_REPORT_SCHEMA_VERSION, report.pilotId, report.reportId, JSON.stringify(report), input.correlationId, input.causationId ?? null, report.createdAt],
      );
      return { inserted: true, report: mapPilotReport(inserted.rows[0]) };
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async get(pilotId: string): Promise<DemoResearchPilotRecord | null> {
    try {
      const result = await this.db.query("SELECT * FROM v2_pilot_lifecycle WHERE pilot_id = $1", [pilotId]);
      return result.rowCount ? mapPilot(result.rows[0]) : null;
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  async list(): Promise<DemoResearchPilotRecord[]> {
    try {
      const result = await this.db.query("SELECT * FROM v2_pilot_lifecycle ORDER BY updated_at ASC, pilot_id ASC");
      return result.rows.map(mapPilot);
    } catch (error) {
      throw classifyPostgresError(error);
    }
  }

  private async requirePoolClient(): Promise<PoolClient> {
    const maybePool = this.db as Pool;
    if (typeof maybePool.connect !== "function") {
      throw new V2PersistenceError("persistence_integrity_failure", "Transactional operation requires a pg Pool");
    }
    return maybePool.connect();
  }
}

async function queryPilot(db: Queryable, pilotId: string): Promise<DemoResearchPilotRecord> {
  const result = await db.query("SELECT * FROM v2_pilot_lifecycle WHERE pilot_id = $1", [pilotId]);
  if (!result.rowCount) throw new V2PersistenceError("persistence_integrity_failure", "Pilot disappeared during transaction");
  return mapPilot(result.rows[0]);
}

function mapPilot(row: QueryResultRow): DemoResearchPilotRecord {
  requireSchemaVersion(row.schema_version, PILOT_SCHEMA_VERSION);
  return {
    pilotId: String(row.pilot_id),
    schemaVersion: PILOT_SCHEMA_VERSION,
    state: row.state as DemoResearchPilotState,
    config: requireObject(row.config, "pilot config") as DemoResearchPilotRecord["config"],
    scorecard: requireObject(row.scorecard, "pilot scorecard") as DemoResearchPilotRecord["scorecard"],
    lineageEventIds: Array.isArray(row.lineage_event_ids) ? row.lineage_event_ids.map(String) : [],
    startedAt: row.started_at ? toIso(row.started_at) : null,
    stoppedAt: row.stopped_at ? toIso(row.stopped_at) : null,
    updatedAt: toIso(row.updated_at),
  };
}

function mapPilotReport(row: QueryResultRow): DemoResearchPilotReport {
  requireSchemaVersion(row.schema_version, PILOT_REPORT_SCHEMA_VERSION);
  return requireObject(row.payload, "pilot report") as unknown as DemoResearchPilotReport;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}
