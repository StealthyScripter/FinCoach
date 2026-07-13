import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { TraderEmulatorV2EventTypes, TraderEmulatorsV2Service } from "./v2/trader-emulators";

const service = new TraderEmulatorsV2Service();
const now = "2026-01-01T12:00:00.000Z";
const base = { symbol: "EUR_USD", analyzedAt: now, observations: ["breakout"], evidence: [{ sourceEventId: randomUUID(), description: "breakout", weight: 0.9, expiresAt: "2026-01-01T12:10:00.000Z", timeframe: "1m" }], context: { liquidityState: "deep", spreadState: "tight", eventProximity: "none", dataQualityState: "fresh" }, correlationId: randomUUID(), causationId: randomUUID() };
const scalper = service.analyze({ ...base, profile: "scalper", timeframe: "1m" });
assert.equal(scalper.analysis.profile, "scalper");
assert.equal(scalper.analysis.opportunityState, "candidate");
assert.ok(scalper.events.some((event) => event.eventType === TraderEmulatorV2EventTypes.TraderOpportunityIdentified));
assert.throws(() => service.analyze({ ...base, profile: "scalper", timeframe: "1d" }), /does not support/);

const risky = service.analyze({ ...base, profile: "scalper", timeframe: "1m", context: { liquidityState: "thin", spreadState: "wide", eventProximity: "blackout" } });
assert.equal(risky.analysis.opportunityState, "none");
assert.ok(risky.events.some((event) => event.eventType === TraderEmulatorV2EventTypes.TraderRiskConcernRaised));

const day = service.analyze({ ...base, profile: "day_trader", timeframe: "15m" });
const swing = service.analyze({ ...base, profile: "swing_trader", timeframe: "4h", evidence: [{ ...base.evidence[0], expiresAt: "2026-01-02T12:00:00.000Z", timeframe: "4h" }] });
const position = service.analyze({ ...base, profile: "position_trader", timeframe: "1d", evidence: [{ ...base.evidence[0], expiresAt: "2026-02-01T12:00:00.000Z", timeframe: "1d" }] });
assert.notEqual(day.analysis.horizon, swing.analysis.horizon);
assert.notEqual(swing.analysis.horizon, position.analysis.horizon);
assert.deepEqual(service.analyze({ ...base, profile: "day_trader", timeframe: "15m" }).analysis, day.analysis);
assert.ok(!("order" in scalper.analysis) && !("entryPrice" in scalper.analysis) && !("stopLoss" in scalper.analysis));
assert.equal("submitOrder" in service, false);
console.log("v2 phase 7 trader-emulators tests passed");
