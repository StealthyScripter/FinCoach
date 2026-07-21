import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { StructuredLogger, serializeError } from "./structuredLogger";
import { createDomainEvent } from "./v2/contracts";

const root = "/tmp/fincoach-structured-logger-test";
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

{
  const logger = new StructuredLogger({ logDir: root, maxBytes: 1024 * 1024, retentionDays: 7, now: () => new Date("2026-07-20T03:27:54.712Z") });
  logger.v2Error({
    level: "error",
    event: "research_cycle_failed",
    message: "Research cycle failed for postgres://user:super-secret@localhost:5432/fincoach",
    cycleId: "cycle-test",
    correlationId: "corr-test",
    requestedBy: "v2-autostart-initial",
    runtimeInstanceId: "runtime-test",
    error: new Error("Cannot use a pool after calling end on the pool"),
    config: { DATABASE_URL: "postgres://user:super-secret@localhost:5432/fincoach", TELEGRAM_BOT_TOKEN: "token-value", accountId: "ABCDEF1234567890" },
  });
  const line = readFileSync(join(root, "v2-errors.log"), "utf8").trim();
  const parsed = JSON.parse(line);
  assert.equal(parsed.timestamp, "2026-07-20T03:27:54.712Z");
  assert.equal(parsed.level, "error");
  assert.equal(parsed.module, "v2-runtime");
  assert.equal(parsed.cycleId, "cycle-test");
  assert.equal(parsed.error.code, "database_pool_closed");
  assert.ok(!line.includes("super-secret"));
  assert.ok(!line.includes("token-value"));
  assert.ok(!line.includes("ABCDEF1234567890"));
}

{
  const logger = new StructuredLogger({ logDir: root, maxBytes: 10, retentionDays: 7, now: () => new Date("2026-07-20T04:00:00.000Z") });
  logger.application({ level: "info", event: "first", message: "first message that exceeds rotation threshold" });
  logger.application({ level: "info", event: "second", message: "second message" });
  assert.ok(existsSync(join(root, "application.log")));
  assert.ok(statSync(join(root, "application.log")).size > 0);
  assert.ok(readFileSync(join(root, "application.log"), "utf8").includes("\"event\":\"second\""));
}

{
  const stale = join(root, "telegram.log.2026-07-01T00-00-00-000Z");
  const active = join(root, "telegram.log");
  const old = new Date("2026-07-01T00:00:00.000Z");
  mkdirSync(root, { recursive: true });
  rmSync(active, { force: true });
  writeFileSync(stale, "{}\n");
  utimesSync(stale, old, old);
  const logger = new StructuredLogger({ logDir: root, maxBytes: 1024 * 1024, retentionDays: 1, now: () => new Date("2026-07-20T05:00:00.000Z") });
  logger.telegram({ level: "info", event: "poll", message: "poll" });
  assert.equal(existsSync(stale), false);
}

assert.equal(serializeError(new Error("Cannot use a pool after calling end on the pool")).code, "database_pool_closed");

{
  let captured: unknown = null;
  try {
    createDomainEvent({
      eventType: "MarketObservationCreated",
      sourceModule: "observations",
      correlationId: "00000000-0000-4000-8000-000000000001",
      causationId: "cycle-2026-07-20T00:00:00.000Z-deadbeef",
      payload: { observationId: "obs-1" },
    });
  } catch (error) {
    captured = error;
  }
  const serialized = serializeError(captured) as { code?: string; issues?: Array<{ offendingField?: string; offendingValue?: string }>; validationContext?: { objectType?: string } };
  assert.equal(serialized.code, "validation_failed");
  assert.equal(serialized.validationContext?.objectType, "DomainEvent");
  assert.equal(serialized.issues?.[0]?.offendingField, "causationId");
  assert.equal(serialized.issues?.[0]?.offendingValue, "cycle-2026-07-20T00:00:00.000Z-deadbeef");
}

console.log("structured logger tests passed");
