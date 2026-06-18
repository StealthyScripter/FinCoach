import assert from "node:assert/strict";
import { knowledgeGraphReportSchema } from "@shared/schema";
import { knowledgeGraphService } from "./knowledgeGraphService";
import { createSeedOverview } from "./storage";

const report = knowledgeGraphService.build(createSeedOverview(), null, new Date("2026-01-15T14:00:00.000Z"));

knowledgeGraphReportSchema.parse(report);
assert.ok(report.nodes.length > 0);
assert.ok(report.edges.length > 0);
assert.ok(report.nodes.some((node) => node.type === "Asset"));
assert.ok(report.traversal.visitedNodeIds.length > 0);

console.log("knowledgeGraphService smoke tests passed");
