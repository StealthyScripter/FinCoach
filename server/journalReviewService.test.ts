import assert from "node:assert/strict";
import { journalReviewResultSchema } from "@shared/schema";
import { createSeedOverview } from "./storage";
import { journalReviewService } from "./journalReviewService";

const seed = createSeedOverview();
const journalEntry = seed.journalEntries[0];

const strong = journalReviewService.review({
  submission: {
    journalEntryId: journalEntry.id,
    reflection:
      "I followed the written plan, kept the position size within the predefined risk budget, respected the invalidation condition, and documented what would change next time.",
    followedPlan: true,
    respectedStop: true,
    positionSizingDiscipline: 92,
    emotionalState: "calm",
    lessonsLearned: ["Keep risk fixed before choosing size", "Wait for the event calendar before acting"],
  },
  journalEntry,
  scores: seed.proficiencyScores,
  progression: seed.progression,
  now: new Date("2026-06-15T12:00:00.000Z"),
});

journalReviewResultSchema.parse(strong);
assert.ok(strong.review.qualityScore >= 80);
assert.ok(strong.updatedScore.score > strong.previousScore);
assert.ok(strong.review.disciplineSignals.includes("Followed written plan"));
assert.ok(strong.unlocked.includes("Journal quality gate"));
assert.equal(strong.review.proficiencyCategory, "trading_psychology");

const weak = journalReviewService.review({
  submission: {
    journalEntryId: journalEntry.id,
    reflection: "I got frustrated and changed the plan after price moved against me, then wrote this review.",
    followedPlan: false,
    respectedStop: false,
    positionSizingDiscipline: 35,
    emotionalState: "revenge",
    lessonsLearned: ["Pause before next trade"],
  },
  journalEntry,
  scores: seed.proficiencyScores,
  progression: seed.progression,
});

assert.ok(weak.review.qualityScore < strong.review.qualityScore);
assert.ok(weak.review.mistakePatterns.includes("Deviated from written plan"));
assert.ok(weak.remediation.length >= 1);

console.log("journal review service tests passed");
