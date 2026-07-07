import type { EventReference } from "../core";

export type ScreenshotReference = {
  type: "uploaded" | "generated_chart" | "placeholder";
  uri: string;
  capturedAt: string;
  redacted: boolean;
};

export type TradeJournal = {
  journalId: string;
  experimentId: string;
  tradeId: string;
  instrument: string;
  ruleVersion: number;
  entryReason: string;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  outcome: "win" | "loss" | "flat" | "open";
  beforeEntrySnapshotRefs: EventReference[];
  afterExitSnapshotRefs: EventReference[];
  multiTimeframeSnapshotRefs: EventReference[];
  screenshotRefs: ScreenshotReference[];
  lessonLearned: string | null;
  mistakeClassification: string | null;
  improvementSuggestion: string | null;
  sourceEventRefs: EventReference[];
};
