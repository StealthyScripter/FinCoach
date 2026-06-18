import type { StorageHealth } from "@shared/schema";

export function getStorageMode(): "memory" | "postgres" {
  if (process.env.MARKETPILOT_STORAGE === "memory") return "memory";
  return process.env.DATABASE_URL ? "postgres" : "memory";
}

export function validateDatabaseUrl(databaseUrl = process.env.DATABASE_URL): { valid: boolean; message: string } {
  if (!databaseUrl) return { valid: false, message: "DATABASE_URL is not configured." };
  try {
    const parsed = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      return { valid: false, message: "DATABASE_URL must use postgres:// or postgresql://." };
    }
    if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") {
      return { valid: false, message: "DATABASE_URL must include host and database name." };
    }
    return { valid: true, message: "DATABASE_URL is syntactically valid." };
  } catch {
    return { valid: false, message: "DATABASE_URL is not a valid URL." };
  }
}

export function getStorageHealth(now = new Date()): StorageHealth {
  const mode = getStorageMode();
  const databaseUrl = validateDatabaseUrl();
  const checks: StorageHealth["checks"] = [
    {
      id: "provider_selection",
      status: mode === "postgres" ? "pass" : "warning",
      detail: mode === "postgres"
        ? "PostgreSQL storage selected from DATABASE_URL."
        : "Memory storage selected; data is demo/ephemeral.",
    },
    {
      id: "database_url",
      status: mode === "postgres" && databaseUrl.valid ? "pass" : mode === "postgres" ? "fail" : "warning",
      detail: databaseUrl.message,
    },
    {
      id: "migration_version",
      status: "pass",
      detail: "Initial migration expected: migrations/0001_marketpilot_core.sql.",
    },
    {
      id: "seed_strategy",
      status: "pass",
      detail: "Demo seed is idempotent and loaded into memory or inserted into PostgreSQL on first overview read.",
    },
  ];

  return {
    generatedAt: now.toISOString(),
    mode,
    status: checks.some((check) => check.status === "fail")
      ? "unavailable"
      : checks.some((check) => check.status === "warning")
        ? "degraded"
        : "healthy",
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    migrationVersion: "0001_marketpilot_core",
    seedStrategy: "idempotent-demo-seed",
    checks,
  };
}
