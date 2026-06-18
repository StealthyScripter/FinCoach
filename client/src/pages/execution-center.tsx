import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleDollarSign, Radio, ShieldCheck } from "lucide-react";

type ExecutionStatus = {
  primary: {
    automationLevel: { level: number; name: string; description: string };
    killSwitchStatus: "armed" | "triggered";
    latestSignals: Array<{ id?: string; strategyId?: string; createdAt?: string; reviewStatus?: string }>;
    openPaperPositions: Array<{
      id: string;
      instrument: string;
      side: string;
      units: number;
      unrealizedPnL: number;
      stopLossStatus: string;
    }>;
    strategyValidationVerdicts: Array<{
      strategyId: string;
      instrument: string;
      score: number;
      verdict: string;
    }>;
    riskPrecheckStatus: { action: string; reasons: string[]; checkedAt: string };
    liveReadiness: {
      readinessVerdict: "blocked" | "sandbox_only" | "supervised_live_ready";
      missingRequirements: string[];
      activeRiskLimits: { maxDailyLoss: number; maxRiskPerTradePct: number };
      killSwitchState: "armed" | "triggered";
      nextRequiredAction: string;
    } | null;
  };
  advanced: {
    strategyValidation: unknown[];
    brokerReadiness: { readyForPaper?: boolean; blockingReasons?: string[] };
    auditLog: unknown[];
    circuitBreakers: { killSwitchActive: boolean };
    liveReadinessDetails: Record<string, {
      ready: boolean;
      checks: Array<{ id: string; passed: boolean; requiredAction: string }>;
      missingRequirements: string[];
    }> | null;
  };
};

export default function ExecutionCenter() {
  const queryClient = useQueryClient();
  const { data } = useQuery<ExecutionStatus>({ queryKey: ["/api/marketpilot/execution/status"] });
  const killSwitch = useMutation({
    mutationFn: () => apiRequest("POST", "/api/marketpilot/execution/kill-switch"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/status"] }),
  });
  const emergency = useMutation({
    mutationFn: () => apiRequest("POST", "/api/marketpilot/execution/emergency", {
      actorId: "execution-center-user",
      reason: "User activated emergency controls from Execution Center",
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/status"] }),
  });
  const primary = data?.primary;

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-white">Execution Center</h1>
            <Badge variant="outline">Forex + commodities</Badge>
            <Badge variant="secondary">Live submission blocked</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Paper automation is level-gated, kill-switch protected, and auditable. Level 5 permits supervised-live candidacy only; every live order still requires explicit confirmation.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatusCard icon={Radio} title="Automation level" value={primary ? `Level ${primary.automationLevel.level} · ${primary.automationLevel.name}` : "..."} />
          <StatusCard icon={Ban} title="Kill switch" value={primary?.killSwitchStatus ?? "..."} danger={primary?.killSwitchStatus === "triggered"} />
          <StatusCard icon={CircleDollarSign} title="Open paper positions" value={String(primary?.openPaperPositions.length ?? 0)} />
          <StatusCard icon={ShieldCheck} title="Risk precheck" value={primary?.riskPrecheckStatus.action ?? "..."} danger={primary?.riskPrecheckStatus.action === "reject"} />
        </div>

        <Card className={primary?.liveReadiness?.readinessVerdict === "blocked" ? "border-amber-500/40" : ""}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Live Readiness</CardTitle>
              <Badge variant={primary?.liveReadiness?.readinessVerdict === "blocked" ? "destructive" : "outline"}>
                {primary?.liveReadiness?.readinessVerdict ?? "blocked"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-3">
              <Summary label="Active risk limits" value={primary?.liveReadiness ? `$${primary.liveReadiness.activeRiskLimits.maxDailyLoss} daily · ${primary.liveReadiness.activeRiskLimits.maxRiskPerTradePct}% per trade` : "Unavailable"} />
              <Summary label="Kill switch" value={primary?.liveReadiness?.killSwitchState ?? "unknown"} />
              <Summary label="Next required action" value={primary?.liveReadiness?.nextRequiredAction ?? "Complete readiness assessment"} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Missing requirements</p>
              {primary?.liveReadiness?.missingRequirements.length
                ? <ul className="space-y-1 text-muted-foreground">{primary.liveReadiness.missingRequirements.map((item) => <li key={item}>• {item}</li>)}</ul>
                : <p className="text-muted-foreground">No missing sandbox-readiness requirements.</p>}
            </div>
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer font-medium text-white">Advanced readiness details</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {Object.entries(data?.advanced.liveReadinessDetails ?? {}).map(([name, section]) => (
                  <div key={name} className="rounded-md bg-muted/30 p-3">
                    <p className="font-medium text-white">{humanize(name)} · {section.ready ? "ready" : "blocked"}</p>
                    {section.missingRequirements.map((item) => <p key={item} className="mt-1 text-xs text-muted-foreground">{item}</p>)}
                  </div>
                ))}
              </div>
            </details>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Latest signals</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!primary?.latestSignals.length && <Empty>No recent paper signals.</Empty>}
              {primary?.latestSignals.map((signal, index) => (
                <div key={signal.id ?? index} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium text-white">{signal.strategyId ?? "Strategy signal"}</p>
                  <p className="text-muted-foreground">{signal.reviewStatus ?? "Recorded"}{signal.createdAt ? ` · ${new Date(signal.createdAt).toLocaleString()}` : ""}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Strategy validation verdicts</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!primary?.strategyValidationVerdicts.length && <Empty>No registered strategies.</Empty>}
              {primary?.strategyValidationVerdicts.map((validation) => (
                <div key={`${validation.strategyId}-${validation.instrument}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span><span className="font-medium text-white">{validation.strategyId}</span> · {validation.instrument}</span>
                  <Badge variant={validation.verdict === "reject" ? "destructive" : "outline"}>{validation.verdict} · {validation.score}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Open paper positions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!primary?.openPaperPositions.length && <Empty>No open paper positions.</Empty>}
            {primary?.openPaperPositions.map((position) => (
              <div key={position.id} className="flex flex-wrap justify-between gap-3 rounded-lg border p-3 text-sm">
                <span className="font-medium text-white">{position.instrument} · {position.side} · {position.units} units</span>
                <span>Unrealized P/L ${position.unrealizedPnL.toFixed(2)} · stop {position.stopLossStatus}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Tabs defaultValue="backtests" className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start">
            {["Backtests", "Strategy validation", "Broker readiness", "Audit log", "Circuit breakers"].map((label) => (
              <TabsTrigger key={label} value={slug(label)}>{label}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="backtests"><Info title="Backtests" detail="Spread, slippage, leverage, walk-forward splits, and Monte Carlo robustness feed the validation scorecard." /></TabsContent>
          <TabsContent value="strategy-validation"><Info title="Strategy validation" detail={`${data?.advanced.strategyValidation.length ?? 0} strategy scorecards. A verdict never authorizes live execution by itself.`} /></TabsContent>
          <TabsContent value="broker-readiness"><Info title="Broker readiness" detail={data?.advanced.brokerReadiness.readyForPaper ? "The offline paper provider is ready." : (data?.advanced.brokerReadiness.blockingReasons?.join("; ") ?? "Readiness unavailable.")} /></TabsContent>
          <TabsContent value="audit-log"><Info title="Audit log" detail={`${data?.advanced.auditLog.length ?? 0} execution events recorded with correlation IDs.`} /></TabsContent>
          <TabsContent value="circuit-breakers">
            <Card>
              <CardHeader><CardTitle>Circuit breakers</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">The global kill switch blocks every provider order path. Administrative recovery is intentionally separate.</p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="destructive" disabled={Boolean(data?.advanced.circuitBreakers.killSwitchActive) || killSwitch.isPending} onClick={() => killSwitch.mutate()}>
                    Trigger global kill switch
                  </Button>
                  <Button variant="destructive" disabled={emergency.isPending} onClick={() => emergency.mutate()}>
                    Activate all emergency controls
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function StatusCard({ icon: Icon, title, value, danger = false }: { icon: typeof Radio; title: string; value: string; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <Icon className={danger ? "text-red-400" : "text-primary"} />
        <div><p className="text-xs text-muted-foreground">{title}</p><p className="font-semibold text-white">{value}</p></div>
      </CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium text-white">{value}</p></div>;
}

function Info({ title, detail }: { title: string; detail: string }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{detail}</CardContent></Card>;
}

function slug(value: string) {
  return value.toLowerCase().replaceAll(" ", "-");
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}
