import assert from "node:assert/strict";
import { LearningV2EventTypes, LearningV2Service } from "./v2/learning";

const correlationId = "00000000-0000-4000-8000-000000000019";

const journalA = {
  journalEntryId: "journal-a",
  subjectId: "eval-a",
  outcome: "tp" as const,
  r: 1.3,
  tags: ["london", "breakout"],
  limitations: ["demo sample"],
  createdAt: "2026-01-01T00:00:00.000Z",
  lineageEventIds: ["journal-event-a"],
};
const journalB = {
  journalEntryId: "journal-b",
  subjectId: "eval-b",
  outcome: "tp" as const,
  r: 1.1,
  tags: ["london", "breakout"],
  limitations: [],
  createdAt: "2026-01-02T00:00:00.000Z",
  lineageEventIds: ["journal-event-b"],
};

const service = new LearningV2Service();
assert.equal(service.generateLesson({
  topic: "london breakout continuation",
  journalEntries: [journalA],
  minimumSamples: 2,
  correlationId,
  causationId: null,
}).lesson, null);

const created = service.generateLesson({
  topic: "london breakout continuation",
  journalEntries: [journalB, journalA],
  minimumSamples: 2,
  correlationId,
  causationId: null,
});
assert.equal(created.lesson?.schemaVersion, "fincoach.v2.learning-lesson.1");
assert.equal(created.lesson?.attribution.primaryCause, "london");
assert.equal(created.lesson?.confidence, 0.8);
assert.deepEqual(created.lesson?.evidenceJournalEntryIds, ["journal-a", "journal-b"]);
assert.equal(created.events[0].eventType, LearningV2EventTypes.LessonCreated);

const duplicate = service.generateLesson({
  topic: "london breakout continuation",
  journalEntries: [journalA, journalB],
  minimumSamples: 2,
  correlationId,
  causationId: null,
});
assert.equal(duplicate.events[0].eventType, LearningV2EventTypes.LessonDuplicateSuppressed);
assert.equal(service.list().length, 1);

const contradictory = service.generateLesson({
  topic: "mixed breakout",
  journalEntries: [
    journalA,
    { ...journalB, journalEntryId: "journal-c", outcome: "sl" as const, r: -1.2, lineageEventIds: ["journal-event-c"] },
  ],
  minimumSamples: 2,
  correlationId,
  causationId: null,
});
assert.equal(contradictory.lesson, null);
assert.equal(contradictory.events[0].eventType, LearningV2EventTypes.LessonRejected);
assert.equal(contradictory.events[0].payload.reason, "contradictory_evidence");

const revision = service.proposeRevision(created.lesson!, {
  proposalId: "revision-proposal-1",
  strategyId: "strategy-1",
  boundedChange: { parameter: "sessionFilter", from: "all", to: "london" },
  rationale: "Evidence attributes positive outcomes to London breakout conditions.",
});
assert.equal(revision.proposal?.schemaVersion, "fincoach.v2.revision-proposal.1");
assert.equal(revision.events[0].eventType, LearningV2EventTypes.RevisionProposed);
assert.equal("mutateStrategy" in service || "promoteStrategy" in service || "publishSignal" in service, false);

const restarted = new LearningV2Service(service.repositorySnapshot());
assert.equal(restarted.generateLesson({
  topic: "london breakout continuation",
  journalEntries: [journalA, journalB],
  minimumSamples: 2,
  correlationId,
  causationId: null,
}).events[0].eventType, LearningV2EventTypes.LessonDuplicateSuppressed);

const concurrent = await Promise.all(Array.from({ length: 6 }, () => restarted.generateLesson({
  topic: "ny reversal",
  journalEntries: [
    { ...journalA, journalEntryId: "journal-d", tags: ["ny", "reversal"], lineageEventIds: ["journal-event-d"] },
    { ...journalB, journalEntryId: "journal-e", tags: ["ny", "reversal"], lineageEventIds: ["journal-event-e"] },
  ],
  minimumSamples: 2,
  correlationId,
  causationId: null,
})));
assert.equal(concurrent.filter(result => result.events[0].eventType === LearningV2EventTypes.LessonCreated).length, 1);
assert.equal(concurrent.filter(result => result.events[0].eventType === LearningV2EventTypes.LessonDuplicateSuppressed).length, 5);

console.log("v2 phase 19 learning tests passed");
