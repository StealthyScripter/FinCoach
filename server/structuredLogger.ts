import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "fs";
import { appendFileSync } from "fs";
import { join } from "path";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
type LogFile = "application" | "v2-runtime" | "v2-errors" | "telegram" | "audit";

export type StructuredLogEntry = {
  timestamp?: string;
  level: LogLevel;
  service?: string;
  module: string;
  event: string;
  message: string;
  cycleId?: string | null;
  correlationId?: string | null;
  requestedBy?: string | null;
  runtimeInstanceId?: string | null;
  pid?: number;
  durationMs?: number;
  retryAttempt?: number;
  nextRetryAt?: string | null;
  error?: unknown;
  [key: string]: unknown;
};

type StructuredLogInput = {
  timestamp?: string;
  level: LogLevel;
  service?: string;
  module?: string;
  event: string;
  message: string;
  cycleId?: string | null;
  correlationId?: string | null;
  requestedBy?: string | null;
  runtimeInstanceId?: string | null;
  pid?: number;
  durationMs?: number;
  retryAttempt?: number;
  nextRetryAt?: string | null;
  error?: unknown;
  [key: string]: unknown;
};

export type StructuredLoggerOptions = {
  logDir?: string;
  maxBytes?: number;
  retentionDays?: number;
  now?: () => Date;
};

const SECRET_KEY_PATTERN = /(password|passwd|pwd|token|secret|api[_-]?key|database_url|databaseurl|account[_-]?id|bot[_-]?token|chat[_-]?id|authorization|credential)/i;
const URL_PASSWORD_PATTERN = /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi;

export class StructuredLogger {
  private readonly logDir: string;
  private readonly maxBytes: number;
  private readonly retentionDays: number;
  private readonly now: () => Date;

  constructor(options: StructuredLoggerOptions = {}) {
    this.logDir = options.logDir ?? process.env.FINCOACH_LOG_DIR ?? "logs";
    this.maxBytes = positiveInt(process.env.FINCOACH_LOG_MAX_BYTES, options.maxBytes ?? 10 * 1024 * 1024);
    this.retentionDays = positiveInt(process.env.FINCOACH_LOG_RETENTION_DAYS, options.retentionDays ?? 14);
    this.now = options.now ?? (() => new Date());
  }

  write(file: LogFile, entry: StructuredLogEntry) {
    const timestamp = entry.timestamp ?? this.now().toISOString();
    const sanitized = sanitize({
      service: "fincoach",
      pid: process.pid,
      ...entry,
      timestamp,
      error: entry.error ? serializeError(entry.error) : undefined,
    });
    const path = this.pathFor(file);
    mkdirSync(this.logDir, { recursive: true });
    this.rotateIfNeeded(path, timestamp);
    appendFileSync(path, `${stableStringify(sanitized)}\n`, "utf8");
    this.enforceRetention(file);
  }

  application(entry: StructuredLogInput) {
    this.write("application", { ...entry, module: entry.module ?? "application" });
  }

  v2(entry: StructuredLogInput) {
    this.write("v2-runtime", { ...entry, module: entry.module ?? "v2-runtime" });
  }

  v2Error(entry: StructuredLogInput) {
    this.write("v2-errors", { ...entry, module: entry.module ?? "v2-runtime" });
  }

  telegram(entry: StructuredLogInput) {
    this.write("telegram", { ...entry, module: entry.module ?? "telegram" });
  }

  audit(entry: StructuredLogInput) {
    this.write("audit", { ...entry, module: entry.module ?? "audit" });
  }

  private pathFor(file: LogFile) {
    return join(this.logDir, `${file}.log`);
  }

  private rotateIfNeeded(path: string, timestamp: string) {
    if (!existsSync(path)) return;
    const stat = statSync(path);
    const currentDate = stat.mtime.toISOString().slice(0, 10);
    const entryDate = timestamp.slice(0, 10);
    if (stat.size < this.maxBytes && currentDate === entryDate) return;
    const suffix = timestamp.replace(/[:.]/g, "-");
    renameSync(path, `${path}.${suffix}`);
  }

  private enforceRetention(file: LogFile) {
    const prefix = `${file}.log.`;
    const cutoff = this.now().getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const item of readdirSync(this.logDir)) {
      if (!item.startsWith(prefix)) continue;
      const fullPath = join(this.logDir, item);
      if (statSync(fullPath).mtime.getTime() < cutoff) unlinkSync(fullPath);
    }
  }
}

export const structuredLogger = new StructuredLogger();

export function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { name: "Error", code: "unknown", message: redact(String(error)) };
  return {
    name: error.name,
    code: classifyErrorCode(error),
    message: redact(error.message),
    stack: error.stack ? redact(error.stack) : undefined,
  };
}

export function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redact(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitize(raw);
    }
    return out;
  }
  return String(value);
}

function redact(value: string) {
  return value.replace(URL_PASSWORD_PATTERN, "$1[REDACTED]$3");
}

function classifyErrorCode(error: Error) {
  if (/Cannot use a pool after calling end on the pool/i.test(error.message)) return "database_pool_closed";
  if (/timeout/i.test(error.message)) return "timeout";
  if (/rate limit|429/i.test(error.message)) return "rate_limited";
  return (error as Error & { code?: string }).code ?? "unknown_failure";
}

function stableStringify(value: unknown) {
  return JSON.stringify(value);
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
