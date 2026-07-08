import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHistoricalBackfillStatus, useResearchCoverage, useResearchReplayReport, useResearchStability } from "@/lib/marketpilot";
import { AlertTriangle, Database, DownloadCloud, ShieldCheck } from "lucide-react";

const pipelineStages = ["Observations", "Patterns", "Hypotheses", "Rule Sets", "Experiments"];

export default function ResearchLab() {
  const coverage = useResearchCoverage();
  const report = useResearchReplayReport();
  const stability = useResearchStability();
  const backfill = useHistoricalBackfillStatus();
  const coverageItems = coverage.data?.items ?? [];
  const importedCells = coverageItems.filter((item) => item.candlesAvailable > 0).length;
  const missingCells = coverageItems.filter((item) => item.target === "missing" || item.target === "below_minimum").length;
  const missingWindows = backfill.data?.acquisitionPlan.items.reduce((sum, item) => sum + item.missingWindows.length, 0) ?? coverageItems.reduce((sum, item) => sum + item.missingWindows.length, 0);
  const stableCandidates = stability.data?.comparisons.filter((item) => item.stable).length ?? 0;
  const evidenceGaps = report.data?.evidenceGapsRemaining ?? coverageItems.flatMap((item) => item.qualityWarnings).slice(0, 3);
  const backfillStatus = backfill.data?.status;
  const cards = [
    {
      title: "Historical Coverage",
      value: coverage.isLoading ? "Loading" : `${importedCells}/${coverageItems.length} cells`,
      detail: `${missingCells} shallow cells · ${missingWindows} missing windows`,
      icon: Database,
    },
    {
      title: "Backfill",
      value: backfillStatus?.running ? "Running" : `${backfillStatus?.candlesImported ?? 0} imported`,
      detail: backfillStatus?.estimatedCompletion
        ? `ETA ${new Date(backfillStatus.estimatedCompletion).toLocaleTimeString()}`
        : `Fetched ${backfillStatus?.candlesFetched ?? 0} · latest ${backfillStatus?.latestImportedAt ? new Date(backfillStatus.latestImportedAt).toLocaleDateString() : "n/a"}`,
      icon: DownloadCloud,
    },
    {
      title: "Stability",
      value: `${stableCandidates} stable candidates`,
      detail: report.data?.forwardTestingJustified ? "Forward-test evidence gate passed" : "Forward-test evidence gate blocked",
      icon: ShieldCheck,
    },
    {
      title: "Evidence Gaps",
      value: `${evidenceGaps.length} active gaps`,
      detail: evidenceGaps[0] ?? "No gaps reported",
      icon: AlertTriangle,
    },
  ];
  void pipelineStages;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <Badge className="w-fit" variant="secondary">Demo-only research machine</Badge>
          <h1 className="text-3xl font-bold text-white">Research Lab</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Observe markets, detect repeatable behavior, generate hypotheses, define objective rules, and move experiments through evidence gates.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.title} className="border-border/60 bg-card/60">
                <CardHeader className="space-y-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base text-white">{card.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm font-medium">{card.value}</p>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{card.detail}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
