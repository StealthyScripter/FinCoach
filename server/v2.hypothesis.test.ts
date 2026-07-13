import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { HypothesisV2EventTypes, HypothesisV2Service } from "./v2/hypothesis";

const service = new HypothesisV2Service();
const base = {
  statement: "London breakout after compression outperforms baseline",
  targetPopulation: { symbols: ["EUR_USD"], assetClasses: ["forex"], timeframes: ["1h"], sessions: ["london"], regimes: ["trend"] },
  conditions: [{ field: "observationType", operator: "==" as const, value: "breakout" }, { field: "feature.rsi_percentile", operator: ">" as const, value: 0.7 }],
  expectedOutcome: { metric: "probability" as const, operator: ">" as const, value: 0.55, horizon: "next_4h" },
  baseline: { baselineId: "unconditional-london-breakout", description: "Unconditional London breakout", metric: "probability", value: 0.5 },
  invalidationCriteria: [{ field: "close", operator: "<" as const, value: "breakout_level" }],
  minimumSampleSize: 30,
  minimumIndependentOccurrences: 2,
  mechanism: "Compression followed by session liquidity expansion may create continuation.",
  evidenceEventIds: [randomUUID(), randomUUID()],
  contradictoryEvidenceEventIds: [randomUUID()],
  sourceObservationIds: ["obs-1", "obs-2"],
  sourceTraderAnalysisIds: ["analysis-1"],
  correlationId: randomUUID(),
  causationId: randomUUID(),
};
const created = service.generate(base);
assert.equal(created.hypothesis?.status, "ready_for_rules");
assert.ok(created.events.some((event) => event.eventType === HypothesisV2EventTypes.HypothesisCreated));
assert.ok(created.hypothesis!.baseline);
assert.ok(created.hypothesis!.invalidationCriteria.length > 0);
assert.ok(created.hypothesis!.confidence >= 0 && created.hypothesis!.confidence <= 1);
const duplicate = service.generate({ ...base, conditions: [...base.conditions].reverse() });
assert.equal(duplicate.events[0].eventType, HypothesisV2EventTypes.HypothesisDuplicateDetected);
assert.equal(created.hypothesis?.fingerprint, duplicate.hypothesis?.fingerprint);
assert.equal(service.generate({ ...base, baseline: undefined as never }).events[0].eventType, HypothesisV2EventTypes.HypothesisRejected);
assert.equal(service.generate({ ...base, evidenceEventIds: [randomUUID()], sourceObservationIds: ["obs-1"] }).events[0].eventType, HypothesisV2EventTypes.HypothesisInsufficientEvidence);
assert.equal(service.generate({ ...base, conditions: [{ field: "probability", operator: ">" as const, value: 0.5 }] }).events[0].eventType, HypothesisV2EventTypes.HypothesisRejected);
assert.equal(service.generate({ ...base, conditions: [{ field: "future.close", operator: ">" as const, value: 1, usesFutureData: true }] }).events[0].eventType, HypothesisV2EventTypes.HypothesisRejected);
assert.equal("entryConditions" in created.hypothesis!, false);
assert.equal("submitOrder" in service, false);
console.log("v2 phase 8 hypothesis tests passed");
