import assert from "node:assert/strict";
import { ResearchJournalV2EventTypes, ResearchJournalV2Service } from "./v2/journal";

const correlationId = "00000000-0000-4000-8000-000000000018";

const baseEntry = {
  journalEntryId: "journal-sig-1",
  subjectType: "external_evaluation" as const,
  subjectId: "eval-1",
  sourceModule: "external-evaluation" as const,
  summary: "Independent evaluation confirmed take-profit outcome.",
  evidence: {
    signalId: "sig-1",
    forwardTestId: "forward-1",
    evaluationId: "eval-1",
    outcome: "tp",
    r: 1.4,
  },
  conclusion: "Outcome accepted as permanent research evidence.",
  limitations: ["single demo sample"],
  supersedesEntryId: null,
  createdAt: "2026-01-01T02:00:00.000Z",
  lineageEventIds: ["ranking-event", "forward-event", "signal-event", "external-evaluation-event"],
  correlationId,
  causationId: null,
};

const service = new ResearchJournalV2Service();

const recorded = service.record(baseEntry);
assert.equal(recorded.entry?.schemaVersion, "fincoach.v2.research-journal.1");
assert.equal(recorded.entry?.immutable, true);
assert.equal(recorded.events[0].eventType, ResearchJournalV2EventTypes.ResearchJournalEntryRecorded);
assert.deepEqual(service.get("journal-sig-1"), recorded.entry);

const duplicate = service.record({ ...baseEntry, conclusion: "changed conclusion should not overwrite" });
assert.equal(duplicate.entry?.conclusion, baseEntry.conclusion);
assert.equal(duplicate.events[0].eventType, ResearchJournalV2EventTypes.ResearchJournalDuplicateSuppressed);

const rejected = service.record({ ...baseEntry, journalEntryId: "bad-journal", lineageEventIds: [] });
assert.equal(rejected.entry, null);
assert.equal(rejected.events[0].eventType, ResearchJournalV2EventTypes.ResearchJournalEntryRejected);
assert.equal(rejected.events[0].payload.reason, "missing_lineage");

const missingCorrectionTarget = service.recordCorrection({
  ...baseEntry,
  journalEntryId: "missing-correction-target",
  supersedesEntryId: "does-not-exist",
});
assert.equal(missingCorrectionTarget.entry, null);
assert.equal(missingCorrectionTarget.events[0].payload.reason, "unknown_superseded_entry");

const correction = service.recordCorrection({
  ...baseEntry,
  journalEntryId: "journal-sig-1-correction",
  summary: "Correction: independent evaluation was later reconciled as expired.",
  evidence: {
    signalId: "sig-1",
    forwardTestId: "forward-1",
    evaluationId: "eval-2",
    outcome: "expired",
    r: 0,
  },
  conclusion: "Superseding evidence changes the institutional conclusion.",
  supersedesEntryId: "journal-sig-1",
  createdAt: "2026-01-01T03:00:00.000Z",
  causationId: recorded.events[0].eventId,
});
assert.equal(correction.entry?.supersedesEntryId, "journal-sig-1");
assert.equal(correction.events[0].eventType, ResearchJournalV2EventTypes.ResearchJournalEntrySuperseded);
assert.equal(service.get("journal-sig-1")?.conclusion, baseEntry.conclusion);
assert.deepEqual(service.list().map(entry => entry.journalEntryId), ["journal-sig-1", "journal-sig-1-correction"]);

const restarted = new ResearchJournalV2Service(service.repositorySnapshot());
assert.equal(restarted.record(baseEntry).events[0].eventType, ResearchJournalV2EventTypes.ResearchJournalDuplicateSuppressed);
assert.deepEqual(restarted.list().map(entry => entry.journalEntryId), ["journal-sig-1", "journal-sig-1-correction"]);

const concurrent = await Promise.all(Array.from({ length: 8 }, () => restarted.record({
  ...baseEntry,
  journalEntryId: "journal-concurrent-1",
  subjectId: "eval-concurrent-1",
  createdAt: "2026-01-01T04:00:00.000Z",
})));
assert.equal(concurrent.filter(result => result.events[0].eventType === ResearchJournalV2EventTypes.ResearchJournalEntryRecorded).length, 1);
assert.equal(concurrent.filter(result => result.events[0].eventType === ResearchJournalV2EventTypes.ResearchJournalDuplicateSuppressed).length, 7);
assert.equal(restarted.list().filter(entry => entry.journalEntryId === "journal-concurrent-1").length, 1);

assert.equal("publishSignal" in service || "reconcile" in service || "createForwardTest" in service, false);
console.log("v2 phase 18 research journal tests passed");
