import { randomUUID } from "crypto";
import { z } from "zod";

export const STRATEGY_MACHINE_SCHEMA_VERSION = "strategy-machine.v1" as const;

export const strategyMachineModules = [
  "core",
  "market-data",
  "pattern-discovery",
  "hypothesis",
  "rule-builder",
  "experiment-manager",
  "backtesting",
  "validation",
  "forward-testing",
  "journal",
  "strategy-ranking",
  "ml-support",
  "telemetry",
  "demo-execution",
] as const;

export type StrategyMachineModule = typeof strategyMachineModules[number];

export const eventReferenceSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  module: z.enum(strategyMachineModules),
  schemaVersion: z.string().min(1),
  occurredAt: z.string().datetime(),
});

export type EventReference = z.infer<typeof eventReferenceSchema>;

export const eventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  module: z.enum(strategyMachineModules),
  schemaVersion: z.string().min(1),
  contractVersion: z.number().int().positive(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().nullable(),
  sourceEventRefs: z.array(eventReferenceSchema),
  payload: z.record(z.unknown()),
  occurredAt: z.string().datetime(),
});

export type EventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> =
  Omit<z.infer<typeof eventEnvelopeSchema>, "payload"> & { readonly payload: Readonly<TPayload> };

export type CreateEventInput<TPayload extends Record<string, unknown>> = {
  type: string;
  module: StrategyMachineModule;
  payload: TPayload;
  schemaVersion?: string;
  contractVersion?: number;
  correlationId?: string;
  causationId?: string | null;
  sourceEventRefs?: EventReference[];
  occurredAt?: Date;
};

export type ModuleRegistration = {
  name: StrategyMachineModule;
  ownsTables: string[];
  consumesEvents: string[];
  emitsEvents: string[];
  publicContracts: string[];
};

export type StrategyMachineErrorPayload = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error" | "critical";
  module: StrategyMachineModule;
  retryable: boolean;
  metadata?: Record<string, unknown>;
};

export function createCorrelationId() {
  return randomUUID();
}
