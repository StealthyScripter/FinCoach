import assert from "node:assert/strict";
import { monteCarloSimulationReportSchema } from "@shared/schema";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { createSeedOverview } from "./storage";

const report = institutionalAnalyticsService.monteCarlo.run(createSeedOverview().portfolio, new Date("2026-01-15T14:00:00.000Z"), 300, 18);
monteCarloSimulationReportSchema.parse(report);
assert.equal(report.simulationCount, 300);
assert.equal(report.horizonMonths, 18);
assert.ok(report.confidenceBands.length === 18);
console.log("monteCarloSimulationService smoke tests passed");
