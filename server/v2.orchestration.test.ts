import assert from "node:assert/strict";
import { createDomainEvent } from "./v2/contracts";
import { OrchestrationV2EventTypes, OrchestrationV2Service } from "./v2/orchestration";

const correlationId = "00000000-0000-4000-8000-000000000023";

const event = createDomainEvent({
  eventType: "ResearchJournalEntryRecorded",
  sourceModule: "journal",
  correlationId,
  payload: { journalEntryId: "journal-1", lineageEventIds: ["signal-event"] },
  metadata: { idempotencyKey: "journal-1", attempt: 1, consumer: "learning" },
});

const service = new OrchestrationV2Service({
  killSwitchActive: false,
  maxQueueDepth: 10,
  workerQuota: 2,
  leaseTtlMs: 100,
  retryBudget: 2,
});

service.registerConsumer({
  consumerId: "learning",
  supportedEvents: ["ResearchJournalEntryRecorded"],
  handler: async input => ({
    status: "completed",
    outputEvents: [createDomainEvent({
      eventType: "LessonCreated",
      sourceModule: "learning",
      correlationId: input.event.correlationId,
      causationId: input.event.eventId,
      payload: { lessonId: "lesson-1" },
    })],
  }),
});

const requested = service.requestCycle({ cycleId: "cycle-1", requestedBy: "test", correlationId, idempotencyKey: "cycle-1" });
assert.equal(requested.events[0].eventType, OrchestrationV2EventTypes.ResearchCycleRequested);
const routed = await service.route(event);
assert.equal(routed.result?.status, "completed");
assert.ok(routed.events.some(item => item.eventType === OrchestrationV2EventTypes.ConsumerExecutionCompleted));
assert.equal(service.checkpoint("learning")?.sourceEventId, event.eventId);

const duplicate = await service.route(event);
assert.equal(duplicate.events[0].eventType, OrchestrationV2EventTypes.OrchestrationEventRejected);
assert.equal(duplicate.events[0].payload.reason, "duplicate_event");

const missingLineage = await service.route(createDomainEvent({
  eventType: "ResearchJournalEntryRecorded",
  sourceModule: "journal",
  correlationId,
  payload: { journalEntryId: "journal-no-lineage" },
}));
assert.equal(missingLineage.events[0].payload.reason, "missing_lineage");

const unsupported = await service.route(createDomainEvent({
  eventType: "UnknownFutureEvent",
  sourceModule: "journal",
  correlationId,
  payload: { lineageEventIds: ["x"] },
}));
assert.equal(unsupported.events[0].payload.reason, "unsupported_schema");

const retryable = new OrchestrationV2Service({ killSwitchActive: false, maxQueueDepth: 10, workerQuota: 1, leaseTtlMs: 10, retryBudget: 1 });
retryable.registerConsumer({
  consumerId: "retry-consumer",
  supportedEvents: ["SignalPublished"],
  handler: async () => {
    throw Object.assign(new Error("temporary database outage"), { retryable: true });
  },
});
const retryResult = await retryable.route(createDomainEvent({
  eventType: "SignalPublished",
  sourceModule: "signals",
  correlationId,
  payload: { signalId: "sig-1", lineageEventIds: ["forward-event"] },
}));
assert.equal(retryResult.events.at(-1)?.eventType, OrchestrationV2EventTypes.ConsumerRetryScheduled);
const exhausted = await retryable.route(createDomainEvent({
  eventType: "SignalPublished",
  sourceModule: "signals",
  correlationId,
  payload: { signalId: "sig-2", lineageEventIds: ["forward-event"] },
  metadata: { attempt: 2 },
}));
assert.equal(exhausted.events.at(-1)?.eventType, OrchestrationV2EventTypes.DeadLetterEventCreated);

const poison = await service.route(createDomainEvent({
  eventType: "ResearchJournalEntryRecorded",
  sourceModule: "journal",
  correlationId,
  payload: { journalEntryId: "poison", lineageEventIds: ["x"], poison: true },
}));
assert.equal(poison.events[0].eventType, OrchestrationV2EventTypes.PoisonEventQuarantined);
assert.equal(service.deadLetters().length, 1);

const blocked = new OrchestrationV2Service({ killSwitchActive: true, maxQueueDepth: 10, workerQuota: 1, leaseTtlMs: 10, retryBudget: 1 });
assert.equal((await blocked.route(event)).events[0].payload.reason, "kill_switch_block");

const leases = new OrchestrationV2Service({ killSwitchActive: false, maxQueueDepth: 10, workerQuota: 1, leaseTtlMs: 50, retryBudget: 1 });
assert.equal(leases.acquireLease("worker-a").events[0].eventType, OrchestrationV2EventTypes.WorkerLeaseAcquired);
assert.equal(leases.acquireLease("worker-b").events[0].eventType, OrchestrationV2EventTypes.OrchestrationEventRejected);
await new Promise(resolve => setTimeout(resolve, 55));
assert.equal(leases.recoverStaleLeases("worker-b").events[0].eventType, OrchestrationV2EventTypes.WorkerLeaseRecovered);

const cancelled = service.cancelCycle("cycle-1", "operator stop", correlationId);
assert.equal(cancelled.events[0].eventType, OrchestrationV2EventTypes.ResearchCycleCancelled);
assert.equal("placeOrder" in service || "submitOrder" in service || "sendTelegram" in service, false);

console.log("v2 phase 23 orchestration tests passed");
