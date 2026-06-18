import { AssistantSignalCard } from "@/components/assistant-signal-card";
import { DecisionCard } from "@/components/decision-card";
import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAssistantOpportunities, useMarketMoveInvestigation, useMarketPilotOverview } from "@/lib/marketpilot";
import { BookOpen, BrainCircuit, NotebookText, PieChart, Search, Settings } from "lucide-react";
import { Link } from "wouter";

const modes = [
  { href: "/learn", icon: BookOpen, title: "Learn", text: "Clear lessons, examples, quizzes, and market applications." },
  { href: "/ask", icon: Search, title: "Ask MarketPilot", text: "Understand moves, research assets, and evaluate strategy ideas." },
  { href: "/opportunities", icon: BrainCircuit, title: "Opportunities", text: "Ranked cards for high conviction, watchlist, risk warning, learning, and avoid-trade signals." },
  { href: "/portfolio", icon: PieChart, title: "Portfolio", text: "Allocation, diversification, cash, and biggest risk first." },
  { href: "/journal", icon: NotebookText, title: "Journal", text: "Track predictions, misses, and lessons that improve future confidence." },
  { href: "/system", icon: Settings, title: "System", text: "Advanced analytics, diagnostics, and institutional details." },
];

export default function Dashboard() {
  const { data: overview } = useMarketPilotOverview();
  const { data: investigation } = useMarketMoveInvestigation("SPY");
  const { data: opportunities } = useAssistantOpportunities();

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="rounded-xl border border-border/60 bg-card/70 p-5">
          <div className="text-xs uppercase tracking-widest text-primary">MarketPilot focus</div>
          <h1 className="mt-2 text-3xl font-bold text-white">Understand, decide, and act safely.</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            MarketPilot now shows the few signals that matter first: what happened, why, confidence, risk, next step, and what to learn.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/ask"><Button>Ask MarketPilot</Button></Link>
            <Link href="/learn"><Button variant="outline">Start learning</Button></Link>
          </div>
        </div>

        {investigation && <DecisionCard card={investigation.decisionCard} />}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <Link key={mode.href} href={mode.href}>
                <Card className="h-full cursor-pointer border-border/60 bg-card/55 transition-colors hover:border-primary/40">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Icon className="h-5 w-5 text-primary" />
                      {mode.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">{mode.text}</CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card className="border-border/60 bg-card/60">
            <CardHeader>
              <CardTitle className="text-white">Primary Signals</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {(opportunities?.primary ?? []).slice(0, 3).map((signal) => (
                <AssistantSignalCard key={signal.id} signal={signal} />
              ))}
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/60">
            <CardHeader>
              <CardTitle className="text-white">Portfolio Coach</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-200">
              <div>Risk score: {overview?.portfolio.riskScore ?? "..."} / 100</div>
              <div>Cash: ${overview?.portfolio.cash.toLocaleString() ?? "..."}</div>
              <div>Action priority: review largest risk before adding new exposure.</div>
              <Link href="/portfolio">
                <Button variant="outline" className="mt-2">Open Portfolio Coach</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
