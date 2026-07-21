import { randomUUID } from "crypto";
import { z, ZodError } from "zod";

export const FINCOACH_V2_SCHEMA_VERSION = "fincoach.v2.event.1" as const;

export const v2Modules = [
  "contracts",
  "event-bus",
  "lineage",
  "market-data",
  "market-context",
  "chart-analysis",
  "fundamentals",
  "observations",
  "replay",
  "trader-emulators",
  "hypothesis",
  "rules",
  "experiments",
  "backtesting",
  "validation",
  "courtroom",
  "market-memory",
  "ranking",
  "portfolio",
  "forward-testing",
  "signals",
  "external-evaluation",
  "journal",
  "learning",
  "ml-support",
  "strategy-evolution",
  "strategy-lifecycle",
  "orchestration",
  "telemetry",
  "governance",
] as const;

export type V2ModuleName = typeof v2Modules[number];

export type DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  readonly eventId: string;
  readonly eventType: string;
  readonly schemaVersion: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly sourceModule: V2ModuleName;
  readonly payload: Readonly<TPayload>;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export const domainEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  schemaVersion: z.literal(FINCOACH_V2_SCHEMA_VERSION),
  occurredAt: z.string().datetime(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().nullable(),
  sourceModule: z.enum(v2Modules),
  payload: z.record(z.unknown()),
  metadata: z.record(z.unknown()),
}).superRefine((event, ctx) => {
  if (event.causationId === event.eventId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["causationId"],
      message: "causationId cannot reference the event being created",
    });
  }
});

export type CreateDomainEventInput<TPayload extends Record<string, unknown>> = {
  eventType: string;
  sourceModule: V2ModuleName;
  payload: TPayload;
  correlationId?: string;
  causationId?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
};

export function createDomainEvent<TPayload extends Record<string, unknown>>(
  input: CreateDomainEventInput<TPayload>,
): DomainEvent<TPayload> {
  const event = {
    eventId: randomUUID(),
    eventType: input.eventType,
    schemaVersion: FINCOACH_V2_SCHEMA_VERSION,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    correlationId: input.correlationId ?? randomUUID(),
    causationId: input.causationId ?? null,
    sourceModule: input.sourceModule,
    payload: deepFreeze({ ...input.payload }),
    metadata: deepFreeze({ ...(input.metadata ?? {}) }),
  };
  try {
    return deepFreeze(domainEventSchema.parse(event)) as DomainEvent<TPayload>;
  } catch (error) {
    if (error instanceof ZodError) {
      (error as ZodError & { validationContext?: Record<string, unknown> }).validationContext = {
        objectType: "DomainEvent",
        eventType: input.eventType,
        sourceModule: input.sourceModule,
        eventId: event.eventId,
        correlationId: event.correlationId,
        causationId: event.causationId,
        parentEntityIds: input.payload,
      };
    }
    throw error;
  }
}

export function validateDomainEvent(event: unknown): DomainEvent {
  return domainEventSchema.parse(event) as DomainEvent;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child);
    }
  }
  return value;
}
