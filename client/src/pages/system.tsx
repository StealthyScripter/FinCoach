import Layout from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgentSupervisor, useInstitutionalAnalytics, useProviderHealth, useVerificationQuality } from "@/lib/marketpilot";

export default function System() {
  const { data: analytics } = useInstitutionalAnalytics();
  const { data: verification } = useVerificationQuality();
  const { data: providers } = useProviderHealth();
  const { data: supervisor } = useAgentSupervisor();

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-bold text-white">System</h1>
          <p className="mt-2 text-sm text-muted-foreground">Advanced diagnostics and institutional analytics live here, away from default decision screens.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric title="Verification" value={verification ? `${verification.score}/100` : "..."} />
          <Metric title="Providers" value={providers ? `${providers.providers.length}` : "..."} />
          <Metric title="Supervisor" value={supervisor?.mode ?? "..."} />
          <Metric title="Regime" value={analytics?.regime.primaryRegime ?? "..."} />
        </div>
        {analytics && (
          <div className="grid gap-4 lg:grid-cols-2">
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
          </div>
        )}
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
