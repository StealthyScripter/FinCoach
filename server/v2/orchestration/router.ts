import type { DomainEvent } from "../contracts";
import type { OrchestrationConsumer, OrchestrationErrorCode } from "./contracts";

export function findConsumer(event: DomainEvent, consumers: readonly OrchestrationConsumer[]) {
  return consumers.find(consumer => consumer.supportedEvents.includes(event.eventType)) ?? null;
}

export function validateRoutableEvent(event: DomainEvent): OrchestrationErrorCode | null {
  if (!event.eventId || !event.eventType || !event.correlationId) return "invalid_event";
  if ((event.payload as { poison?: unknown }).poison === true) return "poison_event";
  const lineage = (event.payload as { lineageEventIds?: unknown }).lineageEventIds;
  if (lineage !== undefined && (!Array.isArray(lineage) || lineage.length === 0)) return "missing_lineage";
  if (lineage === undefined && event.sourceModule !== "market-data") return "missing_lineage";
  return null;
}
