import assert from "node:assert/strict";
import { memoryHealthSchema, memoryRecordSchema } from "@shared/schema";
import { agentMemoryService } from "./memoryService";
import { createSeedOverview } from "./storage";

agentMemoryService.clearForTest();
agentMemoryService.hydrateFromOverview(createSeedOverview());

const decision = agentMemoryService.shortTerm.store({
  kind: "agent_decision",
  text: "Risk Officer required more research before approving a paper ticket.",
  tags: ["risk", "paper"],
  metadata: { decision: "require_more_research" },
});
const research = agentMemoryService.longTerm.store({
  kind: "research_report",
  text: "SPY moved on rates pressure and dollar strength with partial verification.",
  tags: ["research", "SPY"],
  metadata: { confidence: 74 },
});
const lesson = agentMemoryService.semantic.store({
  kind: "lesson_learned",
  text: "Risk review must happen before any paper ticket is filled.",
  tags: ["risk", "paper", "ticket"],
  metadata: { source: "test" },
});

memoryRecordSchema.parse(decision);
memoryRecordSchema.parse(research);
memoryRecordSchema.parse(lesson);
assert.ok(agentMemoryService.shortTerm.recent(10).some((record) => record.id === decision.id));
assert.ok(agentMemoryService.longTerm.findByTag("research").length > 0);
assert.ok(agentMemoryService.semantic.searchSimilar("risk paper ticket").length > 0);

const health = agentMemoryService.health(new Date("2026-01-15T14:00:00.000Z"));
memoryHealthSchema.parse(health);
assert.equal(health.shortTerm.status, "healthy");
assert.ok(health.longTerm.records > 0);
assert.ok(health.semantic.records > 0);

console.log("memoryService smoke tests passed");
