import assert from "node:assert/strict";
import { ingestionSnapshotSchema } from "@shared/schema";
import { IngestionService } from "./ingestionService";

const service = new IngestionService();
const snapshot = await service.getSnapshot(new Date("2026-06-15T12:00:00.000Z"));

ingestionSnapshotSchema.parse(snapshot);
assert.equal(snapshot.providerMode, "demo");
assert.ok(snapshot.marketPrices.some((item) => item.symbol === "SPY"));
assert.ok(snapshot.economicEvents.some((item) => item.impact === "high"));
assert.ok(snapshot.newsArticles.some((item) => item.relatedSymbols.includes("SPY")));
assert.ok(snapshot.freshness.newestTimestamp);
assert.ok(snapshot.requiredActions.length > 0);

console.log("ingestionService smoke tests passed");
