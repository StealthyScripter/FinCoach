import { createHash, randomUUID } from "crypto";
import { Pool, type QueryResultRow } from "pg";
import { telegramNotificationService, type TelegramNotificationService } from "./telegram/notificationService";
import { structuredLogger } from "./structuredLogger";

export type OperationalBlockerKind = "configuration" | "fallback" | "dependency" | "limit" | "lifecycle";
export type OperationalBlockerSeverity = "info" | "warning" | "critical";
export type OperationalBlockerStatus = "active" | "resolved";

export type OperationalBlockerEvent = {
  kind: OperationalBlockerKind;
  code: string;
  title: string;
  whatBlocked: string;
  reason: string;
  currentValue: unknown;
  limitValue: unknown;
  configKey?: string;
  configValueState?: "SET" | "EMPTY" | "INVALID" | "DEFAULT" | "UNSET" | "N/A";
  scope?: {
    symbol?: string;
    strategyId?: string;
    cycleId?: string;
    sessionId?: string;
    component?: string;
  };
  expected: boolean;
  action: string;
  effect?: string;
  severity?: OperationalBlockerSeverity;
  count?: number;
  now?: Date;
};

export type OperationalBlockerRecord = OperationalBlockerEvent & {
  id: string;
  fingerprint: string;
  status: OperationalBlockerStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  lastNotifiedAt: string | null;
  resolvedAt: string | null;
  occurrenceCount: number;
};

type Store = {
  upsertActive(record: OperationalBlockerRecord): Promise<OperationalBlockerRecord>;
  resolveMissing(activeFingerprints: Set<string>, now: Date): Promise<number>;
  list(input?: { includeResolved?: boolean; limit?: number }): Promise<OperationalBlockerRecord[]>;
};

const DEFAULT_REMINDER_MS = 6 * 60 * 60_000;
const DEFAULT_LIMIT = 100;

export class OperationalBlockerService {
  private store: Store | null = null;
  private pool: Pool | null = null;
  private readonly memory = new InMemoryOperationalBlockerStore();
  private dormant = false;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly notifications: Pick<TelegramNotificationService, "sendOperations"> = telegramNotificationService,
    store?: Store,
  ) {
    this.store = store ?? null;
  }

  setDormant(dormant: boolean) {
    this.dormant = dormant;
  }

  async record(event: OperationalBlockerEvent) {
    const now = event.now ?? new Date();
    const normalized = normalizeEvent(event);
    const fingerprint = fingerprintFor(normalized);
    const base: OperationalBlockerRecord = {
      ...normalized,
      id: `op-blocker-${fingerprint.slice(0, 16)}`,
      fingerprint,
      status: "active",
      firstSeenAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      lastNotifiedAt: null,
      resolvedAt: null,
      occurrenceCount: Math.max(1, Number(normalized.count ?? 1)),
    };
    const saved = await this.getStore().upsertActive(base);
    structuredLogger.application({
      level: normalized.severity === "critical" ? "error" : "warn",
      module: "operational-blockers",
      event: "operational_blocker_recorded",
      message: normalized.title,
      blocker: safeRecord(saved),
    });
    if (this.shouldNotify(saved, now)) {
      const delivery = await this.notifications.sendOperations("health", formatBlockerMessage(saved), {
        blockerFingerprint: saved.fingerprint,
        blockerCode: saved.code,
        blockerKind: saved.kind,
        liveExecutionBlocked: true,
      }).catch((error) => ({ sent: false as const, reason: error instanceof Error ? error.message : String(error) }));
      if (delivery.sent) {
        saved.lastNotifiedAt = now.toISOString();
        await this.getStore().upsertActive(saved);
      }
    }
    return saved;
  }

  async recordMany(events: OperationalBlockerEvent[]) {
    const records = [];
    for (const event of events) records.push(await this.record(event));
    return records;
  }

  async reconcileActive(events: OperationalBlockerEvent[], now = new Date()) {
    const records = await this.recordMany(events.map(event => ({ ...event, now })));
    await this.getStore().resolveMissing(new Set(records.map(record => record.fingerprint)), now);
    return records;
  }

  async list(input: { includeResolved?: boolean; limit?: number } = {}) {
    return this.getStore().list(input);
  }

  async snapshot(now = new Date()) {
    const records = await this.list({ includeResolved: true, limit: 200 });
    const active = records.filter(record => record.status === "active");
    const hourStart = now.getTime() - 60 * 60_000;
    const dayStart = now.getTime() - 24 * 60 * 60_000;
    const counts = (items: OperationalBlockerRecord[]) => items.reduce<Record<string, number>>((acc, item) => {
      acc[item.code] = (acc[item.code] ?? 0) + item.occurrenceCount;
      return acc;
    }, {});
    return {
      schemaVersion: "fincoach.operational-blockers.1",
      generatedAt: now.toISOString(),
      activeConfigurationBlockers: active.filter(item => item.kind === "configuration" || item.kind === "limit"),
      activeProviderFallbacks: active.filter(item => item.kind === "fallback" || item.kind === "dependency"),
      limitTriggeredCounts: {
        currentCycle: counts(active.filter(item => item.scope?.cycleId)),
        currentHour: counts(records.filter(item => Date.parse(item.lastSeenAt) >= hourStart)),
        currentDay: counts(records.filter(item => Date.parse(item.lastSeenAt) >= dayStart)),
      },
      resolvedBlockers: records.filter(item => item.status === "resolved").slice(0, 25),
      active,
      liveExecutionBlocked: true,
    };
  }

  private getStore() {
    if (this.store) return this.store;
    const url = this.env.DATABASE_URL?.trim();
    if (!url) return this.memory;
    if (!this.pool) this.pool = new Pool({ connectionString: url });
    this.store = new PgOperationalBlockerStore(this.pool, this.memory);
    return this.store;
  }

  private shouldNotify(record: OperationalBlockerRecord, now: Date) {
    if (this.dormant && record.kind !== "lifecycle") return false;
    if (!this.env.TELEGRAM_NOTIFICATIONS_ENABLED || this.env.TELEGRAM_NOTIFICATIONS_ENABLED === "false") return false;
    if (!this.env.TELEGRAM_BOT_TOKEN?.trim() || !this.env.TELEGRAM_CHAT_ID?.trim()) return false;
    if (!record.lastNotifiedAt) return true;
    return now.getTime() - Date.parse(record.lastNotifiedAt) >= reminderMs(this.env);
  }
}

class InMemoryOperationalBlockerStore implements Store {
  private readonly records = new Map<string, OperationalBlockerRecord>();

  async upsertActive(record: OperationalBlockerRecord) {
    const existing = this.records.get(record.fingerprint);
    const merged = existing ? {
      ...existing,
      ...record,
      id: existing.id,
      firstSeenAt: existing.status === "resolved" ? record.firstSeenAt : existing.firstSeenAt,
      lastNotifiedAt: existing.status === "resolved" ? null : existing.lastNotifiedAt,
      occurrenceCount: existing.status === "resolved" ? record.occurrenceCount : existing.occurrenceCount + Math.max(1, Number(record.count ?? 1)),
      status: "active" as const,
      resolvedAt: null,
    } : record;
    this.records.set(record.fingerprint, merged);
    return merged;
  }

  async resolveMissing(activeFingerprints: Set<string>, now: Date) {
    let count = 0;
    for (const [fingerprint, record] of this.records) {
      if (record.status === "active" && !activeFingerprints.has(fingerprint)) {
        this.records.set(fingerprint, { ...record, status: "resolved", resolvedAt: now.toISOString(), lastSeenAt: now.toISOString() });
        count += 1;
      }
    }
    return count;
  }

  async list(input: { includeResolved?: boolean; limit?: number } = {}) {
    return [...this.records.values()]
      .filter(record => input.includeResolved || record.status === "active")
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, input.limit ?? DEFAULT_LIMIT);
  }
}

class PgOperationalBlockerStore implements Store {
  constructor(private readonly pool: Pool, private readonly fallback: InMemoryOperationalBlockerStore) {}

  async upsertActive(record: OperationalBlockerRecord) {
    try {
      const result = await this.pool.query(
        `INSERT INTO operational_blockers
          (id, fingerprint, kind, code, title, what_blocked, reason, current_value, limit_value, config_key, config_value_state, scope, expected, action, effect, severity, status, first_seen_at, last_seen_at, last_notified_at, resolved_at, occurrence_count, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'active',$17,$18,$19,NULL,$20,$21)
         ON CONFLICT (fingerprint) DO UPDATE SET
           kind = EXCLUDED.kind,
           code = EXCLUDED.code,
           title = EXCLUDED.title,
           what_blocked = EXCLUDED.what_blocked,
           reason = EXCLUDED.reason,
           current_value = EXCLUDED.current_value,
           limit_value = EXCLUDED.limit_value,
           config_key = EXCLUDED.config_key,
           config_value_state = EXCLUDED.config_value_state,
           scope = EXCLUDED.scope,
           expected = EXCLUDED.expected,
           action = EXCLUDED.action,
           effect = EXCLUDED.effect,
           severity = EXCLUDED.severity,
           status = 'active',
           last_seen_at = EXCLUDED.last_seen_at,
           last_notified_at = COALESCE(EXCLUDED.last_notified_at, operational_blockers.last_notified_at),
           resolved_at = NULL,
           occurrence_count = operational_blockers.occurrence_count + EXCLUDED.occurrence_count,
           payload = EXCLUDED.payload
         RETURNING *`,
        [record.id, record.fingerprint, record.kind, record.code, record.title, record.whatBlocked, record.reason, JSON.stringify(record.currentValue), JSON.stringify(record.limitValue), record.configKey ?? null, record.configValueState ?? null, JSON.stringify(record.scope ?? {}), record.expected, record.action, record.effect ?? null, record.severity ?? "warning", record.firstSeenAt, record.lastSeenAt, record.lastNotifiedAt, record.occurrenceCount, JSON.stringify(safeRecord(record))],
      );
      return fromRow(result.rows[0]);
    } catch (error) {
      structuredLogger.application({ level: "error", module: "operational-blockers", event: "operational_blocker_persistence_failed", message: "Operational blocker persistence failed; using memory fallback", error });
      return this.fallback.upsertActive(record);
    }
  }

  async resolveMissing(activeFingerprints: Set<string>, now: Date) {
    try {
      if (activeFingerprints.size === 0) {
        const result = await this.pool.query("UPDATE operational_blockers SET status = 'resolved', resolved_at = $1, last_seen_at = $1 WHERE status = 'active'", [now.toISOString()]);
        return result.rowCount ?? 0;
      }
      const result = await this.pool.query("UPDATE operational_blockers SET status = 'resolved', resolved_at = $1, last_seen_at = $1 WHERE status = 'active' AND NOT (fingerprint = ANY($2::text[]))", [now.toISOString(), [...activeFingerprints]]);
      return result.rowCount ?? 0;
    } catch {
      return this.fallback.resolveMissing(activeFingerprints, now);
    }
  }

  async list(input: { includeResolved?: boolean; limit?: number } = {}) {
    try {
      const result = await this.pool.query(
        `SELECT * FROM operational_blockers
         WHERE ($1::boolean OR status = 'active')
         ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, last_seen_at DESC
         LIMIT $2`,
        [Boolean(input.includeResolved), input.limit ?? DEFAULT_LIMIT],
      );
      return result.rows.map(fromRow);
    } catch {
      return this.fallback.list(input);
    }
  }
}

function normalizeEvent(event: OperationalBlockerEvent): OperationalBlockerEvent {
  return {
    ...event,
    code: event.code.trim().toLowerCase(),
    title: event.title.trim(),
    severity: event.severity ?? (event.expected ? "warning" : "critical"),
    currentValue: sanitizeValue(event.currentValue),
    limitValue: sanitizeValue(event.limitValue),
    configValueState: event.configValueState ?? (event.configKey ? "N/A" : undefined),
    scope: cleanScope(event.scope),
  };
}

function fingerprintFor(event: OperationalBlockerEvent) {
  return createHash("sha256").update(JSON.stringify({
    kind: event.kind,
    code: event.code,
    scope: event.scope ?? {},
    currentValue: event.currentValue,
    limitValue: event.limitValue,
    configKey: event.configKey ?? null,
    configValueState: event.configValueState ?? null,
  })).digest("hex");
}

function formatBlockerMessage(record: OperationalBlockerRecord) {
  const icon = record.kind === "fallback" || record.kind === "dependency" ? "🟡" : "⚠️";
  const lines = [
    `${icon} ${record.title}`,
    `Blocked: ${record.whatBlocked}`,
    `Reason: ${record.code} - ${record.reason}`,
    `Current: ${formatValue(record.currentValue)}`,
    `Limit/required: ${formatValue(record.limitValue)}`,
  ];
  if (record.configKey) lines.push(`Config: ${record.configKey}=${record.configValueState ?? "N/A"}`);
  if (record.scope?.cycleId) lines.push(`Cycle: ${record.scope.cycleId}`);
  if (record.scope?.strategyId) lines.push(`Strategy: ${record.scope.strategyId}`);
  if (record.scope?.symbol) lines.push(`Symbol: ${record.scope.symbol}`);
  if (record.scope?.sessionId) lines.push(`Session: ${record.scope.sessionId}`);
  if (record.effect) lines.push(`Effect: ${record.effect}`);
  lines.push(`Classification: ${record.expected ? "expected gating" : "abnormal failure"}`);
  lines.push(`Action: ${record.action}`);
  return lines.join("\n");
}

function fromRow(row: QueryResultRow): OperationalBlockerRecord {
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    kind: row.kind,
    code: String(row.code),
    title: String(row.title),
    whatBlocked: String(row.what_blocked),
    reason: String(row.reason),
    currentValue: parseJson(row.current_value),
    limitValue: parseJson(row.limit_value),
    configKey: row.config_key ? String(row.config_key) : undefined,
    configValueState: row.config_value_state ? row.config_value_state : undefined,
    scope: parseJson(row.scope) as OperationalBlockerRecord["scope"],
    expected: Boolean(row.expected),
    action: String(row.action),
    effect: row.effect ? String(row.effect) : undefined,
    severity: row.severity,
    status: row.status,
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    lastNotifiedAt: row.last_notified_at ? new Date(row.last_notified_at).toISOString() : null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    occurrenceCount: Number(row.occurrence_count ?? 1),
  };
}

function safeRecord(record: OperationalBlockerRecord) {
  return { ...record, currentValue: sanitizeValue(record.currentValue), limitValue: sanitizeValue(record.limitValue) };
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (looksSecret(value)) return value.trim() ? "SET" : "EMPTY";
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function looksSecret(value: string) {
  return /(token|secret|password|authorization|bearer|api[_-]?key)/i.test(value) || value.length > 48;
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "EMPTY";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function cleanScope(scope: OperationalBlockerEvent["scope"]) {
  if (!scope) return undefined;
  return Object.fromEntries(Object.entries(scope).filter(([, value]) => value !== undefined && value !== null && value !== "")) as OperationalBlockerEvent["scope"];
}

function parseJson(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function reminderMs(env: NodeJS.ProcessEnv) {
  const parsed = Number(env.FINCOACH_OPERATIONAL_ALERT_REMINDER_MINUTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 60_000 : DEFAULT_REMINDER_MS;
}

export function envState(env: NodeJS.ProcessEnv, key: string): "SET" | "EMPTY" {
  return env[key]?.trim() ? "SET" : "EMPTY";
}

export const operationalBlockerService = new OperationalBlockerService();
