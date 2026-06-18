import assert from "node:assert/strict";
import {
  agentConsensusReportSchema,
  behavioralIntelligenceReportSchema,
  crossAssetRelationshipReportSchema,
  factorExposureReportSchema,
  greeksReportSchema,
  institutionalAnalyticsSnapshotSchema,
  monteCarloSimulationReportSchema,
  proficiencyGraphReportSchema,
  regimeReportSchema,
  stressTestReportSchema,
} from "@shared/schema";
import { agentOrchestrationService } from "./agentOrchestrationService";
import { institutionalAnalyticsService } from "./institutionalAnalyticsService";
import { createSeedOverview } from "./storage";

const overview = createSeedOverview();
const now = new Date("2026-01-15T14:00:00.000Z");
const agents = agentOrchestrationService.generateOutputs(overview, now);

const crossAsset = institutionalAnalyticsService.correlation.analyze(overview.portfolio, now);
crossAssetRelationshipReportSchema.parse(crossAsset);
assert.ok(crossAsset.relationships.length > 0);

const factors = institutionalAnalyticsService.factors.analyze(overview.portfolio, now);
factorExposureReportSchema.parse(factors);
assert.ok(factors.riskContributions.length > 0);

const monteCarlo = institutionalAnalyticsService.monteCarlo.run(overview.portfolio, now, 250, 12);
monteCarloSimulationReportSchema.parse(monteCarlo);
assert.equal(monteCarlo.simulationCount, 250);
assert.ok(monteCarlo.drawdownDistribution.length > 0);

const stress = institutionalAnalyticsService.stress.run(overview.portfolio, now);
stressTestReportSchema.parse(stress);
assert.ok(stress.scenarios.some((scenario) => scenario.id === "2008"));

const greeks = institutionalAnalyticsService.greeks.analyze("SPY", 548.32, now);
greeksReportSchema.parse(greeks);
assert.ok(greeks.payoffPoints.length > 0);

const regime = institutionalAnalyticsService.regime.classify(overview, now);
regimeReportSchema.parse(regime);
assert.ok(regime.affectedAssetClasses.length > 0);

const consensus = institutionalAnalyticsService.consensus.evaluate(agents, now);
agentConsensusReportSchema.parse(consensus);
assert.ok(consensus.confidenceDispersion >= 0);

const behavior = institutionalAnalyticsService.behavior.evaluate(overview, now);
behavioralIntelligenceReportSchema.parse(behavior);
assert.ok(behavior.behavioralScore >= 0);

const proficiencyGraph = institutionalAnalyticsService.proficiencyGraph.build(overview, now);
proficiencyGraphReportSchema.parse(proficiencyGraph);
assert.ok(proficiencyGraph.edges.length > 0);

const snapshot = institutionalAnalyticsService.snapshot(overview, now);
institutionalAnalyticsSnapshotSchema.parse(snapshot);
assert.equal(snapshot.generatedAt, now.toISOString());

console.log("institutionalAnalyticsService smoke tests passed");
