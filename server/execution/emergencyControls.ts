import { randomUUID } from "crypto";
import type { AutomationLevelService } from "./automationLevels";
import type { ExecutionRiskService } from "./riskControls";
import { executionAuditLog } from "./riskControls";

export type EmergencyProvider = {
  id: string;
  closeAllPositions?: () => Promise<{ closed: number }>;
  closeAllSandboxPositions?: () => Promise<{ closed: number }>;
  disconnect?: () => Promise<unknown>;
};

export class ExecutionEmergencyState {
  livePermissionRevoked = false;
  signalsFrozen = false;

  resetForTest() {
    this.livePermissionRevoked = false;
    this.signalsFrozen = false;
  }
}

export const executionEmergencyState = new ExecutionEmergencyState();

export class EmergencyControlService {
  constructor(
    private readonly risk: ExecutionRiskService,
    private readonly automation: AutomationLevelService,
    private readonly providers: EmergencyProvider[],
    private readonly state = executionEmergencyState,
  ) {}

  async activate(actorId: string, reason: string, now = new Date()) {
    const correlationId = randomUUID();
    const killSwitch = this.risk.triggerGlobalKillSwitch();
    const automation = this.automation.setLevel(0);
    this.state.livePermissionRevoked = true;
    this.state.signalsFrozen = true;
    const providerResults = [];
    for (const provider of this.providers) {
      const closeResult = provider.closeAllPositions
        ? await provider.closeAllPositions()
        : provider.closeAllSandboxPositions
          ? await provider.closeAllSandboxPositions()
          : { closed: 0 };
      const disconnectResult = provider.disconnect ? await provider.disconnect() : null;
      providerResults.push({ provider: provider.id, closeResult, disconnectResult });
    }
    const report = {
      id: randomUUID(),
      correlationId,
      actorId,
      reason,
      activatedAt: now.toISOString(),
      globalKillSwitchTriggered: killSwitch.globalKillSwitch,
      paperPositionsClosed: providerResults.reduce((sum, item) => sum + item.closeResult.closed, 0),
      automationLevel: automation.level,
      livePermissionRevoked: this.state.livePermissionRevoked,
      signalsFrozen: this.state.signalsFrozen,
      brokerDisconnectRequested: this.providers.length > 0,
      providerResults,
      productionLiveSubmissionAllowed: false as const,
    };
    executionAuditLog.append({
      action: "emergency.activate",
      outcome: "blocked",
      correlationId,
      detail: report,
    });
    return report;
  }

  snapshot() {
    return {
      livePermissionRevoked: this.state.livePermissionRevoked,
      signalsFrozen: this.state.signalsFrozen,
      killSwitchTriggered: this.risk.snapshot().globalKillSwitch,
      automationLevel: this.automation.snapshot().level,
    };
  }
}
