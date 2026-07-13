import assert from "node:assert/strict";
import { StrategyEvolutionV2EventTypes, StrategyEvolutionV2Service } from "./v2/strategy-evolution";

const correlationId = "00000000-0000-4000-8000-000000000021";
const parent = {
  strategyId: "strategy-parent",
  strategyVersion: 3,
  parameters: { stopPips: 20, targetPips: 40, session: "all" },
  allowedBounds: {
    stopPips: { min: 15, max: 25 },
    targetPips: { min: 35, max: 50 },
  },
  approvedRuleChanges: ["add-session-filter"],
  lineageEventIds: ["court-event", "ranking-event", "lesson-event"],
};

const request = {
  proposalId: "evolution-1",
  parent,
  evidenceIds: ["lesson-1", "ml-evidence-1"],
  mutations: [
    { parameter: "stopPips", from: 20, to: 18, reason: "reduce adverse excursion" },
    { parameter: "session", from: "all", to: "london", reason: "specialize to learned session" },
  ],
  ruleChanges: ["add-session-filter"],
  createdAt: "2026-01-03T00:00:00.000Z",
  correlationId,
  causationId: null,
};

const service = new StrategyEvolutionV2Service();
const missing = service.propose({ ...request, parent: null });
assert.equal(missing.proposal, null);
assert.equal(missing.events[0].payload.reason, "missing_parent");

const invalid = service.propose({
  ...request,
  proposalId: "invalid-bounds",
  mutations: [{ parameter: "stopPips", from: 20, to: 40, reason: "outside approved bound" }],
});
assert.equal(invalid.proposal, null);
assert.equal(invalid.events[0].payload.reason, "mutation_out_of_bounds");

const proposed = service.propose(request);
assert.equal(proposed.proposal?.schemaVersion, "fincoach.v2.strategy-revision.1");
assert.equal(proposed.proposal?.parentStrategyId, "strategy-parent");
assert.equal(proposed.proposal?.childStrategyId, "strategy-parent-child-aed514d1");
assert.equal(proposed.proposal?.status, "proposed");
assert.deepEqual(proposed.proposal?.lineageEventIds, ["court-event", "ranking-event", "lesson-event", "lesson-1", "ml-evidence-1"]);
assert.equal(proposed.events[0].eventType, StrategyEvolutionV2EventTypes.StrategyRevisionProposed);

const replay = service.propose(request);
assert.equal(replay.events[0].eventType, StrategyEvolutionV2EventTypes.StrategyRevisionDuplicateSuppressed);
assert.deepEqual(replay.proposal, proposed.proposal);

const unauthorizedRule = service.propose({ ...request, proposalId: "bad-rule", ruleChanges: ["remove-risk-filter"] });
assert.equal(unauthorizedRule.events[0].payload.reason, "unauthorized_rule_change");

const restarted = new StrategyEvolutionV2Service(service.repositorySnapshot());
assert.equal(restarted.propose(request).events[0].eventType, StrategyEvolutionV2EventTypes.StrategyRevisionDuplicateSuppressed);

const concurrent = await Promise.all(Array.from({ length: 5 }, () => restarted.propose({
  ...request,
  proposalId: "evolution-concurrent",
  mutations: [{ parameter: "targetPips", from: 40, to: 45, reason: "increase reward in supportive regime" }],
})));
assert.equal(concurrent.filter(result => result.events[0].eventType === StrategyEvolutionV2EventTypes.StrategyRevisionProposed).length, 1);
assert.equal(concurrent.filter(result => result.events[0].eventType === StrategyEvolutionV2EventTypes.StrategyRevisionDuplicateSuppressed).length, 4);
assert.equal("promoteStrategy" in service || "approveStrategy" in service || "runExperiment" in service, false);

console.log("v2 phase 21 strategy-evolution tests passed");
