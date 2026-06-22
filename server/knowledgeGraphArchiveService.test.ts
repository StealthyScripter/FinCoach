import assert from "node:assert/strict";
import { eventLogService } from "./eventLogService";
import { knowledgeGraphArchiveService } from "./knowledgeGraphArchiveService";
import { knowledgeGraphService } from "./knowledgeGraphService";
import { createSeedOverview } from "./storage";

eventLogService.clearForTest();
const overview = createSeedOverview();
const report = knowledgeGraphService.build(overview, null, new Date("2026-01-15T14:00:00.000Z"));

const event = knowledgeGraphArchiveService.record(report, overview);

assert.equal(event.type, "knowledge.graph_built");
assert.equal(event.sourceService, "knowledge-graph-service");
assert.equal(event.payload.nodeCount, report.nodes.length);
assert.equal(event.payload.edgeCount, report.edges.length);
assert.equal(knowledgeGraphArchiveService.latest().length, 1);
assert.equal(eventLogService.countByType("knowledge.graph_built"), 1);

console.log("knowledgeGraphArchiveService smoke tests passed");
