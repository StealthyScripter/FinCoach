import assert from "node:assert/strict";
import { eventLogService } from "./eventLogService";
import { institutionalAnalyticsArchiveService } from "./institutionalAnalyticsArchiveService";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { createSeedOverview } from "./storage";

eventLogService.clearForTest();
const overview = createSeedOverview();
const snapshot = institutionalAnalyticsService.snapshot(overview, new Date("2026-01-15T14:00:00.000Z"));

const event = institutionalAnalyticsArchiveService.record(snapshot, overview);

assert.equal(event.type, "analytics.snapshot_recorded");
assert.equal(event.sourceService, "institutional-analytics-service");
assert.equal(event.payload.regime, snapshot.regime.primaryRegime);
assert.equal(event.payload.consensusScore, snapshot.consensus.consensusScore);
assert.equal(institutionalAnalyticsArchiveService.latest().length, 1);
assert.equal(eventLogService.countByType("analytics.snapshot_recorded"), 1);

console.log("institutionalAnalyticsArchiveService smoke tests passed");
