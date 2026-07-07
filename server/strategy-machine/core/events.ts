import {
  eventEnvelopeSchema,
  eventReferenceSchema,
  STRATEGY_MACHINE_SCHEMA_VERSION,
  type CreateEventInput,
  type EventEnvelope,
  type EventReference,
  type StrategyMachineErrorPayload,
} from "./contracts";
import { randomUUID } from "crypto";

export const CoreEventTypes = {
  ModuleRegistered: "strategy-machine.core.ModuleRegistered",
  ContractViolationDetected: "strategy-machine.core.ContractViolationDetected",
  ModuleErrorRaised: "strategy-machine.core.ModuleErrorRaised",
} as const;

export function createEvent<TPayload extends Record<string, unknown>>(input: CreateEventInput<TPayload>): EventEnvelope<TPayload> {
  const envelope = {
    id: randomUUID(),
    type: input.type,
    module: input.module,
    schemaVersion: input.schemaVersion ?? STRATEGY_MACHINE_SCHEMA_VERSION,
    contractVersion: input.contractVersion ?? 1,
    correlationId: input.correlationId ?? randomUUID(),
    causationId: input.causationId ?? null,
    sourceEventRefs: input.sourceEventRefs ?? [],
    payload: deepFreeze({ ...input.payload }),
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
  };
  eventEnvelopeSchema.parse(envelope);
  return deepFreeze(envelope) as EventEnvelope<TPayload>;
}

export function toEventReference(event: EventEnvelope): EventReference {
  return deepFreeze(eventReferenceSchema.parse({
    eventId: event.id,
    eventType: event.type,
    module: event.module,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
  }));
}

export function validateEventReferences(references: EventReference[]) {
  references.forEach((reference) => eventReferenceSchema.parse(reference));
  const duplicate = references.find((reference, index) => references.findIndex((item) => item.eventId === reference.eventId) !== index);
  if (duplicate) throw new Error(`Duplicate source event reference: ${duplicate.eventId}`);
  return true;
}

export function createModuleErrorEvent(payload: StrategyMachineErrorPayload, options: Omit<CreateEventInput<StrategyMachineErrorPayload>, "type" | "module" | "payload"> = {}) {
  return createEvent({
    ...options,
    type: CoreEventTypes.ModuleErrorRaised,
    module: "core",
    payload,
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      if (item && typeof item === "object" && !Object.isFrozen(item)) deepFreeze(item);
    }
  }
  return value;
}
