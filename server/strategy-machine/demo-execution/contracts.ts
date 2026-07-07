import type { EventReference } from "../core";

export type DemoExecutionRequest = {
  provider: string;
  accountMode: string;
  verificationSource: string;
  attemptedAction: string;
  confirmationReceived: boolean;
  killSwitchActive: boolean;
  sourceEventRefs: EventReference[];
};

export type DemoExecutionDecision = {
  allowed: boolean;
  blocked: boolean;
  reason: string;
  confirmationIgnored: boolean;
  killSwitchActive: boolean;
  demoOnly: true;
};
