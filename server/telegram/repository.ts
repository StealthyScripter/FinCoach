import { randomUUID } from "crypto";
import { Pool } from "pg";
import type {
  TelegramCommandAuditRecord,
  TelegramDeliveryRecord,
  TelegramSchedulerRunRecord,
  TelegramSignalLifecycleUpdate,
  TelegramSignalRecord,
  TelegramSummaryRecord,
} from "./contracts";

export interface TelegramRepository {
  saveDelivery(record: TelegramDeliveryRecord): Promise<TelegramDeliveryRecord>;
  updateDelivery(record: TelegramDeliveryRecord): Promise<TelegramDeliveryRecord>;
  listDeliveries(limit?: number): Promise<TelegramDeliveryRecord[]>;
  saveSignal(record: TelegramSignalRecord): Promise<TelegramSignalRecord>;
  updateSignal(record: TelegramSignalRecord): Promise<TelegramSignalRecord>;
  getSignal(signalId: string): Promise<TelegramSignalRecord | null>;
  findSignalByFingerprint(fingerprint: string): Promise<TelegramSignalRecord | null>;
  listSignals(limit?: number): Promise<TelegramSignalRecord[]>;
  saveSignalUpdate(record: TelegramSignalLifecycleUpdate): Promise<TelegramSignalLifecycleUpdate>;
  listSignalUpdates(signalId: string): Promise<TelegramSignalLifecycleUpdate[]>;
  saveSummary(record: TelegramSummaryRecord): Promise<TelegramSummaryRecord>;
  listSummaries(period?: "daily" | "weekly", limit?: number): Promise<TelegramSummaryRecord[]>;
  saveSchedulerRun(record: TelegramSchedulerRunRecord): Promise<TelegramSchedulerRunRecord>;
  completeSchedulerRun(id: string, status: TelegramSchedulerRunRecord["status"], details?: Record<string, unknown>): Promise<void>;
  saveCommandAudit(record: TelegramCommandAuditRecord): Promise<TelegramCommandAuditRecord>;
  latestLifecycleHeartbeat(): Promise<{ heartbeatAt: string; cleanShutdown: boolean; processId: string | null } | null>;
  saveLifecycleState(input: { processId: string; heartbeatAt: string; cleanShutdown: boolean; startedAt: string; stoppedAt?: string | null }): Promise<void>;
  health(): { provider: "memory" | "postgres"; status: "healthy" | "disabled"; records: number };
}

export class InMemoryTelegramRepository implements TelegramRepository {
  private deliveries: TelegramDeliveryRecord[] = [];
  private signals = new Map<string, TelegramSignalRecord>();
  private signalUpdates: TelegramSignalLifecycleUpdate[] = [];
  private summaries: TelegramSummaryRecord[] = [];
  private schedulerRuns = new Map<string, TelegramSchedulerRunRecord>();
  private commands: TelegramCommandAuditRecord[] = [];
  private lifecycle: { heartbeatAt: string; cleanShutdown: boolean; processId: string | null; startedAt: string; stoppedAt?: string | null } | null = null;

  async saveDelivery(record: TelegramDeliveryRecord) {
    this.deliveries.push(record);
    return record;
  }

  async updateDelivery(record: TelegramDeliveryRecord) {
    const index = this.deliveries.findIndex((item) => item.id === record.id);
    if (index >= 0) this.deliveries[index] = record;
    else this.deliveries.push(record);
    return record;
  }

  async listDeliveries(limit = 100) {
    return [...this.deliveries].sort(desc("createdAt")).slice(0, limit);
  }

  async saveSignal(record: TelegramSignalRecord) {
    this.signals.set(record.signalId, record);
    return record;
  }

  async updateSignal(record: TelegramSignalRecord) {
    this.signals.set(record.signalId, record);
    return record;
  }

  async getSignal(signalId: string) {
    return this.signals.get(signalId) ?? null;
  }

  async findSignalByFingerprint(fingerprint: string) {
    return Array.from(this.signals.values()).find((signal) => signal.fingerprint === fingerprint) ?? null;
  }

  async listSignals(limit = 100) {
    return Array.from(this.signals.values()).sort(desc("lastUpdateAt")).slice(0, limit);
  }

  async saveSignalUpdate(record: TelegramSignalLifecycleUpdate) {
    this.signalUpdates.push(record);
    return record;
  }

  async listSignalUpdates(signalId: string) {
    return this.signalUpdates.filter((item) => item.signalId === signalId).sort(desc("createdAt"));
  }

  async saveSummary(record: TelegramSummaryRecord) {
    this.summaries.push(record);
    return record;
  }

  async listSummaries(period?: "daily" | "weekly", limit = 30) {
    return this.summaries.filter((item) => !period || item.period === period).sort(desc("createdAt")).slice(0, limit);
  }

  async saveSchedulerRun(record: TelegramSchedulerRunRecord) {
    this.schedulerRuns.set(record.id, record);
    return record;
  }

  async completeSchedulerRun(id: string, status: TelegramSchedulerRunRecord["status"], details: Record<string, unknown> = {}) {
    const run = this.schedulerRuns.get(id);
    if (run) this.schedulerRuns.set(id, { ...run, status, details: { ...run.details, ...details }, completedAt: new Date().toISOString() });
  }

  async saveCommandAudit(record: TelegramCommandAuditRecord) {
    this.commands.push(record);
    return record;
  }

  async latestLifecycleHeartbeat() {
    return this.lifecycle ? { heartbeatAt: this.lifecycle.heartbeatAt, cleanShutdown: this.lifecycle.cleanShutdown, processId: this.lifecycle.processId } : null;
  }

  async saveLifecycleState(input: { processId: string; heartbeatAt: string; cleanShutdown: boolean; startedAt: string; stoppedAt?: string | null }) {
    this.lifecycle = input;
  }

  health() {
    return { provider: "memory" as const, status: "healthy" as const, records: this.deliveries.length + this.signals.size + this.summaries.length };
  }
}

export class PgTelegramRepository implements TelegramRepository {
  private readonly pool: Pool | null;
  private records = 0;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  }

  async saveDelivery(record: TelegramDeliveryRecord) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO telegram_deliveries
       (id, kind, destination, chat_id_redacted, status, text_hash, message_id, error_code, error_message, retry_after_seconds, attempt_count, latency_ms, correlation_id, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, message_id = EXCLUDED.message_id, error_code = EXCLUDED.error_code, error_message = EXCLUDED.error_message, retry_after_seconds = EXCLUDED.retry_after_seconds, attempt_count = EXCLUDED.attempt_count, latency_ms = EXCLUDED.latency_ms, metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at`,
      deliveryValues(record),
    );
    this.records += 1;
    return record;
  }

  async updateDelivery(record: TelegramDeliveryRecord) {
    return this.saveDelivery(record);
  }

  async listDeliveries(limit = 100) {
    if (!this.pool) return [];
    const rows = await this.pool.query(`SELECT * FROM telegram_deliveries ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows.rows.map(rowToDelivery);
  }

  async saveSignal(record: TelegramSignalRecord) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO telegram_signals
       (signal_id, schema, fingerprint, idempotency_key, status, symbol, payload, human_message, rejection_reasons, published_at, expires_at, last_update_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13::jsonb)
       ON CONFLICT (signal_id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, human_message = EXCLUDED.human_message, rejection_reasons = EXCLUDED.rejection_reasons, published_at = EXCLUDED.published_at, expires_at = EXCLUDED.expires_at, last_update_at = EXCLUDED.last_update_at, metadata = EXCLUDED.metadata`,
      [
        record.signalId,
        record.schema,
        record.fingerprint,
        record.idempotencyKey,
        record.status,
        record.symbol,
        JSON.stringify(record.payload),
        record.humanMessage,
        JSON.stringify(record.rejectionReasons),
        record.publishedAt,
        record.expiresAt,
        record.lastUpdateAt,
        JSON.stringify(record.metadata),
      ],
    );
    this.records += 1;
    return record;
  }

  async updateSignal(record: TelegramSignalRecord) {
    return this.saveSignal(record);
  }

  async getSignal(signalId: string) {
    if (!this.pool) return null;
    const rows = await this.pool.query(`SELECT * FROM telegram_signals WHERE signal_id = $1 LIMIT 1`, [signalId]);
    return rows.rows[0] ? rowToSignal(rows.rows[0]) : null;
  }

  async findSignalByFingerprint(fingerprint: string) {
    if (!this.pool) return null;
    const rows = await this.pool.query(`SELECT * FROM telegram_signals WHERE fingerprint = $1 ORDER BY last_update_at DESC LIMIT 1`, [fingerprint]);
    return rows.rows[0] ? rowToSignal(rows.rows[0]) : null;
  }

  async listSignals(limit = 100) {
    if (!this.pool) return [];
    const rows = await this.pool.query(`SELECT * FROM telegram_signals ORDER BY last_update_at DESC LIMIT $1`, [limit]);
    return rows.rows.map(rowToSignal);
  }

  async saveSignalUpdate(record: TelegramSignalLifecycleUpdate) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO telegram_signal_updates (id, signal_id, outcome, message, result_r, demo_pnl, lesson, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.signalId, record.outcome, record.message, record.resultR, record.demoPnl, record.lesson, record.createdAt],
    );
    return record;
  }

  async listSignalUpdates(signalId: string) {
    if (!this.pool) return [];
    const rows = await this.pool.query(`SELECT * FROM telegram_signal_updates WHERE signal_id = $1 ORDER BY created_at DESC`, [signalId]);
    return rows.rows.map((row) => ({
      id: String(row.id),
      signalId: String(row.signal_id),
      outcome: row.outcome,
      message: String(row.message),
      resultR: row.result_r === null ? null : Number(row.result_r),
      demoPnl: row.demo_pnl === null ? null : Number(row.demo_pnl),
      lesson: row.lesson === null ? null : String(row.lesson),
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async saveSummary(record: TelegramSummaryRecord) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO telegram_summaries (id, period, summary_date, concise_message, report, delivery_id, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.period, record.summaryDate, record.conciseMessage, JSON.stringify(record.report), record.deliveryId, record.createdAt],
    );
    return record;
  }

  async listSummaries(period?: "daily" | "weekly", limit = 30) {
    if (!this.pool) return [];
    const rows = await this.pool.query(
      `SELECT * FROM telegram_summaries WHERE ($1::text IS NULL OR period = $1) ORDER BY created_at DESC LIMIT $2`,
      [period ?? null, limit],
    );
    return rows.rows.map((row) => ({
      id: String(row.id),
      period: row.period,
      summaryDate: String(row.summary_date),
      conciseMessage: String(row.concise_message),
      report: row.report ?? {},
      deliveryId: row.delivery_id ? String(row.delivery_id) : null,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async saveSchedulerRun(record: TelegramSchedulerRunRecord) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO telegram_scheduler_runs (id, job_name, status, lease_key, details, started_at, completed_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, details = EXCLUDED.details, completed_at = EXCLUDED.completed_at`,
      [record.id, record.jobName, record.status, record.leaseKey, JSON.stringify(record.details), record.startedAt, record.completedAt],
    );
    return record;
  }

  async completeSchedulerRun(id: string, status: TelegramSchedulerRunRecord["status"], details: Record<string, unknown> = {}) {
    if (!this.pool) return;
    await this.pool.query(
      `UPDATE telegram_scheduler_runs SET status = $2, details = details || $3::jsonb, completed_at = $4 WHERE id = $1`,
      [id, status, JSON.stringify(details), new Date().toISOString()],
    );
  }

  async saveCommandAudit(record: TelegramCommandAuditRecord) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO telegram_command_audit (id, command, actor_id_redacted, chat_id_redacted, authorized, outcome, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [record.id, record.command, record.actorIdRedacted, record.chatIdRedacted, record.authorized, record.outcome, record.reason, record.createdAt],
    );
    return record;
  }

  async latestLifecycleHeartbeat() {
    if (!this.pool) return null;
    const rows = await this.pool.query(`SELECT * FROM telegram_lifecycle_state ORDER BY started_at DESC LIMIT 1`);
    const row = rows.rows[0];
    return row ? { heartbeatAt: new Date(row.heartbeat_at).toISOString(), cleanShutdown: Boolean(row.clean_shutdown), processId: row.process_id ? String(row.process_id) : null } : null;
  }

  async saveLifecycleState(input: { processId: string; heartbeatAt: string; cleanShutdown: boolean; startedAt: string; stoppedAt?: string | null }) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO telegram_lifecycle_state (id, process_id, heartbeat_at, clean_shutdown, started_at, stopped_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (process_id) DO UPDATE SET heartbeat_at = EXCLUDED.heartbeat_at, clean_shutdown = EXCLUDED.clean_shutdown, stopped_at = EXCLUDED.stopped_at`,
      [input.processId, input.processId, input.heartbeatAt, input.cleanShutdown, input.startedAt, input.stoppedAt ?? null],
    );
  }

  health() {
    return { provider: "postgres" as const, status: this.pool ? "healthy" as const : "disabled" as const, records: this.records };
  }
}

export const telegramRepository: TelegramRepository = process.env.DATABASE_URL ? new PgTelegramRepository() : new InMemoryTelegramRepository();

export function createSchedulerRun(jobName: string, details: Record<string, unknown> = {}): TelegramSchedulerRunRecord {
  const now = new Date().toISOString();
  return { id: randomUUID(), jobName, status: "started", leaseKey: null, details, startedAt: now, completedAt: null };
}

function deliveryValues(record: TelegramDeliveryRecord) {
  return [
    record.id,
    record.kind,
    record.destination,
    record.chatIdRedacted,
    record.status,
    record.textHash,
    record.messageId,
    record.errorCode,
    record.errorMessage,
    record.retryAfterSeconds,
    record.attemptCount,
    record.latencyMs,
    record.correlationId,
    JSON.stringify(record.metadata),
    record.createdAt,
    record.updatedAt,
  ];
}

function rowToDelivery(row: Record<string, unknown>): TelegramDeliveryRecord {
  return {
    id: String(row.id),
    kind: row.kind as TelegramDeliveryRecord["kind"],
    destination: row.destination as TelegramDeliveryRecord["destination"],
    chatIdRedacted: row.chat_id_redacted ? String(row.chat_id_redacted) : null,
    status: row.status as TelegramDeliveryRecord["status"],
    textHash: String(row.text_hash),
    messageId: row.message_id ? String(row.message_id) : null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    retryAfterSeconds: row.retry_after_seconds === null ? null : Number(row.retry_after_seconds),
    attemptCount: Number(row.attempt_count),
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    correlationId: String(row.correlation_id),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function rowToSignal(row: Record<string, unknown>): TelegramSignalRecord {
  return {
    signalId: String(row.signal_id),
    schema: "fincoach.signal.v1",
    fingerprint: String(row.fingerprint),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as TelegramSignalRecord["status"],
    symbol: String(row.symbol),
    payload: row.payload as TelegramSignalRecord["payload"],
    humanMessage: String(row.human_message),
    rejectionReasons: Array.isArray(row.rejection_reasons) ? row.rejection_reasons as string[] : [],
    publishedAt: row.published_at ? new Date(row.published_at as string).toISOString() : null,
    expiresAt: new Date(row.expires_at as string).toISOString(),
    lastUpdateAt: new Date(row.last_update_at as string).toISOString(),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

function desc<T extends Record<string, unknown>>(key: keyof T) {
  return (left: T, right: T) => String(right[key]).localeCompare(String(left[key]));
}
