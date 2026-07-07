import assert from "node:assert/strict";
import { StrategyMachineCoreService, createEvent, toEventReference, validateEventReferences, InMemoryEventRepository } from "./strategy-machine/core";

const repository = new InMemoryEventRepository();
const core = new StrategyMachineCoreService(repository);

const registered = core.registerModule("market-data");
assert.equal(registered.module, "core");
assert.equal(registered.type, "strategy-machine.core.ModuleRegistered");
assert.ok(core.registry().some((module) => module.name === "market-data"));
assert.ok(core.eventCatalog().includes("PatternDetected"));

const snapshot = createEvent({
  type: "MarketSnapshotCreated",
  module: "market-data",
  payload: { instrument: "EUR_USD", bid: 1.1, ask: 1.1002 },
  correlationId: registered.correlationId,
  causationId: registered.id,
  sourceEventRefs: [toEventReference(registered)],
  occurredAt: new Date("2026-01-01T00:00:00.000Z"),
});
repository.append(snapshot);

assert.equal(snapshot.contractVersion, 1);
assert.equal(snapshot.schemaVersion, "strategy-machine.v1");
assert.equal(snapshot.causationId, registered.id);
assert.equal(snapshot.sourceEventRefs[0].eventId, registered.id);
assert.equal(validateEventReferences(snapshot.sourceEventRefs), true);
assert.equal(core.validateLineage(snapshot.id), true);

assert.throws(() => {
  (snapshot.payload as Record<string, unknown>).bid = 9;
}, /read only|Cannot assign/);

assert.throws(() => validateEventReferences([toEventReference(snapshot), toEventReference(snapshot)]), /Duplicate/);
assert.throws(() => core.assertBoundary({ caller: "hypothesis", target: "market-data", access: "repository" }), /boundary/);
assert.equal(core.assertBoundary({ caller: "hypothesis", target: "market-data", access: "contract" }), true);

console.log("strategy machine core tests passed");
