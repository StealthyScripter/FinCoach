import type { BrokerHealth, SandboxAccountSummary, SandboxOrderResult, SandboxPosition } from "./brokerSandbox";
import type { BrokerReconciliationReport } from "./brokerReconciliationService";

export type SandboxExecutionCenterInput = {
  health: BrokerHealth | null;
  account: SandboxAccountSummary | null;
  positions: SandboxPosition[];
  latestOrder: SandboxOrderResult | null;
  killSwitchActive: boolean;
  latestReconciliation?: BrokerReconciliationReport | null;
};

export function selectSandboxExecutionCenterData(input: SandboxExecutionCenterInput) {
  return {
    primary: {
      connectionStatus: input.health?.status ?? "disconnected",
      accountMode: input.account?.mode ?? "demo",
      equity: input.account?.equity ?? 0,
      marginAvailable: input.account?.marginAvailable ?? 0,
      openSandboxPositions: input.positions.map((position) => ({
        id: position.id,
        instrument: position.instrument,
        side: position.side,
        units: position.units,
        unrealizedPnL: position.unrealizedPnL,
      })),
      latestSandboxOrderStatus: input.latestOrder
        ? {
            orderId: input.latestOrder.orderId,
            status: input.latestOrder.status,
            reason: input.latestOrder.reason,
            requestedUnits: input.latestOrder.requestedUnits ?? null,
            filledUnits: input.latestOrder.filledUnits ?? null,
            remainingUnits: input.latestOrder.remainingUnits ?? null,
          }
        : null,
      emergencyControls: {
        killSwitchActive: input.killSwitchActive,
        disconnectAvailable: Boolean(input.health?.connected),
      },
    },
    advanced: {
      provider: input.health?.provider ?? null,
      accountId: input.account?.accountId ?? null,
      providerHealthReason: input.health?.reason ?? null,
      latestReconciliation: input.latestReconciliation
        ? {
            id: input.latestReconciliation.id,
            status: input.latestReconciliation.status,
            discrepancyCount: input.latestReconciliation.discrepancies.length,
            reconciledAt: input.latestReconciliation.reconciledAt,
          }
        : null,
    },
    safety: {
      productionOrderSubmissionEnabled: false as const,
      sandboxOnly: true as const,
    },
  };
}
