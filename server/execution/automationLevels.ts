import { z } from "zod";

export const automationLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export type AutomationLevel = z.infer<typeof automationLevelSchema>;
export type AutomationCapability =
  | "signals"
  | "paper_tracking"
  | "paper_auto_entry"
  | "paper_auto_exit"
  | "supervised_live_preview";

export const AUTOMATION_LEVELS: Record<AutomationLevel, {
  name: string;
  description: string;
  capabilities: AutomationCapability[];
  userConfirmationRequired: boolean;
}> = {
  0: { name: "disabled", description: "Automation is disabled", capabilities: [], userConfirmationRequired: false },
  1: { name: "signal_only", description: "Signals may be collected and scored", capabilities: ["signals"], userConfirmationRequired: false },
  2: { name: "paper_tracking", description: "Signals may be tracked without placing orders", capabilities: ["signals", "paper_tracking"], userConfirmationRequired: false },
  3: { name: "paper_auto_entry", description: "Approved paper entries may be created automatically", capabilities: ["signals", "paper_tracking", "paper_auto_entry"], userConfirmationRequired: false },
  4: { name: "paper_auto_entry_exit", description: "Approved paper entries and exits may be automated", capabilities: ["signals", "paper_tracking", "paper_auto_entry", "paper_auto_exit"], userConfirmationRequired: false },
  5: { name: "supervised_live_candidate", description: "Live previews are allowed, but every order requires user confirmation", capabilities: ["signals", "paper_tracking", "paper_auto_entry", "paper_auto_exit", "supervised_live_preview"], userConfirmationRequired: true },
};

export class AutomationLevelService {
  private level: AutomationLevel;

  constructor(initialLevel: AutomationLevel = 1) {
    this.level = automationLevelSchema.parse(initialLevel);
  }

  setLevel(level: AutomationLevel) {
    this.level = automationLevelSchema.parse(level);
    return this.snapshot();
  }

  allows(capability: AutomationCapability) {
    return AUTOMATION_LEVELS[this.level].capabilities.includes(capability);
  }

  assertAllowed(capability: AutomationCapability) {
    if (!this.allows(capability)) {
      throw new Error(`Automation level ${this.level} does not allow ${capability}`);
    }
  }

  snapshot() {
    return {
      level: this.level,
      ...AUTOMATION_LEVELS[this.level],
      liveOrderSubmissionAllowed: false as const,
    };
  }
}

export const automationLevelService = new AutomationLevelService();
