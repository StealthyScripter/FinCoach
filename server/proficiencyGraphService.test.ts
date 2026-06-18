import assert from "node:assert/strict";
import { proficiencyGraphReportSchema } from "@shared/schema";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { createSeedOverview } from "./storage";

const report = institutionalAnalyticsService.proficiencyGraph.build(createSeedOverview());
proficiencyGraphReportSchema.parse(report);
assert.ok(report.nodes.length > 0);
assert.ok(report.edges.some((edge) => edge.relationship === "prerequisite"));
console.log("proficiencyGraphService smoke tests passed");
