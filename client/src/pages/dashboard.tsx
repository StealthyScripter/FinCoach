import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAssistantOpportunities, useDemoRunStatus, useMarketMoveInvestigation, useMarketPilotOverview, usePredictionInsights, useProviderHealth } from "@/lib/marketpilot";
import { compactText } from "@shared/assistantPresentation";
import { BookOpen, ChevronDown, FlaskConical, HeartPulse, NotebookText, PieChart, Search, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: overview } = useMarketPilotOverview();
  const { data: investigation } = useMarketMoveInvestigation("SPY");
  const { data: opportunities } = useAssistantOpportunities();
  const { data: insights } = usePredictionInsights();
  const { data: demoRun } = useDemoRunStatus();
  const { data: providers } = useProviderHealth();
  const topSignal = opportunities?.primary[0] ?? opportunities?.secondary[0] ?? opportunities?.all[0];
  const todayLesson = insights?.topThemes[0]?.latestUpdatedLesson
    ?? overview?.modules[0]?.title
    ?? "Start with risk, invalidation, and one market example.";
  const recentMistake = insights?.recentRules[0]?.whatWasMissed
    ?? "No repeated mistake has been recorded yet.";
  const systemHealth = providers
    ? `${providers.providers.filter((provider) => provider.status === "healthy").length}/${providers.providers.length} providers healthy`
    : "Checking provider health...";
  const portfolioHealth = overview
    ? `Risk ${overview.portfolio.riskScore}/100 · cash $${overview.portfolio.cash.toLocaleString()}`
    : "Loading portfolio health...";

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="rounded-lg border border-border/60 bg-card/70 p-5">
          <div className="text-xs uppercase tracking-widest text-primary">Today with MarketPilot</div>
          <h1 className="mt-2 text-3xl font-bold text-white">Learn, ask, test, and review.</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Your home screen shows only the few items that help you become a better trader today. Everything else is a drill-down.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/learn"><Button>Start today's lesson</Button></Link>
            <Link href="/ask"><Button variant="outline">Ask MarketPilot</Button></Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            {
              icon: BookOpen,
              title: "Today's Learning",
              body: compactText(todayLesson, 16),
              action: "Open Learn",
              href: "/learn",
            },
            {
              icon: Search,
              title: "Top Market Story",
              body: compactText(investigation?.decisionCard.mainConclusion ?? "Loading market story...", 16),
              action: "Ask why",
              href: "/ask",
            },
            {
              icon: FlaskConical,
              title: "Top Opportunity",
              body: topSignal ? compactText(`${topSignal.title}: ${topSignal.summary}`, 16) : "No paper opportunity is ready yet.",
              action: "Open Strategy Lab",
              href: "/strategy-lab",
            },
            {
              icon: PieChart,
              title: "Portfolio Health",
              body: portfolioHealth,
              action: "Open Portfolio",
              href: "/portfolio",
            },
            {
              icon: HeartPulse,
              title: "System Health",
              body: `${demoRun?.state ?? "demo"} · ${demoRun?.productionLiveExecutionBlocked ? "live blocked" : "check live block"} · ${systemHealth}`,
              action: "Open System",
              href: "/system",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
            <Link key={item.title} href={item.href}>
              <Card className="h-full cursor-pointer border-border/60 bg-card/60 transition-colors hover:border-primary/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base text-white">
                    <Icon className="h-4 w-4 text-primary" />
                    {item.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-200">
                  <p>{item.body}</p>
                  <Button variant="outline" className="w-fit">{item.action}</Button>
                </CardContent>
              </Card>
            </Link>
          );
          })}
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between border-border/60">
              Show today's lesson, mistake, and recommendation
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 grid gap-4 lg:grid-cols-3">
            <FocusCard icon={BookOpen} title="Today's Lesson" body={todayLesson} href="/learn" action="Practice the lesson" />
            <FocusCard icon={NotebookText} title="Recent Mistake" body={recentMistake} href="/journal" action="Review the loop" />
            <FocusCard
              icon={ShieldCheck}
              title="Top Recommendation"
              body={insights?.recentRules[0]?.futureRuleAdjustment ?? investigation?.decisionCard.nextStep ?? "Ask one question, test only on paper, and record the lesson."}
              href="/ask"
              action="Ask the next question"
            />
            <Card className="border-border/60 bg-card/60 lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-white">First-run path</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm text-slate-200 md:grid-cols-2 xl:grid-cols-5">
                {[
                  "Choose a learning goal",
                  "Set risk profile",
                  "Pick experience level",
                  "Choose markets",
                  "Connect demo account",
                  "Set up Telegram",
                  "Take first lesson",
                  "Ask first question",
                  "Review first paper strategy",
                  "Write first journal entry",
                ].map((step, index) => (
                  <div key={step} className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Step {index + 1}</div>
                    <div className="mt-1">{step}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Layout>
  );
}

function FocusCard({ icon: Icon, title, body, href, action }: { icon: typeof BookOpen; title: string; body: string; href: string; action: string }) {
  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-slate-200">
        <p>{body}</p>
        <Link href={href}><Button variant="outline">{action}</Button></Link>
      </CardContent>
    </Card>
  );
}
