export type V2PersistenceErrorCode =
  | "database_unavailable"
  | "authentication_failure"
  | "permission_failure"
  | "migration_mismatch"
  | "unsupported_schema_version"
  | "duplicate_idempotent_request"
  | "conflicting_duplicate"
  | "optimistic_concurrency_conflict"
  | "malformed_persisted_record"
  | "serialization_failure"
  | "deadlock_or_retryable_transaction_failure"
  | "constraint_violation"
  | "persistence_integrity_failure"
  | "unknown_persistence_failure";

export class V2PersistenceError extends Error {
  constructor(
    public readonly code: V2PersistenceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "V2PersistenceError";
  }
}

export function classifyPostgresError(error: unknown): V2PersistenceError {
  if (error instanceof V2PersistenceError) return error;
  const pg = error as { code?: string; message?: string };
  switch (pg.code) {
    case "ECONNREFUSED":
    case "ENOTFOUND":
    case "ETIMEDOUT":
    case "57P01":
    case "08000":
    case "08003":
    case "08006":
      return new V2PersistenceError("database_unavailable", "PostgreSQL is unavailable", error);
    case "28P01":
      return new V2PersistenceError("authentication_failure", "PostgreSQL authentication failed", error);
    case "42501":
      return new V2PersistenceError("permission_failure", "PostgreSQL permission denied", error);
    case "42P01":
    case "42703":
      return new V2PersistenceError("migration_mismatch", "PostgreSQL schema is missing an expected V2 operational object", error);
    case "23505":
      return new V2PersistenceError("conflicting_duplicate", "PostgreSQL uniqueness constraint rejected the write", error);
    case "23514":
    case "23503":
    case "23502":
      return new V2PersistenceError("constraint_violation", "PostgreSQL constraint rejected the write", error);
    case "40001":
      return new V2PersistenceError("serialization_failure", "PostgreSQL serialization failure", error);
    case "40P01":
      return new V2PersistenceError("deadlock_or_retryable_transaction_failure", "PostgreSQL deadlock detected", error);
    default:
      return new V2PersistenceError("unknown_persistence_failure", pg.message ?? "Unknown PostgreSQL persistence failure", error);
  }
}

export function requireSchemaVersion(actual: unknown, expected: string) {
  if (actual !== expected) {
    throw new V2PersistenceError("unsupported_schema_version", `Unsupported persisted schema version: ${String(actual)}`);
  }
}

export function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new V2PersistenceError("malformed_persisted_record", `Malformed persisted ${label}`);
  }
  return value as Record<string, unknown>;
}
