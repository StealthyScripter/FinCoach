import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { createFinCoachV2Runtime } from "./v2/runtime/composition";
import { evidence, InMemoryObservationRepository, semanticGroupFromObservation, type MarketObservation } from "./v2/observations";
import { InMemoryHypothesisRepository } from "./v2/hypothesis/repository";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/fincoach";

await historicalOnlyAggregation();
await insufficientEvidence();
await duplicateCurrentObservationStillAggregates();
await expiredSupportExcluded();
await duplicateEvidenceIdsRejected();
await semanticMismatchNotCombined();
await repeatedCycleIdempotency();
await duplicateHypothesisDoesNotConsumeInsertedBudget();

async function historicalOnlyAggregation() {
  const observations = new InMemoryObservationRepository();
  seed(observations, [fixtureObservation("hist-a", 20), fixtureObservation("hist-b", 10)]);
  const saved = savedCollections();
  const result = await runRuntime(observations, saved, { maxObservations: 0, maxHypotheses: 1 });
  assert.equal(result.hypothesesCreated, 1, JSON.stringify(result));
  assert.equal(saved.hypotheses.length, 1);
  assert.equal(saved.strategies.length, 1);
}

async function insufficientEvidence() {
  const observations = new InMemoryObservationRepository();
  seed(observations, [fixtureObservation("single", 10)]);
  const saved = savedCollections();
  const result = await runRuntime(observations, saved, { maxObservations: 0, maxHypotheses: 1 });
  assert.equal(result.hypothesesCreated, 0);
  assert.equal(result.hypothesesBlocked, 1);
  assert.equal(saved.hypotheses.length, 0);
  assert.equal(saved.strategies.length, 0);
  assert.equal((result.blockers as Array<{ code: string }>)[0].code, "hypothesis_insufficient_independent_occurrences");
}

async function duplicateCurrentObservationStillAggregates() {
  let currentObservation: MarketObservation | null = null;
  const saved = savedCollections();
  const observationRepository = {
    async save(observation: MarketObservation) {
      currentObservation = observation;
      return { inserted: false, record: observation, conflict: "idempotent" };
    },
    async eligibleSemanticGroups() {
      return [];
    },
    async eligibleForHypothesis() {
      assert.ok(currentObservation);
      return [
        occurrenceFrom(currentObservation, "durable-a", 20),
        occurrenceFrom(currentObservation, "durable-b", 10),
      ];
    },
  };
  const result = await runRuntime(observationRepository, saved, { maxObservations: 1, maxHypotheses: 1 });
  assert.equal(result.observationsCreated, 0);
  assert.equal(result.observationsDeduplicated, 1);
  assert.equal(result.hypothesesCreated, 1);
  assert.equal(saved.hypotheses.length, 1);
}

async function expiredSupportExcluded() {
  const observations = new InMemoryObservationRepository();
  seed(observations, [
    fixtureObservation("active", 10),
    fixtureObservation("expired", 20, { expiresAt: new Date(Date.now() - 60_000).toISOString() }),
  ]);
  const saved = savedCollections();
  const result = await runRuntime(observations, saved, { maxObservations: 0, maxHypotheses: 1 });
  assert.equal(result.hypothesesCreated, 0);
  assert.equal(result.hypothesesBlocked, 1);
  assert.equal(saved.hypotheses.length, 0);
}

async function duplicateEvidenceIdsRejected() {
  const duplicateEvidenceId = `evidence-${randomUUID()}`;
  const observations = new InMemoryObservationRepository();
  seed(observations, [
    fixtureObservation("same-evidence-a", 20, { evidenceId: duplicateEvidenceId }),
    fixtureObservation("same-evidence-b", 10, { evidenceId: duplicateEvidenceId }),
  ]);
  const saved = savedCollections();
  const result = await runRuntime(observations, saved, { maxObservations: 0, maxHypotheses: 1 });
  assert.equal(result.hypothesesCreated, 0);
  assert.equal(result.hypothesesBlocked, 1);
  assert.equal((result.blockers as Array<{ code: string }>)[0].code, "hypothesis_rejected_duplicate_evidence");
}

async function semanticMismatchNotCombined() {
  for (const variant of [
    fixtureObservation("other-symbol", 10, { symbol: "GBP_USD" }),
    fixtureObservation("other-timeframe", 10, { timeframe: "5m" }),
    fixtureObservation("other-detector", 10, { detectorId: "volatility-compression", observationType: "breakout" }),
    fixtureObservation("other-type", 10, { observationType: "volatility_compression" }),
    fixtureObservation("other-family", 10, { strategyFamily: "mean_reversion" }),
    fixtureObservation("missing-family", 10, { strategyFamily: undefined }),
  ]) {
    const observations = new InMemoryObservationRepository();
    seed(observations, [fixtureObservation(`base-${variant.observationId}`, 20), variant]);
    const saved = savedCollections();
    const result = await runRuntime(observations, saved, { maxObservations: 0, maxHypotheses: 5 });
    assert.equal(result.hypothesesCreated, 0);
    assert.equal(saved.hypotheses.length, 0);
  }
}

async function repeatedCycleIdempotency() {
  const observations = new InMemoryObservationRepository();
  seed(observations, [fixtureObservation("repeat-a", 20), fixtureObservation("repeat-b", 10)]);
  const saved = savedCollections();
  const hypotheses = new InMemoryHypothesisRepository();
  const first = await runRuntime(observations, saved, { maxObservations: 0, maxHypotheses: 1, hypotheses, requestedBy: "repeat-1" });
  const second = await runRuntime(observations, saved, { maxObservations: 0, maxHypotheses: 1, hypotheses, requestedBy: "repeat-2" });
  assert.equal(first.hypothesesCreated, 1);
  assert.equal(second.hypothesesCreated, 0);
  assert.equal(hypotheses.list().length, 1);
  assert.equal(saved.strategies.length, 1);
  assert.equal(saved.experiments.length, 1);
  assert.equal(saved.backtests.length, 1);
}

async function duplicateHypothesisDoesNotConsumeInsertedBudget() {
  const observations = new InMemoryObservationRepository();
  seed(observations, [
    fixtureObservation("dup-budget-a", 20, { symbol: "EUR_USD" }),
    fixtureObservation("dup-budget-b", 10, { symbol: "EUR_USD" }),
    fixtureObservation("insert-budget-a", 20, { symbol: "GBP_USD" }),
    fixtureObservation("insert-budget-b", 10, { symbol: "GBP_USD" }),
  ]);
  const saved = savedCollections();
  let hypothesisSaveCount = 0;
  const hypotheses = {
    async save(hypothesis: Record<string, unknown>) {
      hypothesisSaveCount += 1;
      if (hypothesisSaveCount === 1) return { inserted: false, record: hypothesis, conflict: "idempotent" };
      saved.hypotheses.push(hypothesis);
      return { inserted: true, record: hypothesis };
    },
  };
  const result = await runRuntime(observations, saved, { maxObservations: 0, maxHypotheses: 1, hypotheses });
  assert.equal(result.hypothesesCreated, 1);
  assert.equal(result.hypothesesEvaluated, 2);
  assert.equal(saved.hypotheses.length, 1);
  assert.equal(saved.strategies.length, 1);
}

function fixtureObservation(label: string, minutesAgo: number, overrides: Partial<MarketObservation> & { evidenceId?: string } = {}): MarketObservation {
  const now = Date.now();
  const observedAt = new Date(now - minutesAgo * 60_000).toISOString();
  const candleEnd = new Date(now - (minutesAgo - 1) * 60_000).toISOString();
  const sourceEventId = `event-${label}-${randomUUID()}`;
  const sourceDataHash = overrides.sourceDataHash ?? `hash-${label}-${randomUUID()}`;
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
    observationId: `obs-${label}-${randomUUID()}`,
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
    sourceDataIds: [`fixture:${label}`],
    sourceDataHash,
    metrics: { sampleSize: 80, spread: 0.0001, breakoutDistance: 0.001 },
    effectiveFrom: observedAt,
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
    evidence: [{ ...evidenceItem, evidenceId: overrides.evidenceId ?? evidenceItem.evidenceId }],
    contradictoryEvidence: [],
    confidence: 0.8,
    qualityScore: 0.8,
    contextEventId: sourceEventId,
    upstreamEventIds: [sourceEventId],
    correlationId: randomUUID(),
    causationId: `cause-${label}-${randomUUID()}`,
    lifecycle: "active",
    supersedesId: null,
    ...overrides,
  };
}

function occurrenceFrom(observation: MarketObservation, label: string, minutesAgo: number): MarketObservation {
  const occurrence = fixtureObservation(label, minutesAgo, {
    symbol: observation.symbol,
    timeframe: observation.timeframe,
    detectorId: observation.detectorId,
    observationType: observation.observationType,
    strategyFamily: observation.strategyFamily,
  });
  return occurrence;
}

function seed(repository: InMemoryObservationRepository, observations: MarketObservation[]) {
  for (const observation of observations) repository.save(observation);
}

function savedCollections() {
  return {
    hypotheses: [] as Record<string, unknown>[],
    strategies: [] as Record<string, unknown>[],
    experiments: [] as Record<string, unknown>[],
    backtests: [] as Record<string, unknown>[],
    court: [] as Record<string, unknown>[],
    rankings: [] as Record<string, unknown>[],
  };
}

async function runRuntime(
  observations: Pick<InMemoryObservationRepository, "save" | "eligibleForHypothesis" | "eligibleSemanticGroups">,
  saved: ReturnType<typeof savedCollections>,
  options: { maxObservations: number; maxHypotheses: number; hypotheses?: { save(record: never): unknown }; requestedBy?: string },
) {
  const runtime = createFinCoachV2Runtime({
    DATABASE_URL: "postgres://user:pass@localhost:5432/fincoach",
    FINCOACH_V2_RUNTIME_ENABLED: "true",
    FINCOACH_V2_RESEARCH_ENABLED: "true",
    FINCOACH_V2_PILOT_ENABLED: "true",
    FINCOACH_V2_AUTOSTART: "false",
    FINCOACH_V2_OBSERVATION_SYMBOLS: "EUR_USD",
    FINCOACH_V2_OBSERVATION_TIMEFRAMES: "1m",
    FINCOACH_V2_MAX_OBSERVATIONS_PER_CYCLE: String(options.maxObservations),
    FINCOACH_V2_MAX_HYPOTHESES_PER_CYCLE: String(options.maxHypotheses),
    FINCOACH_V2_MAX_EXPERIMENTS_PER_CYCLE: "5",
    FINCOACH_V2_MAX_BACKTESTS_PER_CYCLE: "5",
    FINCOACH_V2_HYPOTHESIS_LOOKBACK_HOURS: "24",
    FINCOACH_V2_CYCLE_TIMEOUT_MS: "120000",
    FINCOACH_LIVE_EXECUTION_ENABLED: "false",
  } as NodeJS.ProcessEnv);
  (runtime as unknown as { repositories: unknown }).repositories = repositories(observations, saved, options.hypotheses);
  return await runtime.runOnce({ requestedBy: options.requestedBy ?? randomUUID() }) as Record<string, unknown>;
}

function repositories(
  observations: Pick<InMemoryObservationRepository, "save" | "eligibleForHypothesis" | "eligibleSemanticGroups">,
  saved: ReturnType<typeof savedCollections>,
  hypotheses = {
    async save(record: Record<string, unknown>) {
      saved.hypotheses.push(record);
      return { inserted: true, record };
    },
  },
) {
  const saveTo = (collection: Record<string, unknown>[]) => async (record: Record<string, unknown>) => {
    collection.push(record);
    return { inserted: true, record };
  };
  return {
    orchestration: {
      acquireLease: async () => ({ leaseName: "fincoach-v2-runtime", workerId: "test-worker", fencingToken: 1 }),
      saveCycle: async (record: unknown) => ({ inserted: true, record }),
      updateCycleStatus: async (record: unknown) => record,
      checkpoint: async (record: unknown) => record,
      saveRetry: async (record: unknown) => record,
      releaseLease: async () => undefined,
    },
    runtime: { health: async () => undefined, recordBoot: async () => undefined },
    observations,
    hypotheses,
    strategies: { save: saveTo(saved.strategies) },
    experiments: { save: saveTo(saved.experiments) },
    backtests: { save: saveTo(saved.backtests) },
    courtroom: { save: saveTo(saved.court) },
    ranking: { save: saveTo(saved.rankings) },
    operations: { saveDetectorEvaluation: async () => undefined },
    pilot: {},
    forwardTesting: {},
    signals: {},
    evaluations: {},
    journal: {},
    learning: {},
    lifecycle: {},
    evolution: {},
    evidence: {},
  };
}

assert.deepEqual(semanticGroupFromObservation(fixtureObservation("group-key", 5)), {
  symbol: "EUR_USD",
  timeframe: "1m",
  detectorId: "breakout",
  observationType: "breakout",
  strategyFamily: "compression_breakout",
});

console.log("v2 research hypothesis aggregation tests passed");
