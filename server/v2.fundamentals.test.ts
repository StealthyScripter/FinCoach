import assert from "node:assert/strict";
import { FundamentalsV2EventTypes, FundamentalsV2Service, InMemoryFundamentalsRepository } from "./v2/fundamentals";

const service = new FundamentalsV2Service(new InMemoryFundamentalsRepository());
const economic = await service.ingestEconomic({
  eventId: "us-cpi-1",
  country: "US",
  currency: "USD",
  eventType: "inflation",
  scheduledAt: "2026-01-15T13:30:00.000Z",
  publishedAt: "2026-01-15T13:31:00.000Z",
  actual: 3.4,
  forecast: 3.1,
  previous: 3.2,
  revision: null,
  importance: "high",
  source: "fixture",
  sourceTimestamp: "2026-01-15T13:30:30.000Z",
  ingestedAt: "2026-01-15T13:31:05.000Z",
  expiresAt: "2026-02-15T13:30:00.000Z",
});
assert.equal(economic.event.surprise, 0.3);
assert.ok(economic.events.some((event) => event.eventType === FundamentalsV2EventTypes.EconomicSurpriseComputed));

const conflict = await service.ingestEconomic({ ...economic.event, actual: 3.5, surprise: undefined });
assert.ok(conflict.events.some((event) => event.eventType === FundamentalsV2EventTypes.FundamentalEvidenceConflicted));

await assert.rejects(() => service.ingestEconomic({ ...economic.event, eventId: "bad-time", sourceTimestamp: "2026-01-15T13:32:00.000Z" }), /publication-time/);

const corporate = await service.ingestCorporate({
  eventId: "aapl-earnings",
  symbol: "AAPL",
  eventType: "earnings",
  scheduledAt: "2026-01-28T21:00:00.000Z",
  publishedAt: "2026-01-28T21:01:00.000Z",
  values: { eps: 2.1, revenue: 100 },
  source: "fixture",
  expiresAt: "2026-04-28T21:00:00.000Z",
});
assert.equal(corporate.events[0].eventType, FundamentalsV2EventTypes.CorporateEventIngested);

const snapshotBefore = await service.snapshot({ symbol: "AAPL", currency: "USD", effectiveAt: "2026-01-15T13:00:00.000Z" });
assert.deepEqual(snapshotBefore.snapshot.economicEventIds, []);
const snapshotAfter = await service.snapshot({ symbol: "AAPL", currency: "USD", effectiveAt: "2026-01-29T00:00:00.000Z" });
assert.deepEqual(snapshotAfter.snapshot.economicEventIds, ["us-cpi-1"]);
assert.deepEqual(snapshotAfter.snapshot.corporateEventIds, ["aapl-earnings"]);

const rejected = service.extractClaim({
  claimId: "claim-1",
  source: "news-fixture",
  sourceTimestamp: "2026-01-15T12:00:00.000Z",
  extractionTimestamp: "2026-01-15T12:01:00.000Z",
  modelVersion: "fixture-model",
  claimType: "macro",
  structuredValues: { risk: "higher inflation" },
  confidence: 0.8,
  uncertainty: "single source",
  expiration: "2026-01-22T12:00:00.000Z",
  verificationStatus: "unverified",
  citation: "fixture://news/1",
});
assert.equal(rejected.events[0].eventType, FundamentalsV2EventTypes.FundamentalClaimRejected);
assert.equal("submitOrder" in service, false);

console.log("v2 phase 4 fundamentals tests passed");
