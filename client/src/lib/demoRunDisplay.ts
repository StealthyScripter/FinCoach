import type { DemoRunFinalReport, DemoRunStatus, DemoRunTelemetry } from "@shared/demoRun";

export function selectDemoRunPrimaryItems(
  status: DemoRunStatus | undefined,
  telemetry: DemoRunTelemetry | undefined,
  report: DemoRunFinalReport | null | undefined,
) {
  const safetyScore = status?.telemetrySummary.safetyScore ?? report?.telemetrySummary.safetyScore ?? 0;
  const items = [
    `Run: ${status?.state ?? "idle"}${status?.dayCount ? ` · day ${status.dayCount}/7` : ""}`,
    `Uptime: ${formatDuration(status?.uptimeSeconds ?? 0)}`,
    `Safety: ${safetyScore}/100`,
  ];
  const pnl = status?.currentPnL ?? telemetry?.tradingPerformance.pl ?? 0;
  items.push(`Current P/L: ${formatPnl(pnl)}`);
  items.push(`Blocked: ${status?.blockedActions[0] ?? "none"}`);
  if (status?.topAdjustment) {
    items.push(`Top adjustment: ${status.topAdjustment.kind.replaceAll("_", " ")}${status.topAdjustment.strategyId ? ` · ${status.topAdjustment.strategyId}` : ""}`);
  } else if (report?.nextDeploymentRecommendation) {
    items.push(`Top adjustment: ${report.nextDeploymentRecommendation}`);
  } else {
    items.push("Top adjustment: none");
  }
  return items.slice(0, 5);
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatPnl(value: number) {
  const formatted = value.toFixed(2);
  return value >= 0 ? `+$${formatted}` : `-$${Math.abs(value).toFixed(2)}`;
}
