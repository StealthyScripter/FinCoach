import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { PgForwardTestingRepository } from "./v2/forward-testing/pgRepository";
import { V2OperationsService } from "./v2/operations/service";
import { InMemoryV2TelemetrySink, V2TelemetryService } from "./v2/telemetry";

if (!process.env.DATABASE_URL) {
  console.log("v2 operational maturity PostgreSQL tests skipped: DATABASE_URL is not set");
  process.exit(0);
}

await bootstrapTestDatabase();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `opmat-${Date.now()}-${randomUUID().slice(0, 8)}`;
const now = new Date().toISOString();
const forwardTestId = `forward-${suffix}`;

try {
  const record = {
    forwardTestId,
    schemaVersion: "fincoach.v2.forward-test.1" as const,
    strategyId: `strategy-${suffix}`,
    strategyVersion: 1,
    courtCaseId: `court-${suffix}`,
    rankingId: `ranking-${suffix}`,
    status: "monitoring" as const,
    demoVerification: { demoOnly: true as const, environment: "paper" as const, accountMode: "paper" as const, verifiedAt: now },
    snapshot: { snapshotId: `snapshot-${suffix}`, symbol: "EUR_USD", timestamp: now, bid: 1, ask: 1.0002, spread: 0.0002, fresh: true, contextEventId: `context-${suffix}`, lineageEventIds: [`lineage-${suffix}`] },
    ruleEvaluation: { passed: true },
    reason: "operational maturity fixture",
    counterargument: "fixture risk",
    expectedR: 1,
    risk: 0.5,
    createdAt: now,
    lineageEventIds: [`lineage-${suffix}`],
    correlationId: randomUUID(),
    causationId: null,
  };

  const repository = new PgForwardTestingRepository(pool);
  assert.equal((await repository.save(record)).inserted, true);
  assert.equal((await new PgForwardTestingRepository(pool).get(forwardTestId))?.forwardTestId, forwardTestId);

  const operations = new V2OperationsService({ evidence: { "forward-tests": new PgForwardTestingRepository(pool) } });
  const projection = await operations.listAsync("forward-tests", { strategyId: record.strategyId, limit: 10, offset: 0 });
  assert.equal(projection.status, 200);
  assert.equal(projection.body.availability, "available");
  assert.equal((projection.body.pagination as { total: number }).total, 1);

  const telemetry = new V2TelemetryService(new InMemoryV2TelemetrySink());
  telemetry.counter("v2_forward_tests_projected_total", 1, { module: "operations", operation: "projection", resultClass: "success" });
  assert.equal(telemetry.snapshot().counters["v2_forward_tests_projected_total{module=operations,operation=projection,resultClass=success}"], 1);
  console.log("v2 operational maturity PostgreSQL tests passed");
} finally {
  await pool.query("DELETE FROM v2_forward_tests WHERE record_id = $1", [forwardTestId]);
  await pool.end();
}
