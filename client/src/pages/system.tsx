import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAgentOutputs, useAgentSupervisor, useConnectorRegistry, useDemoRunReport, useDemoRunStatus, useDemoRunTelemetry, useInstitutionalAnalytics, useProviderHealth, useTelegramStatus, useVerificationQuality } from "@/lib/marketpilot";
import { selectDemoRunPrimaryItems } from "@/lib/demoRunDisplay";
import { ChevronDown } from "lucide-react";

export default function System() {
  const { data: analytics } = useInstitutionalAnalytics();
  const { data: verification } = useVerificationQuality();
  const { data: providers } = useProviderHealth();
  const { data: telegram } = useTelegramStatus();
  const { data: connectors } = useConnectorRegistry();
  const { data: demoRunStatus } = useDemoRunStatus();
  const { data: demoRunTelemetry } = useDemoRunTelemetry();
  const { data: demoRunReport } = useDemoRunReport();
  const { data: supervisor } = useAgentSupervisor();
  const { data: agents } = useAgentOutputs();
  const dissentingAgents = (agents ?? []).filter((agent) => agent.status === "action_required" || agent.status === "blocked");
  const consensusCounts = (agents ?? []).reduce<Record<string, number>>((counts, agent) => {
    const key = agent.status === "clear" || agent.status === "watch" ? "aligned" : "dissent";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const recommendationCounts = (agents ?? []).flatMap((agent) => agent.recommendations).reduce<Record<string, number>>((counts, recommendation) => {
    counts[recommendation] = (counts[recommendation] ?? 0) + 1;
    return counts;
  }, {});
  const topSharedRecommendations = Object.entries(recommendationCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3);
  const supportedConnectorIds = new Set(["oanda_practice", "metatrader_demo", "tradingview_webhook", "telegram_notifications", "fred"]);
  const supportedConnectors = (connectors?.connectors ?? []).filter((connector) => supportedConnectorIds.has(connector.id));
  const primaryTelegramCommands = ["/status", "/market", "/portfolio", "/signals", "/debrief", "/lessons", "/demo_status", "/demo_report", "/disable_automation", "/kill"];

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-bold text-white">System</h1>
          <p className="mt-2 text-sm text-muted-foreground">Run health, demo monitoring, Telegram control, and supported integrations.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric title="Verification" value={verification ? `${verification.score}/100` : "..."} />
          <Metric title="Providers" value={providers ? `${providers.providers.length}` : "..."} />
          <Metric title="Supervisor" value={supervisor?.mode ?? "..."} />
          <Metric title="Regime" value={analytics?.regime.primaryRegime ?? "..."} />
        </div>
        <Card className="border-border/60 bg-card/60">
          <CardHeader>
            <CardTitle className="text-white">Demo Run</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-200">
            {selectDemoRunPrimaryItems(demoRunStatus, demoRunTelemetry, demoRunReport).map((item) => (
              <div key={item}>{item}</div>
            ))}
            <details className="rounded-lg border border-border/60 bg-background/35 p-3">
              <summary className="cursor-pointer list-none text-white">Telemetry details</summary>
              <div className="mt-3 grid gap-4 md:grid-cols-2 text-xs text-slate-300">
                <Section title="Reliability" items={demoRunTelemetry ? [
                  `Requests: ${demoRunTelemetry.reliability.requestCount}`,
                  `Errors: ${demoRunTelemetry.reliability.errorCount}`,
                  `Provider failures: ${demoRunTelemetry.reliability.failedProviderCalls}`,
                  `Telegram failures: ${demoRunTelemetry.reliability.telegramCommandFailures}`,
                ] : ["Loading..."]} />
                <Section title="Safety" items={demoRunTelemetry ? [
                  `Kill switch events: ${demoRunTelemetry.safety.killSwitchEvents}`,
                  `Blocked orders: ${demoRunTelemetry.safety.blockedOrders}`,
                  `Stale data blocks: ${demoRunTelemetry.safety.staleDataBlocks}`,
                  `Daily loss blocks: ${demoRunTelemetry.safety.dailyLossBlocks}`,
                ] : ["Loading..."]} />
                <Section title="Usability" items={demoRunTelemetry ? [
                  `Telegram commands: ${demoRunTelemetry.usability.telegramCommandsUsed}`,
                  `Ask prompts: ${demoRunTelemetry.usability.askMarketPilotPrompts}`,
                  `Repeated actions: ${demoRunTelemetry.usability.repeatedUserActions.length}`,
                  `Abandoned confirmations: ${demoRunTelemetry.usability.abandonedConfirmationFlows}`,
                ] : ["Loading..."]} />
                <Section title="Performance" items={demoRunTelemetry ? [
                  `Trades opened: ${demoRunTelemetry.tradingPerformance.tradesOpened}`,
                  `Trades closed: ${demoRunTelemetry.tradingPerformance.tradesClosed}`,
                  `Win rate: ${demoRunTelemetry.tradingPerformance.winRate}%`,
                  `Expectancy: ${demoRunTelemetry.tradingPerformance.expectancy}`,
                ] : ["Loading..."]} />
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Latest report</div>
                  <div className="mt-2 space-y-1">
                    <div>Reliability: {demoRunStatus?.telemetrySummary.reliabilityScore ?? "..."}</div>
                    <div>Safety: {demoRunStatus?.telemetrySummary.safetyScore ?? "..."}</div>
                    <div>Usability: {demoRunStatus?.telemetrySummary.usabilityScore ?? "..."}</div>
                    <div>Calibration: {demoRunStatus?.telemetrySummary.calibrationScore ?? "..."}</div>
                    <div>Strategy: {demoRunStatus?.telemetrySummary.strategyPerformanceScore ?? "..."}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Adjustment history</div>
                  <div className="mt-2 space-y-1">
                    {(demoRunStatus?.topAdjustment ? [demoRunStatus.topAdjustment] : []).map((adjustment) => (
                      <div key={adjustment.id}>
                        {adjustment.kind.replaceAll("_", " ")}{adjustment.strategyId ? ` · ${adjustment.strategyId}` : ""}
                      </div>
                    ))}
                    {!demoRunStatus?.topAdjustment && <div>No adjustments yet.</div>}
                  </div>
                </div>
              </div>
            </details>
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/60 bg-card/60">
            <CardHeader>
              <CardTitle className="text-white">Telegram Control</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-200">
              <div>Bot: {telegram?.configured ? "configured" : "disabled"}</div>
              <div>Allowed user: {telegram?.allowedUserId ?? "missing"}</div>
              <div>Webhook: {telegram?.webhookConfigured ? "configured" : "missing"}</div>
              <div>Last command: {telegram?.lastCommand ?? "none"}</div>
              <div>Pending confirmations: {telegram?.pendingConfirmations ?? 0}</div>
              <div>Mode: demo-only learning and sandbox control</div>
              <div className="pt-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Primary commands</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {primaryTelegramCommands.map((command) => (
                    <span key={command} className="rounded-md border border-border/60 bg-background/35 px-2 py-1 text-xs text-slate-200">{command}</span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/60">
            <CardHeader>
              <CardTitle className="text-white">Supported Integrations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-200">
              {supportedConnectors.map((connector) => (
                <details key={connector.id} className="rounded-lg border border-border/60 bg-background/35 p-3">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-white">{connector.name}</span>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">{connector.costLevel}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">{connector.providerName} · {connector.connectorType} · {connector.health} · {connector.enabled ? "enabled" : "disabled"}</div>
                  </summary>
                  <div className="mt-3 space-y-1 text-xs text-slate-300">
                    <div>Environment: {connector.environmentLabel}</div>
                    <div>Account mode: {connector.accountMode}</div>
                    <div>Demo verification: {connector.demoVerificationStatus} via {connector.demoVerificationSource}</div>
                    <div>Execution allowed: {connector.executionAllowed ? "yes" : "no"}</div>
                    {!connector.executionAllowed && <div>Reason: {connector.executionBlockedReason ?? connector.liveCapabilityDisabledReason}</div>}
                    <div>Assets: {connector.supportedAssetClasses.join(", ") || "none"}</div>
                    <div>Actions: {connector.supportedActions.join(", ") || "none"}</div>
                    <div>Disabled: {connector.disabledActions.join(", ") || "none"}</div>
                    <div>Safety: {connector.safetyConstraints.join("; ") || "none"}</div>
                    <div>Last sync: {connector.lastSyncAt ?? "n/a"}</div>
                    <div>Required env: {connector.requiredEnvVars.join(", ") || "none"}</div>
                    <div>Missing env: {connector.missingEnvVars.join(", ") || "none"}</div>
                  </div>
                </details>
              ))}
              {supportedConnectors.length === 0 && (
                <div className="rounded-lg border border-border/60 bg-background/35 p-3 text-muted-foreground">
                  Loading supported integrations...
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between border-border/60">
              Show admin and developer diagnostics
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="border-border/60 bg-card/60">
            <CardHeader>
              <CardTitle className="text-white">Agent Council</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-200">
              <div>Aligned agents: {consensusCounts.aligned ?? 0} / {(agents ?? []).length || "..."}</div>
              <div>Dissenting agents: {consensusCounts.dissent ?? 0}</div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Shared recommendations</div>
                {topSharedRecommendations.length > 0 ? (
                  topSharedRecommendations.map(([recommendation, count]) => (
                    <div key={recommendation} className="rounded-lg border border-border/60 bg-background/35 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <span>{recommendation}</span>
                        <span className="text-xs text-muted-foreground">{count} agents</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-border/60 bg-background/35 p-3 text-muted-foreground">
                    Loading agent outputs...
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Dissent</div>
                {dissentingAgents.length > 0 ? (
                  dissentingAgents.slice(0, 3).map((agent) => (
                    <div key={agent.id} className="rounded-lg border border-border/60 bg-background/35 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-white">{agent.title}</span>
                        <span className="text-xs uppercase tracking-wide text-amber-300">{agent.status}</span>
                      </div>
                      <p className="mt-2 text-slate-200">{agent.summary}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-border/60 bg-background/35 p-3 text-muted-foreground">
                    No dissenting agents right now.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {analytics && (
            <>
              <Card className="border-border/60 bg-card/60">
                <CardHeader><CardTitle className="text-white">Factor Exposure</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-200">
                  {analytics.factors.riskContributions.map((item) => (
                    <div key={item.factor}>{item.factor}: {item.contributionPct}%</div>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-border/60 bg-card/60">
                <CardHeader><CardTitle className="text-white">Stress Tests</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-200">
                  <div>Worst scenario: {analytics.stress.worstScenario}</div>
                  {analytics.stress.requiredActions.map((item) => <div key={item}>{item}</div>)}
                </CardContent>
              </Card>
            </>
          )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Layout>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent className="text-2xl font-bold text-white">{value}</CardContent>
    </Card>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-1">
        {items.map((item) => <div key={item}>{item}</div>)}
      </div>
    </div>
  );
}
