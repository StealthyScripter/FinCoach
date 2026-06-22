import { z } from "zod";
import { randomUUID } from "crypto";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";

export const AUTOMATION_LEVEL_ACKNOWLEDGEMENT = "I understand this increases MarketPilot automation within configured safety limits.";

export const automationLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export type AutomationLevel = z.infer<typeof automationLevelSchema>;
export type AutomationCapability =
  | "signals"
  | "paper_tracking"
  | "paper_auto_entry"
  | "paper_auto_exit"
  | "sandbox_execution"
  | "supervised_live_preview"
  | "bounded_semi_autonomous_candidate";

export type SemiAutonomousConstraints = {
  strategyIds: string[];
  allowedInstruments: string[];
  maxRiskPerTradePct: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
  maxNotional: number;
  referenceEquity: number;
  monitoringIntervalSeconds: number;
  sandboxOnly: true;
};

export const AUTOMATION_LEVELS: Record<AutomationLevel, {
  name: string;
  description: string;
  capabilities: AutomationCapability[];
  userConfirmationRequired: boolean;
  configuredConstraintsRequired: boolean;
  continuousMonitoringRequired: boolean;
}> = {
  0: { name: "disabled", description: "Automation is disabled", capabilities: [], userConfirmationRequired: false, configuredConstraintsRequired: false, continuousMonitoringRequired: false },
  1: { name: "signal_only", description: "Signals may be collected and scored", capabilities: ["signals"], userConfirmationRequired: false, configuredConstraintsRequired: false, continuousMonitoringRequired: false },
  2: { name: "paper_tracking", description: "Signals may be tracked without placing orders", capabilities: ["signals", "paper_tracking"], userConfirmationRequired: false, configuredConstraintsRequired: false, continuousMonitoringRequired: false },
  3: { name: "paper_execution", description: "Approved paper entries and exits may be automated", capabilities: ["signals", "paper_tracking", "paper_auto_entry", "paper_auto_exit"], userConfirmationRequired: false, configuredConstraintsRequired: true, continuousMonitoringRequired: true },
  4: { name: "sandbox_execution", description: "Practice/demo execution may be queued within configured constraints", capabilities: ["signals", "paper_tracking", "paper_auto_entry", "paper_auto_exit", "sandbox_execution"], userConfirmationRequired: true, configuredConstraintsRequired: true, continuousMonitoringRequired: true },
  5: { name: "supervised_live_candidate", description: "Live previews are allowed, but every order requires user confirmation", capabilities: ["signals", "paper_tracking", "paper_auto_entry", "paper_auto_exit", "sandbox_execution", "supervised_live_preview"], userConfirmationRequired: true, configuredConstraintsRequired: true, continuousMonitoringRequired: true },
  6: { name: "bounded_semi_autonomous_candidate", description: "Represents bounded semi-autonomous eligibility only; production execution remains disabled", capabilities: ["signals", "paper_tracking", "paper_auto_entry", "paper_auto_exit", "sandbox_execution", "supervised_live_preview", "bounded_semi_autonomous_candidate"], userConfirmationRequired: true, configuredConstraintsRequired: true, continuousMonitoringRequired: true },
};

export class AutomationLevelService {
  private level: AutomationLevel;
  private semiAutonomousConstraints: SemiAutonomousConstraints | null = null;

  constructor(
    initialLevel: AutomationLevel = 0,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
  ) {
    this.level = automationLevelSchema.parse(initialLevel);
  }

  setLevel(level: AutomationLevel) {
    this.level = automationLevelSchema.parse(level);
    if (this.level !== 6) this.semiAutonomousConstraints = null;
    return this.snapshot();
  }

  requestTransition(input: {
    targetLevel: AutomationLevel;
    actorId: string;
    acknowledgement: string;
    registeredStrategyCount: number;
    validatedStrategyCount: number;
    constraintsConfigured: boolean;
    monitoringEnabled: boolean;
    killSwitchAvailable: boolean;
    sandboxReady: boolean;
    supervisedPermissionActive: boolean;
    semiAutonomousApproved: boolean;
    auditExportReady: boolean;
    semiAutonomousScope: SemiAutonomousConstraints | null;
  }) {
    const target = automationLevelSchema.parse(input.targetLevel);
    const reasons: string[] = [];
    if (!input.actorId.trim()) reasons.push("A named actor is required");
    if (target > this.level) {
      if (target !== this.level + 1) reasons.push("Automation increases must advance one level at a time");
      if (input.acknowledgement !== AUTOMATION_LEVEL_ACKNOWLEDGEMENT) reasons.push("The exact automation acknowledgement is required");
      if (target >= 2 && input.registeredStrategyCount < 1) reasons.push("Register at least one strategy before paper tracking");
      if (target >= 3 && input.validatedStrategyCount < 1) reasons.push("Validate at least one strategy before paper execution");
      if (target >= 3 && !input.constraintsConfigured) reasons.push("Configure strategy and account risk constraints");
      if (target >= 3 && !input.monitoringEnabled) reasons.push("Continuous monitoring must be enabled");
      if (target >= 3 && !input.killSwitchAvailable) reasons.push("A tested kill switch must be available");
      if (target >= 4 && !input.sandboxReady) reasons.push("A practice/demo broker must be configured");
      if (target >= 5 && !input.supervisedPermissionActive) reasons.push("An unexpired supervised permission is required");
      if (target >= 6 && !input.semiAutonomousApproved) reasons.push("Independent semi-autonomous approval is required");
      if (target >= 6 && !input.auditExportReady) reasons.push("Signed durable audit export must be configured");
    }
    const correlationId = randomUUID();
    if (reasons.length) {
      this.audit.append({
        action: "automation.level.transition",
        outcome: "rejected",
        correlationId,
        detail: { actorId: input.actorId, currentLevel: this.level, targetLevel: target, reasons },
      });
      return { changed: false as const, current: this.snapshot(), reasons };
    }
    const previousLevel = this.level;
    this.level = target;
    this.semiAutonomousConstraints = target === 6 && input.semiAutonomousScope
      ? {
          ...input.semiAutonomousScope,
          strategyIds: [...input.semiAutonomousScope.strategyIds],
          allowedInstruments: [...input.semiAutonomousScope.allowedInstruments],
        }
      : null;
    this.audit.append({
      action: "automation.level.transition",
      outcome: "accepted",
      correlationId,
      detail: { actorId: input.actorId, previousLevel, targetLevel: target },
    });
    return { changed: true as const, previousLevel, current: this.snapshot(), reasons: [] };
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
      semiAutonomousConstraints: this.semiAutonomousConstraints
        ? {
            ...this.semiAutonomousConstraints,
            strategyIds: [...this.semiAutonomousConstraints.strategyIds],
            allowedInstruments: [...this.semiAutonomousConstraints.allowedInstruments],
          }
        : null,
    };
  }
}

export const automationLevelService = new AutomationLevelService();
