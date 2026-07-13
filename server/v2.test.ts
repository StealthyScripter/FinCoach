import assert from "node:assert/strict";
import {
  FINCOACH_V2_SCHEMA_VERSION,
  assertEventLineage,
  assertV2ModuleDependency,
  createDomainEvent,
  domainEventSchema,
  getV2CompatibilityBoundary,
  getV2DependencyRules,
  moduleErrorSchema,
  readV2FeatureFlags,
  toLineageReference,
  validateDomainEvent,
} from "./v2";

const now = new Date("2026-01-15T14:00:00.000Z");

const imported = createDomainEvent({
  eventType: "MarketDataImported",
  sourceModule: "market-data",
  payload: { symbol: "EUR_USD", timeframe: "1h", candles: 100 },
  occurredAt: now,
});

assert.equal(imported.schemaVersion, FINCOACH_V2_SCHEMA_VERSION);
assert.equal(imported.sourceModule, "market-data");
assert.equal(validateDomainEvent(imported).eventId, imported.eventId);
assert.throws(() => {
  (imported.payload as Record<string, unknown>).symbol = "GBP_USD";
}, /read only|Cannot assign/);

assert.throws(() => domainEventSchema.parse({
  ...imported,
  correlationId: undefined,
}), /correlationId/);

assert.throws(() => domainEventSchema.parse({
  ...imported,
  causationId: imported.eventId,
}), /causationId cannot reference/);

assert.throws(() => domainEventSchema.parse({
  ...imported,
  schemaVersion: "fincoach.v2.event.999",
}), /Invalid literal value/);

const context = createDomainEvent({
  eventType: "MarketContextCreated",
  sourceModule: "market-context",
  payload: { symbol: "EUR_USD", session: "london" },
  correlationId: imported.correlationId,
  causationId: imported.eventId,
  metadata: { lineage: [toLineageReference(imported)] },
  occurredAt: new Date("2026-01-15T15:00:00.000Z"),
});

assert.equal(assertEventLineage(context, true), true);
assert.throws(() => assertEventLineage({
  ...context,
  metadata: { lineage: [toLineageReference(imported), toLineageReference(imported)] },
}), /Duplicate lineage reference/);
assert.throws(() => assertEventLineage({ ...context, causationId: null }, true), /requires causationId/);

assert.deepEqual(readV2FeatureFlags({}), {
  FINCOACH_V2_ENABLED: false,
  FINCOACH_V2_RESEARCH_ENABLED: false,
  FINCOACH_V2_FORWARD_TESTING_ENABLED: false,
  FINCOACH_V2_SIGNAL_PUBLISHING_ENABLED: false,
});
assert.equal(readV2FeatureFlags({ FINCOACH_V2_ENABLED: "true" }).FINCOACH_V2_ENABLED, true);
assert.equal(readV2FeatureFlags({ FINCOACH_V2_ENABLED: "1" }).FINCOACH_V2_ENABLED, false);

const boundary = getV2CompatibilityBoundary({ MARKETPILOT_DEMO_ONLY: "true", OANDA_ENV: "practice" });
assert.equal(boundary.enabled, false);
assert.equal(boundary.v1BehaviorPreserved, true);
assert.equal(boundary.liveExecutionBlocked, true);
assert.equal(boundary.demoOnly.safe, true);
assert.equal(boundary.forwardTestingEnabled, false);

const unsafeBoundary = getV2CompatibilityBoundary({
  MARKETPILOT_DEMO_ONLY: "true",
  FINCOACH_V2_ENABLED: "true",
  FINCOACH_V2_FORWARD_TESTING_ENABLED: "true",
  OANDA_ENV: "live",
});
assert.equal(unsafeBoundary.forwardTestingEnabled, false);
assert.ok(unsafeBoundary.demoOnly.violations.some((violation) => violation.includes("OANDA_ENV=live")));

assert.equal(assertV2ModuleDependency("hypothesis", "contracts"), true);
assert.equal(assertV2ModuleDependency("orchestration", "market-data"), true);
assert.throws(() => assertV2ModuleDependency("hypothesis", "market-data"), /dependency violation/);
assert.ok(getV2DependencyRules()["signals"].includes("courtroom"));

assert.throws(() => moduleErrorSchema.parse({
  module: "market-data",
  code: "UNCLASSIFIED",
  category: "unknown",
  retryable: true,
  terminal: false,
  message: "unexpected failure",
  correlationId: imported.correlationId,
  occurredAt: now.toISOString(),
  metadata: {},
}), /unknown errors must fail closed/);

assert.equal(moduleErrorSchema.parse({
  module: "market-data",
  code: "UNCLASSIFIED",
  category: "unknown",
  retryable: false,
  terminal: true,
  message: "unexpected failure",
  correlationId: imported.correlationId,
  occurredAt: now.toISOString(),
  metadata: {},
}).terminal, true);

console.log("v2 phase 0 contract tests passed");
