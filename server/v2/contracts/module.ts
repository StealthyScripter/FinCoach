import { z } from "zod";
import { v2Modules, type V2ModuleName } from "./events";

export const moduleHealthSchema = z.object({
  module: z.enum(v2Modules),
  status: z.enum(["healthy", "degraded", "unavailable"]),
  schemaVersion: z.string().min(1),
  checkedAt: z.string().datetime(),
  dependencies: z.array(z.object({
    name: z.string().min(1),
    status: z.enum(["healthy", "degraded", "unavailable"]),
  })),
  metadata: z.record(z.unknown()),
});

export type ModuleHealth = z.infer<typeof moduleHealthSchema>;

export const moduleErrorSchema = z.object({
  module: z.enum(v2Modules),
  code: z.string().min(1),
  category: z.enum(["validation", "dependency", "persistence", "provider", "safety", "unknown"]),
  retryable: z.boolean(),
  terminal: z.boolean(),
  message: z.string().min(1),
  correlationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  metadata: z.record(z.unknown()),
}).superRefine((error, ctx) => {
  if (error.category === "unknown" && !error.terminal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["terminal"],
      message: "unknown errors must fail closed as terminal",
    });
  }
});

export type ModuleError = z.infer<typeof moduleErrorSchema>;

export type ModuleContract = {
  module: V2ModuleName;
  accepts: readonly string[];
  emits: readonly string[];
  ownsTables: readonly string[];
  publicContracts: readonly string[];
  schemaVersion: string;
};

export const v2FeatureFlagDefaults = {
  FINCOACH_V2_ENABLED: false,
  FINCOACH_V2_RESEARCH_ENABLED: false,
  FINCOACH_V2_FORWARD_TESTING_ENABLED: false,
  FINCOACH_V2_SIGNAL_PUBLISHING_ENABLED: false,
} as const;

export type V2FeatureFlagName = keyof typeof v2FeatureFlagDefaults;
export type V2FeatureFlags = Record<V2FeatureFlagName, boolean>;

export function readV2FeatureFlags(env: NodeJS.ProcessEnv = process.env): V2FeatureFlags {
  return {
    FINCOACH_V2_ENABLED: parseBoolean(env.FINCOACH_V2_ENABLED),
    FINCOACH_V2_RESEARCH_ENABLED: parseBoolean(env.FINCOACH_V2_RESEARCH_ENABLED),
    FINCOACH_V2_FORWARD_TESTING_ENABLED: parseBoolean(env.FINCOACH_V2_FORWARD_TESTING_ENABLED),
    FINCOACH_V2_SIGNAL_PUBLISHING_ENABLED: parseBoolean(env.FINCOACH_V2_SIGNAL_PUBLISHING_ENABLED),
  };
}

function parseBoolean(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}
