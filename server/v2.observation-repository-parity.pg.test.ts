import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import { bootstrapTestDatabase } from "./testDatabase";
import { evidence, InMemoryObservationRepository, type MarketObservation } from "./v2/observations";
import { PgObservationRepository } from "./v2/observations/pgRepository";

if (!process.env.DATABASE_URL) {
  console.log("v2 observation repository parity PostgreSQL tests skipped: DATABASE_URL is not set");
  process.exit(0);
}

await bootstrapTestDatabase();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `obs-parity-${Date.now()}-${randomUUID().slice(0, 8)}`;

try {
  await pool.query(readFileSync("migrations/0016_v2_research_lineage_persistence.sql", "utf-8"));
  await pool.query(readFileSync("migrations/0017_v2_research_pipeline_repair.sql", "utf-8"));
  await parityTest();
  console.log("v2 observation repository parity PostgreSQL tests passed");
} finally {
  await cleanup();
  await pool.end();
}

async function parityTest() {
  const now = new Date();
  const memory = new InMemoryObservationRepository();
  const pg = new PgObservationRepository(pool);
  const fixtures = [
    fixtureObservation("newer", 10),
    fixtureObservation("tie-a", 20, { observedAtOffsetMs: 0 }),
    fixtureObservation("tie-b", 20, { observedAtOffsetMs: 0 }),
    fixtureObservation("low-quality", 30, { qualityScore: 0.2 }),
    fixtureObservation("expired", 40, { expiresAt: new Date(now.getTime() - 60_000).toISOString() }),
    fixtureObservation("inactive", 50, { lifecycle: "expired" }),
    fixtureObservation("other-symbol", 5, { symbol: "GBP_USD" }),
  ];
  for (const observation of fixtures) {
    memory.save(observation);
    await pg.save(observation);
  }

  const input = {
    symbol: "EUR_USD",
    timeframe: "1m",
    detectorId: "breakout",
    observationType: "breakout",
    strategyFamily: "compression_breakout",
    lookbackHours: 24,
    minimumQualityScore: 0.5,
    now,
    limit: 10,
  };
  const memoryEligible = await memory.eligibleForHypothesis(input);
  const pgEligible = await pg.eligibleForHypothesis(input);
  assert.deepEqual(pgEligible.map(item => item.observationId), memoryEligible.map(item => item.observationId));
  assert.deepEqual(pgEligible.flatMap(item => item.evidence.map(ev => ev.evidenceId)), memoryEligible.flatMap(item => item.evidence.map(ev => ev.evidenceId)));

  const groupInput = { lookbackHours: 24, minimumQualityScore: 0.5, now, limit: 10 };
  const memoryGroups = await memory.eligibleSemanticGroups(groupInput);
  const pgGroups = await pg.eligibleSemanticGroups(groupInput);
  assert.deepEqual(pgGroups, memoryGroups);
}

function fixtureObservation(label: string, minutesAgo: number, overrides: Partial<MarketObservation> & { observedAtOffsetMs?: number } = {}): MarketObservation {
  const now = Date.now();
  const observedAt = new Date(now - minutesAgo * 60_000 + (overrides.observedAtOffsetMs ?? randomOffset(label))).toISOString();
  const candleEnd = new Date(Date.parse(observedAt) + 60_000).toISOString();
  const sourceEventId = `event-${suffix}-${label}`;
  const sourceDataHash = `hash-${suffix}-${label}`;
  const evidenceItem = evidence("chart", sourceEventId, "structure.breakOfStructure", true, observedAt, {
    symbol: overrides.symbol ?? "EUR_USD",
    timeframe: overrides.timeframe ?? "1m",
    detectorId: overrides.detectorId ?? "breakout",
    detectorVersion: "v1",
    observationType: overrides.observationType ?? "breakout",
    candleStart: observedAt,
    candleEnd,
    sourceDataHash,
  });
  return {
    observationId: `obs-${suffix}-${label}`,
    schemaVersion: "fincoach.v2.observation.1",
    symbol: "EUR_USD",
    timeframe: "1m",
    observationType: "breakout",
    detectorId: "breakout",
    detectorVersion: "v1",
    strategyFamily: "compression_breakout",
    observedAt,
    candleStart: observedAt,
    candleEnd,
    lookbackStart: new Date(now - (minutesAgo + 80) * 60_000).toISOString(),
    lookbackEnd: observedAt,
    marketDataSource: "fixture",
    sourceDataIds: [`fixture:${suffix}:${label}`],
    sourceDataHash,
    metrics: { sampleSize: 80, spread: 0.0001, breakoutDistance: 0.001 },
    naturalKey: `natural-${suffix}-${label}`,
    idempotencyKey: `idem-${suffix}-${label}`,
    effectiveFrom: observedAt,
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
    evidence: [evidenceItem],
    contradictoryEvidence: [],
    confidence: 0.8,
    qualityScore: 0.8,
    contextEventId: sourceEventId,
    upstreamEventIds: [sourceEventId],
    correlationId: randomUUID(),
    causationId: `cause-${suffix}-${label}`,
    lifecycle: "active",
    supersedesId: null,
    ...overrides,
  };
}

function randomOffset(label: string) {
  return label.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

async function cleanup() {
  await pool.query("DELETE FROM v2_market_observations WHERE record_id LIKE $1", [`obs-${suffix}-%`]).catch(() => undefined);
}
