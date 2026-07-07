import { DecisionCard } from "@/components/decision-card";
import Layout from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { useMarketPilotOverview, usePortfolioModels, usePortfolioRiskAnalytics } from "@/lib/marketpilot";
import { ChevronDown } from "lucide-react";

export default function PortfolioCoach() {
  const { data } = useMarketPilotOverview();
  const { data: risk } = usePortfolioRiskAnalytics();
  const { data: models } = usePortfolioModels();

  if (!data) {
    return <Layout><div className="text-muted-foreground">Loading portfolio coach...</div></Layout>;
  }

  const largest = data.portfolio.holdings.reduce((max, holding) =>
    holding.riskContribution > max.riskContribution ? holding : max,
  data.portfolio.holdings[0]);
  const card = {
    id: "portfolio-coach",
    title: "Portfolio Coach",
    asset: data.portfolio.name,
    situation: "Allocation, diversification, risk exposure, cash, and rebalancing priority reviewed.",
    mainConclusion: `${largest.symbol} is the biggest risk at ${largest.riskContribution.toFixed(1)}% risk contribution.`,
    confidence: 82,
    suggestedAction: "Review concentration before adding new exposure.",
    riskLevel: data.portfolio.riskScore > 65 ? "high" as const : "medium" as const,
    why: [
      `Current allocation has ${largest.symbol} at ${largest.allocation.toFixed(1)}%.`,
      `Portfolio risk score is ${data.portfolio.riskScore}/100.`,
      `Cash available is $${data.portfolio.cash.toLocaleString()}.`,
    ],
    whatCouldProveWrong: ["Fresh holdings or account balances could change the largest risk contributor."],
    learningNote: "Portfolio coaching starts with the biggest risk and one improvement before advanced analytics.",
    verificationStatus: "partially_verified" as const,
    nextStep: "Make one improvement: reduce drift, add cash, or avoid new correlated risk.",
    details: {
      facts: data.portfolio.holdings.map((holding) => `${holding.symbol}: ${holding.allocation.toFixed(1)}% allocation, ${holding.riskContribution.toFixed(1)}% risk.`),
      interpretations: ["Simpler allocation decisions should come before factor or Monte Carlo drill-downs."],
      contradictoryEvidence: ["External holdings are not reflected in the paper portfolio."],
      risks: data.riskRules.map((rule) => rule.description),
      verificationStatus: "partially_verified" as const,
      advancedAnalytics: risk
        ? [
            `VaR 95: $${risk.valueAtRisk95.toLocaleString()}`,
            `Volatility: ${risk.estimatedAnnualVolatilityPct}%`,
            `Beta: ${risk.beta}`,
            ...risk.riskBreaches,
          ]
        : ["Risk analytics loading."],
    },
  };
  const rankedModels = [...(models ?? [])].sort((left, right) =>
    left.maxDriftPct - right.maxDriftPct || left.turnoverEstimate - right.turnoverEstimate || left.name.localeCompare(right.name),
  );
  const bestModel = rankedModels[0];
  const topModels = rankedModels.slice(0, 3);
  const diversification = data.portfolio.holdings.length >= 3 && largest.allocation < 35
    ? "Reasonably diversified"
    : `Concentrated in ${largest.symbol}`;
  const riskAnswer = data.portfolio.riskScore > 70
    ? "Risk is high"
    : data.portfolio.riskScore > 45 ? "Risk is moderate" : "Risk is controlled";
  const rebalanceAnswer = bestModel
    ? `${bestModel.name}: drift ${bestModel.maxDriftPct.toFixed(1)}%`
    : "Model comparison loading";
  const performanceAnswer = risk
    ? `Sharpe ${risk.sharpeRatio} · drawdown ${risk.maxDrawdownPct}%`
    : "Performance analytics loading";

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <DecisionCard card={card} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStat label="Am I diversified?" value={diversification} />
          <SummaryStat label="Too much risk?" value={`${riskAnswer} · ${data.portfolio.riskScore}/100`} />
          <SummaryStat label="Should I rebalance?" value={rebalanceAnswer} />
          <SummaryStat label="How am I performing?" value={performanceAnswer} />
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between border-border/60">
              Show portfolio model, holdings, and factor details
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-4">
            <Card className="border-border/60 bg-card/60">
              <CardHeader>
                <CardTitle className="text-white">Portfolio Model Recommendation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-border/60 bg-background/35 p-4 text-sm text-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-white">{bestModel?.name ?? "Loading model comparisons..."}</span>
                    {bestModel && (
                      <span className="text-xs uppercase tracking-wide text-primary">
                        Drift {bestModel.maxDriftPct.toFixed(1)}% / Turnover ${bestModel.turnoverEstimate.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="mt-2">{bestModel?.objective ?? "Compare the current portfolio against model portfolios to determine the least disruptive improvement path."}</p>
                  {bestModel && (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <MiniList title="Gates" items={bestModel.suitabilityGates} />
                      <MiniList title="Risk notes" items={bestModel.riskNotes} />
                    </div>
                  )}
                </div>
                <div className="grid gap-4 lg:grid-cols-3">
                  {topModels.length > 0 ? topModels.map((model) => (
                    <div key={model.id} className="rounded-lg border border-border/60 bg-background/35 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-white">{model.name}</div>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">{model.level}</div>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <div>Drift {model.maxDriftPct.toFixed(1)}%</div>
                          <div>Turnover ${model.turnoverEstimate.toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2">
                        {model.targetAllocation.slice(0, 3).map((target) => (
                          <div key={`${model.id}-${target.symbol}`} className="rounded-md bg-card/60 p-2 text-xs text-slate-200">
                            <div className="flex items-center justify-between gap-2">
                              <span>{target.symbol}</span>
                              <span>{target.currentPct.toFixed(1)}% → {target.targetPct.toFixed(1)}%</span>
                            </div>
                            <div className="mt-1 text-muted-foreground">{target.sleeve}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-lg border border-border/60 bg-background/35 p-4 text-sm text-muted-foreground">
                      Loading portfolio model comparisons...
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-card/60">
              <CardContent className="grid gap-3 pt-6 md:grid-cols-3">
                {(card.details.advancedAnalytics).map((item) => (
                  <div key={item} className="rounded-lg border border-border/60 bg-background/35 p-3 text-sm text-slate-200">{item}</div>
                ))}
              </CardContent>
            </Card>
            <div className="grid gap-4 md:grid-cols-3">
              {data.portfolio.holdings.slice(0, 3).map((holding) => (
                <Card key={holding.symbol} className="border-border/60 bg-card/60">
                  <CardHeader>
                    <CardTitle className="text-white">{holding.symbol}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="text-slate-200">{holding.name}</div>
                    <div className="text-muted-foreground">Allocation {holding.allocation.toFixed(1)}%</div>
                    <div className="text-muted-foreground">Risk contribution {holding.riskContribution.toFixed(1)}%</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Layout>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="mt-1 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/50 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-2">
        {items.slice(0, 3).map((item) => (
          <div key={item} className="text-xs text-slate-200">{item}</div>
        ))}
      </div>
    </div>
  );
}
