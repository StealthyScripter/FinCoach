import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { ChartAnalysisV2Service } from "./v2/chart-analysis";
import { FeatureEngineeringV2Service } from "./v2/feature-engineering";
import { FundamentalsV2Service, InMemoryFundamentalsRepository } from "./v2/fundamentals";
import { MarketContextV2Service } from "./v2/market-context";
import { MarketDataV2Service } from "./v2/market-data";
import { evidence, ObservationsV2Service } from "./v2/observations";
import { ReplayV2Service, type ReplaySourceEvent } from "./v2/replay";
import { TraderEmulatorsV2Service } from "./v2/trader-emulators";

const marketData = new MarketDataV2Service();
const context = new MarketContextV2Service();
const chart = new ChartAnalysisV2Service();
const features = new FeatureEngineeringV2Service();
const fundamentals = new FundamentalsV2Service(new InMemoryFundamentalsRepository());
const observations = new ObservationsV2Service();
const replay = new ReplayV2Service();
const traders = new TraderEmulatorsV2Service();
const correlationId = randomUUID();
const start = Date.parse("2026-01-01T00:00:00.000Z");
const candles = Array.from({ length: 30 }, (_, index) => marketData.normalizeCandle({ symbol: "EUR_USD", timeframe: "1h", timestamp: new Date(start + index * 60 * 60_000), open: 1.1 + index * 0.0003, high: 1.101 + index * 0.0003, low: 1.099 + index * 0.0003, close: 1.1008 + index * 0.0003, volume: 100 + index, provider: "fixture" }));
const quote = marketData.normalizeQuote({ symbol: "EUR_USD", bid: 1.11, ask: 1.1102, provider: "fixture", observedAt: candles.at(-1)!.timestamp });
const ctx = context.create({ symbol: "EUR_USD", assetClass: "forex", observedAt: candles.at(-1)!.timestamp, quote, candles, higherTimeframeDirection: "up" });
const charted = chart.compute({ symbol: "EUR_USD", timeframe: "1h", candles });
const vector = await features.compute({ symbol: "EUR_USD", timeframe: "1h", effectiveAt: charted.features.computedAt, chartFeatureHistory: [charted.features, charted.features, charted.features, charted.features, charted.features], contextHistory: [ctx.context], inputEventIds: [ctx.events[0].eventId, charted.events[0].eventId], correlationId, causationId: charted.events[0].eventId });
const econ = await fundamentals.ingestEconomic({ eventId: "nfp", country: "US", currency: "USD", eventType: "employment", scheduledAt: "2026-01-01T12:00:00.000Z", publishedAt: "2026-01-01T12:01:00.000Z", actual: 250, forecast: 200, previous: 190, revision: null, importance: "high", source: "fixture", sourceTimestamp: "2026-01-01T12:00:30.000Z", ingestedAt: "2026-01-01T12:01:01.000Z", expiresAt: "2026-02-01T00:00:00.000Z" });
const obs = observations.create({ symbol: "EUR_USD", timeframe: "1h", observedAt: charted.features.computedAt, contextEventId: ctx.events[0].eventId, upstreamEventIds: [ctx.events[0].eventId, charted.events[0].eventId, vector.events[0].eventId, econ.events[0].eventId], correlationId, causationId: vector.events[0].eventId, evidence: [evidence("chart", charted.events[0].eventId, "structure.breakOfStructure", true, charted.features.computedAt), evidence("chart", charted.events[0].eventId, "volatility.expansion", true, charted.features.computedAt), evidence("fundamental", econ.events[0].eventId, "economic.surprise", econ.event.surprise, econ.event.publishedAt)] });
assert.ok(obs.observations.length > 0);
const sourceEvents: ReplaySourceEvent[] = obs.events.map((event) => ({ eventId: event.eventId, sourceId: "observation", priority: 1, effectiveAt: charted.features.computedAt, publishedAt: charted.features.computedAt, type: event.eventType, payload: event.payload }));
replay.start({ replayId: "milestone-replay", start: "2026-01-01T00:00:00.000Z", end: "2026-01-03T00:00:00.000Z", mode: "step", seed: 1, instruments: ["EUR_USD"], timeframes: ["1h"] }, sourceEvents);
assert.equal(replay.step("milestone-replay", sourceEvents).delivered.length, 1);
const analyses = [
  traders.analyze({ profile: "scalper", symbol: "EUR_USD", timeframe: "1m", analyzedAt: charted.features.computedAt, observations: obs.observations.map((o) => o.observationId), evidence: [{ sourceEventId: obs.events[0].eventId, description: "observation", weight: 0.8, expiresAt: obs.observations[0].expiresAt, timeframe: "1m" }], context: ctx.context, correlationId, causationId: obs.events[0].eventId }).analysis,
  traders.analyze({ profile: "day_trader", symbol: "EUR_USD", timeframe: "15m", analyzedAt: charted.features.computedAt, observations: obs.observations.map((o) => o.observationId), evidence: [{ sourceEventId: obs.events[0].eventId, description: "observation", weight: 0.8, expiresAt: obs.observations[0].expiresAt, timeframe: "15m" }], context: ctx.context, correlationId, causationId: obs.events[0].eventId }).analysis,
  traders.analyze({ profile: "swing_trader", symbol: "EUR_USD", timeframe: "4h", analyzedAt: charted.features.computedAt, observations: obs.observations.map((o) => o.observationId), evidence: [{ sourceEventId: obs.events[0].eventId, description: "observation", weight: 0.8, expiresAt: "2026-01-05T00:00:00.000Z", timeframe: "4h" }], context: ctx.context, correlationId, causationId: obs.events[0].eventId }).analysis,
  traders.analyze({ profile: "position_trader", symbol: "EUR_USD", timeframe: "1d", analyzedAt: charted.features.computedAt, observations: obs.observations.map((o) => o.observationId), evidence: [{ sourceEventId: obs.events[0].eventId, description: "observation", weight: 0.8, expiresAt: "2026-02-01T00:00:00.000Z", timeframe: "1d" }], context: ctx.context, correlationId, causationId: obs.events[0].eventId }).analysis,
];
assert.equal(new Set(analyses.map((analysis) => analysis.horizon)).size, 4);
assert.ok(analyses.every((analysis) => analysis.correlationId === correlationId));
assert.ok(analyses.every((analysis) => !("order" in analysis) && !("entryPrice" in analysis)));
console.log("v2 market intelligence milestone tests passed");
