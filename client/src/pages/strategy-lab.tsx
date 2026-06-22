import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useStrategyLab } from "@/lib/marketpilot";
import { AlertTriangle, BrainCircuit, ChevronDown, FlaskConical, ShieldAlert } from "lucide-react";

export default function StrategyLab() {
  const { data: lab, isLoading, error } = useStrategyLab();

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col gap-3 border-b border-border/50 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-primary/40 text-primary">
                Recommendations only
              </Badge>
              <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                No strategy self-modification
              </Badge>
            </div>
            <h1 className="mt-3 text-3xl font-bold text-white">Strategy Lab</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              MarketPilot ranks evidence, learning signals, and decay warnings first. Advanced analytics stay collapsed until you need them.
            </p>
          </div>
          {lab && (
            <div className="rounded-lg border border-border/60 bg-card/70 p-3 text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Generated</div>
              <div className="mt-1 font-mono text-sm text-white">{new Date(lab.generatedAt).toLocaleString()}</div>
            </div>
          )}
        </div>

        {isLoading && (
          <Card className="border-border/50 bg-card/70">
            <CardContent className="p-6 text-muted-foreground">Loading strategy lab...</CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-500/10">
            <CardContent className="p-6 text-rose-100">Unable to load strategy lab analysis.</CardContent>
          </Card>
        )}

        {lab && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <SummaryCard label="Top strategies" value={lab.topStrategies.length} />
              <SummaryCard label="Weak strategies" value={lab.weakStrategies.length} />
              <SummaryCard label="Learning priorities" value={lab.learningPriorities.items.length} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <TopListCard
                title="Top strategies"
                description="Highest evidence-backed scores."
                items={lab.topStrategies.slice(0, 3).map((item) => `${item.strategyName} · ${item.overallScore}/100 · ${item.verdict}`)}
              />
              <TopListCard
                title="Weak strategies"
                description="Lowest scores and most fragile evidence."
                items={lab.weakStrategies.slice(0, 3).map((item) => `${item.strategyName} · ${item.overallScore}/100 · ${item.verdict}`)}
              />
              <TopListCard
                title="Retirement candidates"
                description="Pause or retire for review."
                items={lab.retirementCandidates.length > 0
                  ? lab.retirementCandidates.slice(0, 3).map((item) => `${item.strategyName} · ${item.verdict}`)
                  : ["No retirement candidate crossed the threshold."]}
              />
              <TopListCard
                title="Adaptation suggestions"
                description="Human-reviewed adjustments only."
                items={lab.adaptationSuggestions.slice(0, 3).map((item) => `${item.strategyId} · ${item.type} · ${item.reason}`)}
              />
              <TopListCard
                title="Latest lessons"
                description="Newest learning items."
                items={lab.latestLessons.slice(0, 3).map((item) => `${item.source} · ${item.lesson}`)}
              />
            </div>

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between border-border/60">
                  Show advanced analysis
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="border-border/50 bg-card/70">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-white">
                        <BrainCircuit className="h-5 w-5 text-primary" />
                        Memory graph
                      </CardTitle>
                      <CardDescription>Lessons, mistakes, strategy links, outcomes, and reminders.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-200">
                      <div className="grid gap-3 md:grid-cols-3">
                        <MiniStat label="Nodes" value={lab.memoryGraph.nodes.length} />
                        <MiniStat label="Edges" value={lab.memoryGraph.edges.length} />
                        <MiniStat label="Traversal" value={lab.memoryGraph.traversal.visitedNodeIds.length} />
                      </div>
                      <List title="High influence nodes" items={lab.memoryGraph.influenceScores.slice(0, 3).map((item: any) => `${item.nodeId} · ${item.score}`)} />
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 bg-card/70">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-white">
                        <AlertTriangle className="h-5 w-5 text-primary" />
                        Recurring mistakes
                      </CardTitle>
                      <CardDescription>Repeated behavior that should shape the next lesson.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-200">
                      <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Priority</div>
                        <p className="mt-2 text-base">{lab.recurringMistakes.interventionRecommendation}</p>
                      </div>
                      <List
                        title="Patterns"
                        items={lab.recurringMistakes.items.slice(0, 5).map((item: any) => `${item.pattern} · ${item.count} · ${item.interventionRecommendation}`)}
                      />
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 bg-card/70">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-white">
                        <ShieldAlert className="h-5 w-5 text-primary" />
                        Confidence calibration
                      </CardTitle>
                      <CardDescription>Prediction confidence versus actual outcomes.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-200">
                      <div className="grid gap-3 md:grid-cols-4">
                        <MiniStat label="Reviews" value={lab.confidenceCalibration.totalReviews} />
                        <MiniStat label="Expected" value={`${Math.round(lab.confidenceCalibration.expectedAccuracy * 100)}%`} />
                        <MiniStat label="Observed" value={`${Math.round(lab.confidenceCalibration.observedAccuracy * 100)}%`} />
                        <MiniStat label="Drift" value={lab.confidenceCalibration.calibrationDrift.toFixed(2)} />
                      </div>
                      <List title="Adjustment suggestions" items={lab.confidenceCalibration.confidenceAdjustmentSuggestions} />
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 bg-card/70">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-white">
                        <FlaskConical className="h-5 w-5 text-primary" />
                        Performance decay and comparison
                      </CardTitle>
                      <CardDescription>Decay verdicts and cross-strategy comparisons stay hidden by default.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-200">
                      <List
                        title="Decay verdicts"
                        items={lab.performanceDecay.items.slice(0, 4).map((item: any) => `${item.strategyName} · ${item.verdict} · ${item.reasons[0] ?? "No issue"}`)}
                      />
                      <List
                        title="Cross-strategy ranks"
                        items={lab.crossStrategyComparison.items.slice(0, 5).map((item: any) => `${item.rank}. ${item.strategyType} · expectancy ${item.expectancy} · regret ${item.regretScore}`)}
                      />
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-border/50 bg-card/70">
                  <CardHeader>
                    <CardTitle className="text-white">Regret and counterfactual analysis</CardTitle>
                    <CardDescription>Use this only to learn. History is never rewritten.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm text-slate-200">
                    <div className="grid gap-3 md:grid-cols-3">
                      <MiniStat label="Regret score" value={lab.regretAnalysis.regretScore} />
                      <MiniStat label="Counterfactual trades" value={lab.counterfactualAnalysis.tradeCount} />
                      <MiniStat label="Learning notes" value={lab.regretAnalysis.learningNotes.length} />
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <List title="Regret notes" items={lab.regretAnalysis.learningNotes} />
                      <List
                        title="Counterfactual summary"
                        items={lab.counterfactualAnalysis.summary.concat(
                          lab.counterfactualAnalysis.items.slice(0, 2).map((trade: any) => `${trade.symbol} · actual ${trade.actualPnL} · scenarios ${trade.scenarios.length}`),
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50 bg-card/70">
                  <CardHeader>
                    <CardTitle className="text-white">Strategy score evolution</CardTitle>
                    <CardDescription>Overall score, confidence, and verdict remain recommendation-only.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-slate-200">
                    <div className="grid gap-3 md:grid-cols-3">
                      <MiniStat label="Analyses" value={lab.strategyEvolution.length} />
                      <MiniStat label="Learning priority" value={lab.learningPriorities.items[0]?.lessonPriority ?? 0} />
                      <MiniStat label="Strategy graph links" value={lab.memoryGraph.edges.length} />
                    </div>
                    <List
                      title="Score evolution"
                      items={lab.strategyEvolution.slice(0, 4).map((item: any) => `${item.strategyName} · ${item.overallScore}/100 · ${item.scoreEvolution.verdict}`)}
                    />
                  </CardContent>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="border-border/50 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">Evidence depth</CardTitle>
                      <CardDescription>Trade sample depth and coverage thresholds stay behind the fold.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-200">
                      <List
                        title="Depth verdicts"
                        items={lab.evidenceDepth.slice(0, 4).map((item) => `${item.strategyId} · ${item.verdict} · ${item.totalTrades} trades · ${item.regimesTested.length} regimes`)}
                      />
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">Closed-trade history</CardTitle>
                      <CardDescription>Preserved inputs, regime labels, and lifecycle details for review.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-200">
                      <List
                        title="Recent trade history"
                        items={lab.closedTradeHistory.slice(0, 3).map((entry) => `${entry.strategyName} · ${entry.trades.length} closed trades · ${entry.trades[0] ? `${entry.trades[0].symbol} ${entry.trades[0].outcome}` : "no trades"}`)}
                      />
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">Rejected signal learning</CardTitle>
                      <CardDescription>Rejected signals are retained and evaluated for later outcomes.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-200">
                      <List
                        title="Rejection outcomes"
                        items={lab.rejectedSignalLearning.slice(0, 3).map((entry) => `${entry.strategyName} · ${entry.signals.length} rejections · ${entry.signals[0]?.correct ? "mostly correct" : "needs review"}`)}
                      />
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">Verdict explanation</CardTitle>
                      <CardDescription>Why each ranking landed where it did, without a dense dashboard.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-200">
                      <List
                        title="Explanation previews"
                        items={lab.verdictExplanations.slice(0, 4).map((entry) => `${entry.strategyName} · ${entry.overallScore}/100 · ${entry.whyRankedThisWay[0] ?? "No explanation yet"}`)}
                      />
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card className="border-border/50 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">Regime performance</CardTitle>
                      <CardDescription>Trending, ranging, and volatility fit are summarized for review.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-200">
                      <List
                        title="Regime fit"
                        items={lab.strategyEvolution.slice(0, 4).map((item: any) => `${item.strategyName} · ${item.regimePerformance.allowedRegimes.join(", ") || "monitor only"} · ${item.regimePerformance.recommendations[0] ?? "No recommendation"}`)}
                      />
                    </CardContent>
                  </Card>

                  <Card className="border-border/50 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">Symbol performance</CardTitle>
                      <CardDescription>Symbol fit stays collapsed until you need it.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-slate-200">
                      <List
                        title="Symbol fit"
                        items={lab.strategyEvolution.slice(0, 4).map((item: any) => `${item.strategyName} · ${item.symbolSuitability[0]?.symbol ?? "n/a"} · ${item.symbolSuitability[0]?.expectancy ?? 0} expectancy`)}
                      />
                    </CardContent>
                  </Card>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </div>
    </Layout>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border-border/50 bg-card/70">
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-bold text-white">{value}</div>
      </CardContent>
    </Card>
  );
}

function TopListCard({ title, description, items }: { title: string; description: string; items: string[] }) {
  return (
    <Card className="border-border/50 bg-card/70">
      <CardHeader>
        <CardTitle className="text-white">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-slate-200">
        {items.map((item) => (
          <div key={item} className="rounded-lg border border-border/60 bg-background/35 px-3 py-2">
            {item}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg text-white">{value}</div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-2">
        {items.length > 0 ? items.map((item) => (
          <div key={item} className="rounded-lg border border-border/60 bg-background/35 px-3 py-2">
            {item}
          </div>
        )) : (
          <div className="rounded-lg border border-border/60 bg-background/35 px-3 py-2 text-muted-foreground">
            No items to show.
          </div>
        )}
      </div>
    </div>
  );
}
