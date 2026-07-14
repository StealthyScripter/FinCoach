import { z } from "zod";

export const replayManifestSchema = z.object({
  manifestVersion: z.literal("fincoach.v2.replay-manifest.1"),
  runId: z.string().min(1),
  repositoryCommit: z.string().min(7),
  startedAt: z.string().datetime(),
  datasetId: z.string().min(1),
  datasetVersion: z.string().min(1),
  datasetHashes: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
  symbols: z.array(z.string().min(1)).min(1),
  timeframes: z.array(z.string().min(1)).min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  replayMode: z.enum(["verify", "five_year", "ten_year", "custom", "resume", "compare"]),
  seed: z.number().int().nonnegative(),
  checkpointInterval: z.number().int().positive(),
  restartSchedule: z.array(z.number().int().nonnegative()),
  workerCount: z.number().int().positive(),
  resourceLimits: z.object({ maxEvents: z.number().int().positive(), maxHeapMb: z.number().positive() }),
  featureSchemaVersions: z.record(z.string()),
  eventSchemaVersions: z.record(z.string()),
  expectedSafetyState: z.object({ liveExecutionBlocked: z.literal(true), brokerCallsAllowed: z.literal(false), telegramAllowed: z.literal(false) }),
  outputDirectory: z.string().min(1),
}).superRefine((manifest, ctx) => {
  if (Date.parse(manifest.startTime) >= Date.parse(manifest.endTime)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "endTime must be after startTime" });
});

export type ReplayVerificationManifest = z.infer<typeof replayManifestSchema>;

export type ReplayVerificationFailure = { code: string; severity: "critical" | "warning"; message: string };

export type ReplayVerificationResult = {
  runId: string;
  manifestHash: string;
  status: "passed" | "warning" | "failed";
  inputEventCount: number;
  outputEventCount: number;
  domainEventHash: string;
  checkpointCount: number;
  restartCount: number;
  durationMs: number;
  peakHeapMb: number;
  failures: ReplayVerificationFailure[];
  safety: { liveExecutionBlocked: true; brokerCalls: 0; telegramMessages: 0 };
};
