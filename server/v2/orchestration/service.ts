import { randomUUID } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { OrchestrationConfig, OrchestrationConsumer, OrchestrationErrorCode, OrchestrationRouteResult } from "./contracts";
import { createCheckpoint } from "./checkpoint";
import { createDeadLetter } from "./deadLetter";
import { OrchestrationV2EventTypes } from "./events";
import { classifyOrchestrationError } from "./errors";
import { orchestrationHealth } from "./health";
import { InMemoryOrchestrationRepository } from "./repository";
import { findConsumer, validateRoutableEvent } from "./router";

export class OrchestrationV2Service {
  private readonly repository = new InMemoryOrchestrationRepository();
  private readonly consumers: OrchestrationConsumer[] = [];

  constructor(private readonly config: OrchestrationConfig) {}

  registerConsumer(consumer: OrchestrationConsumer) {
    this.consumers.push(consumer);
  }

  requestCycle(input: { cycleId: string; requestedBy: string; correlationId: string; idempotencyKey: string }) {
    const now = new Date().toISOString();
    const saved = this.repository.saveCycle({ ...input, status: "requested", createdAt: now, updatedAt: now });
    return { cycle: saved.cycle, events: [this.event(OrchestrationV2EventTypes.ResearchCycleRequested, input.correlationId, null, { cycleId: saved.cycle.cycleId, inserted: saved.inserted })] };
  }

  async route(event: DomainEvent): Promise<OrchestrationRouteResult> {
    if (this.config.killSwitchActive) return this.rejected(event, "kill_switch_block");
    const idempotencyKey = String(event.metadata.idempotencyKey ?? event.eventId);
    if (!this.repository.markProcessed(idempotencyKey)) return this.rejected(event, "duplicate_event");
    const invalid = validateRoutableEvent(event);
    if (invalid === "poison_event") return this.quarantine(event, invalid);
    if (invalid) return this.rejected(event, invalid);
    const consumer = findConsumer(event, this.consumers);
    if (!consumer) return this.rejected(event, "unsupported_schema");
    const attempt = Number(event.metadata.attempt ?? 1);
    const events: DomainEvent[] = [
      this.event(OrchestrationV2EventTypes.OrchestrationEventRouted, event.correlationId, event.eventId, { sourceEventId: event.eventId, consumerId: consumer.consumerId }),
      this.event(OrchestrationV2EventTypes.ConsumerExecutionStarted, event.correlationId, event.eventId, { consumerId: consumer.consumerId, attempt }),
    ];
    try {
      const result = await consumer.handler({ event, attempt, idempotencyKey });
      this.repository.checkpoint(createCheckpoint({ consumerId: consumer.consumerId, sourceEventId: event.eventId, idempotencyKey, checkpointedAt: new Date().toISOString(), attempt }));
      events.push(this.event(OrchestrationV2EventTypes.ConsumerExecutionCompleted, event.correlationId, event.eventId, { consumerId: consumer.consumerId }));
      events.push(this.event(OrchestrationV2EventTypes.ResearchCycleCheckpointed, event.correlationId, event.eventId, { consumerId: consumer.consumerId, sourceEventId: event.eventId }));
      return { result, events };
    } catch (error) {
      const classified = classifyOrchestrationError(error);
      events.push(this.event(OrchestrationV2EventTypes.ConsumerExecutionFailed, event.correlationId, event.eventId, { consumerId: consumer.consumerId, reason: classified.code }));
      if (classified.retryable && attempt <= this.config.retryBudget) {
        events.push(this.event(OrchestrationV2EventTypes.ConsumerRetryScheduled, event.correlationId, event.eventId, { consumerId: consumer.consumerId, nextAttempt: attempt + 1 }));
        return { result: null, events };
      }
      const deadLetter = this.repository.addDeadLetter(createDeadLetter(event, classified.code, classified.retryable));
      events.push(this.event(OrchestrationV2EventTypes.DeadLetterEventCreated, event.correlationId, event.eventId, { deadLetterId: deadLetter.deadLetterId, reason: deadLetter.reason }));
      return { result: null, events };
    }
  }

  acquireLease(workerId: string) {
    const lease = this.repository.acquireLease(workerId, Date.now(), this.config.leaseTtlMs, this.config.workerQuota);
    if (!lease) return { events: [this.event(OrchestrationV2EventTypes.OrchestrationEventRejected, randomUUID(), null, { reason: "resource_exhaustion" })] };
    return { lease, events: [this.event(OrchestrationV2EventTypes.WorkerLeaseAcquired, randomUUID(), null, { workerId })] };
  }

  recoverStaleLeases(workerId: string) {
    const recovered = this.repository.recoverStaleLeases(workerId, Date.now(), this.config.leaseTtlMs);
    return { lease: recovered.lease, events: [this.event(recovered.expired.length ? OrchestrationV2EventTypes.WorkerLeaseRecovered : OrchestrationV2EventTypes.WorkerLeaseAcquired, randomUUID(), null, { workerId, recovered: recovered.expired.length })] };
  }

  cancelCycle(cycleId: string, reason: string, correlationId: string) {
    return { events: [this.event(OrchestrationV2EventTypes.ResearchCycleCancelled, correlationId, null, { cycleId, reason })] };
  }

  checkpoint(consumerId: string) {
    return this.repository.checkpointFor(consumerId);
  }

  deadLetters() {
    return this.repository.deadLetters();
  }

  health() {
    return orchestrationHealth(this.repository, this.config);
  }

  private rejected(source: DomainEvent, reason: OrchestrationErrorCode): OrchestrationRouteResult {
    return { result: null, events: [this.event(OrchestrationV2EventTypes.OrchestrationEventRejected, source.correlationId, source.eventId, { reason, sourceEventId: source.eventId })] };
  }

  private quarantine(source: DomainEvent, reason: OrchestrationErrorCode): OrchestrationRouteResult {
    const deadLetter = this.repository.addDeadLetter(createDeadLetter(source, reason, false));
    return { result: null, events: [this.event(OrchestrationV2EventTypes.PoisonEventQuarantined, source.correlationId, source.eventId, { reason, deadLetterId: deadLetter.deadLetterId })] };
  }

  private event(eventType: string, correlationId: string, causationId: string | null, payload: Record<string, unknown>) {
    return createDomainEvent({ eventType, sourceModule: "orchestration", correlationId, causationId, payload });
  }
}

export const orchestrationV2Service = new OrchestrationV2Service({ killSwitchActive: false, maxQueueDepth: 100, workerQuota: 1, leaseTtlMs: 30_000, retryBudget: 3 });
