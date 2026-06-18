import assert from "node:assert/strict";
import { proficiencyAssessmentResultSchema } from "@shared/schema";
import { createSeedOverview } from "./storage";
import { proficiencyAssessmentService } from "./proficiencyAssessmentService";

const seed = createSeedOverview();
const passing = proficiencyAssessmentService.assess({
  submission: {
    moduleId: "module-risk-sizing",
    category: "risk_management",
    score: 88,
    answers: { drawdown: "risk first" },
    reflection: "I reduced position size before adding exposure and separated facts from interpretation in the plan.",
  },
  scores: seed.proficiencyScores,
  modules: seed.modules,
  progression: seed.progression,
  now: new Date("2026-06-15T12:00:00.000Z"),
});

proficiencyAssessmentResultSchema.parse(passing);
assert.equal(passing.passed, true);
assert.equal(passing.quizResult.passed, true);
assert.ok(passing.updatedScore.score > passing.previousScore);
assert.ok(passing.updatedScore.evidence[0].includes("Quiz Risk"));
assert.equal(passing.module.status, "unlocked");

const failing = proficiencyAssessmentService.assess({
  submission: {
    moduleId: "module-options-safety",
    category: "options",
    score: 45,
    answers: {},
  },
  scores: seed.proficiencyScores,
  modules: seed.modules,
  progression: seed.progression,
  now: new Date("2026-06-15T12:00:00.000Z"),
});

assert.equal(failing.passed, false);
assert.ok(failing.remediation.length >= 1);
assert.equal(failing.quizResult.feedback[0], "Did not pass Options Max Loss and Assignment Risk; remediation assigned before unlock.");

const strongScores = seed.proficiencyScores.map((score) => ({
  ...score,
  score: score.category === "options" ? 86 : 90,
}));
const stageReady = proficiencyAssessmentService.assess({
  submission: {
    moduleId: "module-options-safety",
    category: "options",
    score: 95,
    answers: {},
    reflection: "I can explain maximum loss, assignment risk, liquidity, and why defined-risk structures are required.",
  },
  scores: strongScores,
  modules: seed.modules,
  progression: seed.progression,
});

assert.equal(stageReady.progression.currentStage, "supervised_live");
assert.equal(stageReady.progression.liveTradingUnlock, "available");

console.log("proficiency assessment service tests passed");
