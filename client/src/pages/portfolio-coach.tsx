import { DecisionCard } from "@/components/decision-card";
import Layout from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { useMarketPilotOverview, usePortfolioRiskAnalytics } from "@/lib/marketpilot";
import { ChevronDown } from "lucide-react";

export default function PortfolioCoach() {
  const { data } = useMarketPilotOverview();
  const { data: risk } = usePortfolioRiskAnalytics();

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

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <DecisionCard card={card} />
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
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              Show factor, correlation, and Monte Carlo details
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <Card className="border-border/60 bg-card/60">
              <CardContent className="grid gap-3 pt-6 md:grid-cols-3">
                {(card.details.advancedAnalytics).map((item) => (
                  <div key={item} className="rounded-lg border border-border/60 bg-background/35 p-3 text-sm text-slate-200">{item}</div>
                ))}
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Layout>
  );
}
