import assert from "node:assert/strict";
import { greeksReportSchema } from "@shared/schema";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";

const report = institutionalAnalyticsService.greeks.analyze("SPY");
greeksReportSchema.parse(report);
assert.equal(report.underlying, "SPY");
assert.ok(report.positionGreeks.delta !== 0);
assert.ok(report.riskSummary.some((item) => /No live/.test(item)));
console.log("greeksEngine smoke tests passed");
