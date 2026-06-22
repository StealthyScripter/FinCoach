import assert from "node:assert/strict";
import { buildIntelligenceLessonHighlight, buildMemoryActionChecklist, buildMemoryInfluenceCue, buildPredictionLessonCue, compactText, decisionCardHighlights } from "../shared/assistantPresentation";
import type { DecisionCard } from "../shared/schema";

const card: DecisionCard = {
  id: "test-card",
  title: "Test Card",
  asset: "SPY",
  situation: "Testing the assistant presentation summary.",
  mainConclusion: "The move is mostly driven by rate expectations.",
  confidence: 77,
  suggestedAction: "Wait for confirmation before adding risk.",
  riskLevel: "medium",
  why: ["Macro data is the main driver.", "Liquidity is stable.", "The move is not fully confirmed."],
  whatCouldProveWrong: ["A fresh catalyst could invalidate the thesis."],
  learningNote: "Keep the first summary compact.",
  verificationStatus: "partially_verified",
  nextStep: "Check whether new evidence confirms the move.",
  details: {
    facts: ["Fact one"],
    interpretations: ["Interpretation one"],
    contradictoryEvidence: ["Contradiction one"],
    risks: ["Risk one"],
    verificationStatus: "partially_verified",
    advancedAnalytics: ["Analytics one"],
  },
};

const highlights = decisionCardHighlights(card);

assert.equal(highlights.length, 3);
assert.deepEqual(
  highlights.map((item) => item.label),
  ["Conclusion", "Suggested action", "Could be wrong if"],
);
assert.equal(highlights[2].value, "A fresh catalyst could invalidate the thesis.");

assert.equal(compactText("one two three four", 4), "one two three four");
assert.equal(compactText("one two three four five", 4), "one two three four…");

const memoryCue = buildMemoryInfluenceCue([
  {
    kind: "prediction_review",
    text: "This earlier thesis missed the catalyst.",
    source: "semantic",
    relevance: 91,
    metadata: { predictionId: "pred-123" },
    artifactLinks: [
      { label: "Open matching journal review", href: "/journal?predictionId=pred-123" },
      { label: "Open intelligence graph", href: "/intelligence?start=prediction-review-pred-123" },
    ],
  },
]);

assert.ok(memoryCue);
assert.equal(memoryCue?.label, "prediction review");
assert.equal(memoryCue?.sourceLabel, "semantic memory");
assert.equal(memoryCue?.link?.href, "/journal?predictionId=pred-123");
assert.equal(memoryCue?.links.length, 2);
assert.equal(memoryCue?.links[1].href, "/intelligence?start=prediction-review-pred-123");
assert.match(memoryCue?.reason ?? "", /confidence should stay lower/i);

const lessonCue = buildPredictionLessonCue(
  {
    theme: "Ignored confirmation",
    count: 4,
    latestUpdatedLesson: "Wait for confirmation before acting.",
    latestFutureRuleAdjustment: "Require a second confirming signal.",
  },
  {
    reviewedAt: "2026-06-20T00:00:00.000Z",
    whatWasMissed: "Confirmation",
    updatedLesson: "Wait for confirmation before acting.",
    futureRuleAdjustment: "Require a second confirming signal.",
  },
);

assert.ok(lessonCue);
assert.equal(lessonCue?.theme, "Ignored confirmation");
assert.match(lessonCue?.cue ?? "", /Reuse this lesson/i);
assert.match(lessonCue?.cue ?? "", /Require a second confirming signal/i);

const intelligenceHighlight = buildIntelligenceLessonHighlight([
  {
    id: "prediction-review-pred-123",
    type: "AgentDecision",
    label: "Prediction review: pred-123",
    metadata: { predictionId: "pred-123" },
  },
  {
    id: "prediction-lesson-pred-123",
    type: "LessonLearned",
    label: "Wait for confirmation before acting.",
    metadata: { predictionId: "pred-123" },
  },
]);

assert.ok(intelligenceHighlight);
assert.equal(intelligenceHighlight?.reviewLink, "/journal?predictionId=pred-123");
assert.equal(intelligenceHighlight?.graphLink, "intelligence?start=prediction-review-pred-123");

const checklist = buildMemoryActionChecklist({
  theme: "Ignored confirmation",
  cue: "Reuse this lesson: Wait for confirmation before acting. Require a second confirming signal.",
});

assert.ok(checklist.length >= 2);
assert.match(checklist.join(" "), /Write the maximum allowed risk|List the confirming evidence/i);

const riskChecklist = buildMemoryActionChecklist({
  theme: "Risk and sizing",
  cue: "Reuse this lesson: Write the maximum allowed risk before submitting the ticket.",
});

assert.ok(riskChecklist.length >= 2);
assert.match(riskChecklist.join(" "), /maximum allowed risk|position size/i);

console.log("assistantPresentation tests passed");
