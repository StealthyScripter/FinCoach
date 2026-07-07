import type { EventReference } from "../core";

export type TelemetrySnapshot = {
  generatedAt: string;
  dataFreshnessSeconds: number;
  patternDetectorThroughput: number;
  hypothesisCreationCount: number;
  experimentThroughput: number;
  backtestQueueHealth: "healthy" | "degraded" | "blocked";
  validationPassCount: number;
  validationFailCount: number;
  forwardTestHealth: "healthy" | "paused" | "blocked";
  journalCompletionRate: number;
  demoExecutionSafetyBlocks: number;
  providerReliability: Record<string, number>;
  oandaPracticeApiReliability: number | null;
  telegramControlReliability: number | null;
  sourceEventRefs: EventReference[];
};
