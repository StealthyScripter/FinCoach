import { randomUUID } from "crypto";
import { Pool } from "pg";
import type {
  TelegramCommandAuditRecord,
  TelegramDeliveryRecord,
  MarketSnapshotRecord,
  TelegramSchedulerRunRecord,
  TelegramSignalLifecycleUpdate,
  TelegramSignalRecord,
  TelegramSummaryRecord,
  WeeklySessionNotificationRecord,
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
  findSummaryByPeriodAndDate(period: "daily" | "weekly", summaryDate: string): Promise<TelegramSummaryRecord | null>;
  markSummaryDelivered(id: string, deliveryId: string): Promise<TelegramSummaryRecord | null>;
  listSummaries(period?: "daily" | "weekly", limit?: number): Promise<TelegramSummaryRecord[]>;
  saveSchedulerRun(record: TelegramSchedulerRunRecord): Promise<TelegramSchedulerRunRecord>;
  completeSchedulerRun(id: string, status: TelegramSchedulerRunRecord["status"], details?: Record<string, unknown>): Promise<void>;
  saveCommandAudit(record: TelegramCommandAuditRecord): Promise<TelegramCommandAuditRecord>;
  loadUpdateCursor(transport: string): Promise<number | null>;
  saveUpdateCursor(transport: string, updateId: number): Promise<void>;
  latestLifecycleHeartbeat(): Promise<{ heartbeatAt: string; cleanShutdown: boolean; processId: string | null } | null>;
  saveLifecycleState(input: { processId: string; heartbeatAt: string; cleanShutdown: boolean; startedAt: string; stoppedAt?: string | null }): Promise<void>;
  claimWeeklySessionNotification(record: WeeklySessionNotificationRecord): Promise<{ claimed: boolean; record: WeeklySessionNotificationRecord }>;
  completeWeeklySessionNotification(idempotencyKey: string, input: { status: "delivered" | "failed"; deliveryId?: string | null; lastError?: string | null; metadata?: Record<string, unknown> }): Promise<WeeklySessionNotificationRecord | null>;
  latestWeeklySessionNotification(): Promise<WeeklySessionNotificationRecord | null>;
  saveMarketSnapshot(record: MarketSnapshotRecord): Promise<{ inserted: boolean; record: MarketSnapshotRecord }>;
  latestMarketSnapshot(period?: "morning" | "evening"): Promise<MarketSnapshotRecord | null>;
  markMarketSnapshotDelivered(snapshotId: string, input: { deliveryId: string | null; deliveryStatus: "delivered" | "failed" }): Promise<MarketSnapshotRecord | null>;
  health(): { provider: "memory" | "postgres"; status: "healthy" | "disabled"; records: number };
}

export class InMemoryTelegramRepository implements TelegramRepository {
  private deliveries: TelegramDeliveryRecord[] = [];
  private signals = new Map<string, TelegramSignalRecord>();
  private signalUpdates: TelegramSignalLifecycleUpdate[] = [];
  private summaries: TelegramSummaryRecord[] = [];
  private schedulerRuns = new Map<string, TelegramSchedulerRunRecord>();
  private commands: TelegramCommandAuditRecord[] = [];
  private weeklySessionNotifications = new Map<string, WeeklySessionNotificationRecord>();
  private marketSnapshots = new Map<string, MarketSnapshotRecord>();
  private updateCursors = new Map<string, number>();
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
    const existing = await this.findSummaryByPeriodAndDate(record.period, record.summaryDate);
    if (existing) return existing;
    this.summaries.push(record);
    return record;
  }

  async findSummaryByPeriodAndDate(period: "daily" | "weekly", summaryDate: string) {
    return this.summaries.find((item) => item.period === period && item.summaryDate === summaryDate) ?? null;
  }

  async markSummaryDelivered(id: string, deliveryId: string) {
    const index = this.summaries.findIndex((item) => item.id === id);
    if (index < 0) return null;
    this.summaries[index] = { ...this.summaries[index], deliveryId };
    return this.summaries[index];
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

  async loadUpdateCursor(transport: string) {
    return this.updateCursors.get(transport) ?? null;
  }

  async saveUpdateCursor(transport: string, updateId: number) {
    const current = this.updateCursors.get(transport);
    if (current === undefined || updateId > current) this.updateCursors.set(transport, updateId);
  }

  async latestLifecycleHeartbeat() {
    return this.lifecycle ? { heartbeatAt: this.lifecycle.heartbeatAt, cleanShutdown: this.lifecycle.cleanShutdown, processId: this.lifecycle.processId } : null;
  }

  async saveLifecycleState(input: { processId: string; heartbeatAt: string; cleanShutdown: boolean; startedAt: string; stoppedAt?: string | null }) {
    this.lifecycle = input;
  }

  async claimWeeklySessionNotification(record: WeeklySessionNotificationRecord) {
    const existing = this.weeklySessionNotifications.get(record.idempotencyKey);
    if (existing?.status === "delivered" || existing?.status === "claimed") return { claimed: false, record: existing };
    if (existing?.status === "failed" && existing.attemptCount >= 3) return { claimed: false, record: existing };
    const claimed = { ...record, attemptCount: (existing?.attemptCount ?? 0) + 1, status: "claimed" as const, createdAt: existing?.createdAt ?? record.createdAt, updatedAt: record.updatedAt };
    this.weeklySessionNotifications.set(record.idempotencyKey, claimed);
    return { claimed: true, record: claimed };
  }

  async completeWeeklySessionNotification(idempotencyKey: string, input: { status: "delivered" | "failed"; deliveryId?: string | null; lastError?: string | null; metadata?: Record<string, unknown> }) {
    const existing = this.weeklySessionNotifications.get(idempotencyKey);
    if (!existing) return null;
    const updated = { ...existing, status: input.status, deliveryId: input.deliveryId ?? existing.deliveryId, lastError: input.lastError ?? null, metadata: { ...existing.metadata, ...(input.metadata ?? {}) }, updatedAt: new Date().toISOString() };
    this.weeklySessionNotifications.set(idempotencyKey, updated);
    return updated;
  }

  async latestWeeklySessionNotification() {
    return [...this.weeklySessionNotifications.values()].sort(desc("updatedAt"))[0] ?? null;
  }

  async saveMarketSnapshot(record: MarketSnapshotRecord) {
    const existing = this.marketSnapshots.get(record.snapshotId);
    if (existing) return { inserted: false, record: existing };
    this.marketSnapshots.set(record.snapshotId, record);
    return { inserted: true, record };
  }

  async latestMarketSnapshot(period?: "morning" | "evening") {
    return [...this.marketSnapshots.values()].filter((snapshot) => !period || snapshot.period === period).sort(desc("generatedAt"))[0] ?? null;
  }

  async markMarketSnapshotDelivered(snapshotId: string, input: { deliveryId: string | null; deliveryStatus: "delivered" | "failed" }) {
    const existing = this.marketSnapshots.get(snapshotId);
    if (!existing) return null;
    const updated = { ...existing, deliveryId: input.deliveryId, deliveryStatus: input.deliveryStatus, updatedAt: new Date().toISOString() };
    this.marketSnapshots.set(snapshotId, updated);
    return updated;
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
    const rows = await this.pool.query(
      `INSERT INTO telegram_summaries (id, period, summary_date, concise_message, report, delivery_id, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT (period, summary_date) DO UPDATE SET
         concise_message = telegram_summaries.concise_message,
         report = telegram_summaries.report,
         delivery_id = telegram_summaries.delivery_id,
         created_at = telegram_summaries.created_at
       RETURNING *`,
      [record.id, record.period, record.summaryDate, record.conciseMessage, JSON.stringify(record.report), record.deliveryId, record.createdAt],
    );
    return rowToSummary(rows.rows[0]);
  }

  async findSummaryByPeriodAndDate(period: "daily" | "weekly", summaryDate: string) {
    if (!this.pool) return null;
    const rows = await this.pool.query(`SELECT * FROM telegram_summaries WHERE period = $1 AND summary_date = $2 LIMIT 1`, [period, summaryDate]);
    return rows.rows[0] ? rowToSummary(rows.rows[0]) : null;
  }

  async markSummaryDelivered(id: string, deliveryId: string) {
    if (!this.pool) return null;
    const rows = await this.pool.query(`UPDATE telegram_summaries SET delivery_id = $2 WHERE id = $1 RETURNING *`, [id, deliveryId]);
    return rows.rows[0] ? rowToSummary(rows.rows[0]) : null;
  }

  async listSummaries(period?: "daily" | "weekly", limit = 30) {
    if (!this.pool) return [];
    const rows = await this.pool.query(
      `SELECT * FROM telegram_summaries WHERE ($1::text IS NULL OR period = $1) ORDER BY created_at DESC LIMIT $2`,
      [period ?? null, limit],
    );
    return rows.rows.map(rowToSummary);
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

  async loadUpdateCursor(transport: string) {
    if (!this.pool) return null;
    const rows = await this.pool.query(`SELECT last_update_id FROM telegram_update_cursors WHERE transport = $1 LIMIT 1`, [transport]);
    const value = rows.rows[0]?.last_update_id;
    return value === undefined || value === null ? null : Number(value);
  }

  async saveUpdateCursor(transport: string, updateId: number) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO telegram_update_cursors (transport, last_update_id, updated_at)
       VALUES ($1,$2,$3)
       ON CONFLICT (transport) DO UPDATE
       SET last_update_id = GREATEST(telegram_update_cursors.last_update_id, EXCLUDED.last_update_id),
           updated_at = EXCLUDED.updated_at`,
      [transport, updateId, new Date().toISOString()],
    );
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

  async claimWeeklySessionNotification(record: WeeklySessionNotificationRecord) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    const rows = await this.pool.query(
      `INSERT INTO telegram_weekly_session_notifications
       (idempotency_key, transition_type, boundary_at, status, delivery_id, attempt_count, last_error, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,'claimed',$4,1,$5,$6::jsonb,$7,$8)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         status = CASE
           WHEN telegram_weekly_session_notifications.status = 'failed' AND telegram_weekly_session_notifications.attempt_count < 3 THEN 'claimed'
           ELSE telegram_weekly_session_notifications.status
         END,
         attempt_count = CASE
           WHEN telegram_weekly_session_notifications.status = 'failed' AND telegram_weekly_session_notifications.attempt_count < 3 THEN telegram_weekly_session_notifications.attempt_count + 1
           ELSE telegram_weekly_session_notifications.attempt_count
         END,
         updated_at = CASE
           WHEN telegram_weekly_session_notifications.status = 'failed' AND telegram_weekly_session_notifications.attempt_count < 3 THEN EXCLUDED.updated_at
           ELSE telegram_weekly_session_notifications.updated_at
         END
       RETURNING *`,
      [record.idempotencyKey, record.transitionType, record.boundaryAt, record.deliveryId, record.lastError, JSON.stringify(record.metadata), record.createdAt, record.updatedAt],
    );
    const claimed = rowToWeeklySessionNotification(rows.rows[0]);
    return { claimed: claimed.status === "claimed" && claimed.updatedAt === record.updatedAt, record: claimed };
  }

  async completeWeeklySessionNotification(idempotencyKey: string, input: { status: "delivered" | "failed"; deliveryId?: string | null; lastError?: string | null; metadata?: Record<string, unknown> }) {
    if (!this.pool) return null;
    const rows = await this.pool.query(
      `UPDATE telegram_weekly_session_notifications
       SET status = $2, delivery_id = COALESCE($3, delivery_id), last_error = $4, metadata = metadata || $5::jsonb, updated_at = $6
       WHERE idempotency_key = $1
       RETURNING *`,
      [idempotencyKey, input.status, input.deliveryId ?? null, input.lastError ?? null, JSON.stringify(input.metadata ?? {}), new Date().toISOString()],
    );
    return rows.rows[0] ? rowToWeeklySessionNotification(rows.rows[0]) : null;
  }

  async latestWeeklySessionNotification() {
    if (!this.pool) return null;
    const rows = await this.pool.query(`SELECT * FROM telegram_weekly_session_notifications ORDER BY updated_at DESC LIMIT 1`);
    return rows.rows[0] ? rowToWeeklySessionNotification(rows.rows[0]) : null;
  }

  async saveMarketSnapshot(record: MarketSnapshotRecord) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    const rows = await this.pool.query(
      `INSERT INTO telegram_market_snapshots
       (snapshot_id, period, scheduled_local_date, scheduled_local_time, generated_at, timezone, payload, message, delivery_id, delivery_status, schema_version, correlation_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (snapshot_id) DO UPDATE SET
         payload = telegram_market_snapshots.payload,
         message = telegram_market_snapshots.message,
         delivery_id = telegram_market_snapshots.delivery_id,
         delivery_status = telegram_market_snapshots.delivery_status,
         updated_at = telegram_market_snapshots.updated_at
       RETURNING *`,
      marketSnapshotValues(record),
    );
    const saved = rowToMarketSnapshot(rows.rows[0]);
    return { inserted: saved.createdAt === record.createdAt && saved.updatedAt === record.updatedAt, record: saved };
  }

  async latestMarketSnapshot(period?: "morning" | "evening") {
    if (!this.pool) return null;
    const rows = await this.pool.query(
      `SELECT * FROM telegram_market_snapshots
       WHERE ($1::text IS NULL OR period = $1)
       ORDER BY generated_at DESC
       LIMIT 1`,
      [period ?? null],
    );
    return rows.rows[0] ? rowToMarketSnapshot(rows.rows[0]) : null;
  }

  async markMarketSnapshotDelivered(snapshotId: string, input: { deliveryId: string | null; deliveryStatus: "delivered" | "failed" }) {
    if (!this.pool) return null;
    const rows = await this.pool.query(
      `UPDATE telegram_market_snapshots
       SET delivery_id = $2, delivery_status = $3, updated_at = $4
       WHERE snapshot_id = $1
       RETURNING *`,
      [snapshotId, input.deliveryId, input.deliveryStatus, new Date().toISOString()],
    );
    return rows.rows[0] ? rowToMarketSnapshot(rows.rows[0]) : null;
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

function rowToWeeklySessionNotification(row: Record<string, unknown>): WeeklySessionNotificationRecord {
  return {
    idempotencyKey: String(row.idempotency_key),
    transitionType: row.transition_type as WeeklySessionNotificationRecord["transitionType"],
    boundaryAt: new Date(row.boundary_at as string).toISOString(),
    status: row.status as WeeklySessionNotificationRecord["status"],
    deliveryId: row.delivery_id ? String(row.delivery_id) : null,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error ? String(row.last_error) : null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function marketSnapshotValues(record: MarketSnapshotRecord) {
  return [
    record.snapshotId,
    record.period,
    record.scheduledLocalDate,
    record.scheduledLocalTime,
    record.generatedAt,
    record.timezone,
    JSON.stringify(record.payload),
    record.message,
    record.deliveryId,
    record.deliveryStatus,
    record.schemaVersion,
    record.correlationId,
    record.createdAt,
    record.updatedAt,
  ];
}

function rowToMarketSnapshot(row: Record<string, unknown>): MarketSnapshotRecord {
  return {
    snapshotId: String(row.snapshot_id),
    period: row.period as MarketSnapshotRecord["period"],
    scheduledLocalDate: String(row.scheduled_local_date),
    scheduledLocalTime: String(row.scheduled_local_time),
    generatedAt: new Date(row.generated_at as string).toISOString(),
    timezone: String(row.timezone),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    message: String(row.message),
    deliveryId: row.delivery_id ? String(row.delivery_id) : null,
    deliveryStatus: row.delivery_status as MarketSnapshotRecord["deliveryStatus"],
    schemaVersion: String(row.schema_version),
    correlationId: String(row.correlation_id),
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

function rowToSummary(row: Record<string, unknown>): TelegramSummaryRecord {
  if (!row) throw new Error("invariant violation: telegram summary persistence returned no row");
  return {
    id: String(row.id),
    period: row.period as TelegramSummaryRecord["period"],
    summaryDate: String(row.summary_date),
    conciseMessage: String(row.concise_message),
    report: (row.report ?? {}) as Record<string, unknown>,
    deliveryId: row.delivery_id ? String(row.delivery_id) : null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

function desc<T extends Record<string, unknown>>(key: keyof T) {
  return (left: T, right: T) => String(right[key]).localeCompare(String(left[key]));
}
