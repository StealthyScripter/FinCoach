import assert from "node:assert/strict";
import { agentConsensusReportSchema } from "@shared/schema";
import { agentOrchestrationService } from "./agentOrchestrationService";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { createSeedOverview } from "./storage";

const agents = agentOrchestrationService.generateOutputs(createSeedOverview());
const report = institutionalAnalyticsService.consensus.evaluate(agents);
agentConsensusReportSchema.parse(report);
assert.ok(report.consensusScore >= 0);
assert.ok(report.minorityOpinions.length > 0);
console.log("agentConsensusService smoke tests passed");
