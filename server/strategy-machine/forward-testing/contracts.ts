import type { EventReference } from "../core";

export type ForwardTestMode = "paper" | "sandbox" | "practice" | "simulated";
export type ForwardTestState = "draft" | "running" | "paused" | "completed";

export type ForwardTest = {
  forwardTestId: string;
  experimentId: string;
  mode: ForwardTestMode;
  provider: string;
  accountMode: string;
  state: ForwardTestState;
  allowedInstruments: string[];
  riskLimitPct: number;
  openedTradeRefs: EventReference[];
  closedTradeRefs: EventReference[];
};

export type DemoTrade = {
  tradeId: string;
  forwardTestId: string;
  instrument: string;
  side: "buy" | "sell";
  quantity: number;
  openedAt: string;
  closedAt: string | null;
  demoOnly: true;
};
