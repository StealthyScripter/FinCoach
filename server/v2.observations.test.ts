import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { evidence, ObservationsV2EventTypes, ObservationsV2Service } from "./v2/observations";

const service = new ObservationsV2Service();
const correlationId = randomUUID();
const contextEventId = randomUUID();
const chartEventId = randomUUID();
const observedAt = "2026-01-01T12:00:00.000Z";
const input = {
  symbol: "EUR_USD",
  timeframe: "1h",
  observedAt,
  contextEventId,
  upstreamEventIds: [contextEventId, chartEventId],
  correlationId,
  causationId: chartEventId,
  evidence: [
    evidence("chart", chartEventId, "structure.breakOfStructure", true, observedAt),
    evidence("chart", chartEventId, "volatility.expansion", true, observedAt),
    evidence("chart", chartEventId, "liquidity.sweep", true, observedAt),
  ],
};
const created = service.create(input);
assert.ok(created.observations.some((obs) => obs.observationType === "breakout"));
assert.ok(created.observations.some((obs) => obs.observationType === "liquidity_sweep"));
assert.ok(created.events.every((event) => event.eventType === ObservationsV2EventTypes.MarketObservationCreated));
assert.ok(created.observations.every((obs) => obs.correlationId === correlationId && obs.contextEventId === contextEventId));
assert.ok(created.observations.every((obs) => !("entryPrice" in obs) && !("stopLoss" in obs)));

const duplicate = service.create(input);
assert.equal(duplicate.observations.length, 0);
const changed = service.create({ ...input, observedAt: "2026-01-01T13:00:00.000Z", evidence: [...input.evidence, evidence("fundamental", randomUUID(), "event.blackout", false, observedAt)] });
assert.ok(changed.observations.length > 0);
assert.throws(() => service.create({ ...input, contextEventId: "" }), /lineage/);
assert.throws(() => service.create({ ...input, evidence: [evidence("chart", chartEventId, "structure.breakOfStructure", true, "2026-01-01T13:00:00.000Z")] }), /future evidence/);
const insufficient = service.create({ ...input, observedAt: "2026-01-01T14:00:00.000Z", evidence: [evidence("context", contextEventId, "dataQualityState", "fresh", observedAt)] });
assert.equal(insufficient.events[0].eventType, ObservationsV2EventTypes.ObservationEvidenceInsufficient);
assert.equal("submitOrder" in service, false);
console.log("v2 phase 5 observations tests passed");
