import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMarketPilotOverview, usePredictionInsights, usePredictionRecords, usePredictionReviews } from "@/lib/marketpilot";
import { buildPredictionLessonCue } from "@shared/assistantPresentation";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useLocation } from "wouter";

export default function Journal() {
  const [location] = useLocation();
  const { data: overview } = useMarketPilotOverview();
  const { data: predictions } = usePredictionRecords();
  const { data: reviews } = usePredictionReviews();
  const { data: insights } = usePredictionInsights();
  const highlightedPredictionId = typeof window !== "undefined"
    ? new URLSearchParams(location.split("?")[1] ?? "").get("predictionId")
    : null;
  const highlightedReview = highlightedPredictionId ? reviews?.find((review) => review.predictionId === highlightedPredictionId) ?? null : null;
  const [actualOutcome, setActualOutcome] = useState("The move reversed after contradictory evidence strengthened.");
  const firstPrediction = predictions?.[0]?.id ?? "manual-review";
  const lessonCue = buildPredictionLessonCue(insights?.topThemes[0], insights?.recentRules[0]);
  const review = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/marketpilot/assistant/prediction-reviews", {
        predictionId: firstPrediction,
        actualOutcome,
        missingEvidence: ["Positioning and sector flow were not checked deeply enough"],
      });
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/assistant/predictions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/assistant/prediction-reviews"] }),
      ]);
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    review.mutate();
  };

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-bold text-white">Journal</h1>
          <p className="mt-2 text-sm text-muted-foreground">Connect each lesson to a prediction, paper trade, review, mistake, and updated rule.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          {["Lesson", "Prediction", "Paper trade", "Review", "Updated lesson"].map((step) => (
            <div key={step} className="rounded-lg border border-border/60 bg-background/35 p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Learning loop</div>
              <div className="mt-1 text-sm font-medium text-white">{step}</div>
            </div>
          ))}
        </div>

        <Card className="border-border/60 bg-card/70">
          <CardHeader>
            <CardTitle className="text-white">Review what happened</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <ReviewPrompt title="What happened?" value="Record the outcome, not the excuse." />
              <ReviewPrompt title="Why?" value="Name the market driver or missing evidence." />
              <ReviewPrompt title="What did I miss?" value="Turn the mistake into a reusable check." />
              <ReviewPrompt title="Next time" value="Write the rule before the next paper trade." />
            </div>
            <form className="space-y-3" onSubmit={handleSubmit}>
              <Textarea value={actualOutcome} onChange={(event) => setActualOutcome(event.target.value)} />
              <Button type="submit" disabled={review.isPending}>Save review and update lesson</Button>
            </form>
          </CardContent>
        </Card>

        {highlightedReview && (
          <Card className="border-border/60 bg-card/70">
            <CardHeader>
              <CardTitle className="text-white">Linked Review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-200">
              <ReviewLine label="Prediction ID" value={highlightedReview.predictionId} />
              <ReviewLine label="Original thesis" value={highlightedReview.originalThesis} />
              <ReviewLine label="Updated lesson" value={highlightedReview.updatedLesson} />
              <ReviewLine label="Future rule change" value={highlightedReview.futureRuleAdjustment} />
            </CardContent>
          </Card>
        )}

        {insights && (
          <Card className="border-border/60 bg-card/70">
            <CardHeader>
              <CardTitle className="text-white">Learning Insights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {lessonCue && (
                <div className="rounded-lg border border-primary/30 bg-background/35 p-3 text-sm text-slate-200">
                  <div className="text-xs uppercase tracking-wide text-primary">Memory reuse</div>
                  <p className="mt-2">{lessonCue.cue}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {lessonCue.theme} · {lessonCue.count} repeats · {lessonCue.source}
                  </p>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-3">
                <SummaryStat label="Reviews recorded" value={String(insights.reviewCount)} />
                <SummaryStat
                  label="Top repeated lesson"
                  value={insights.topThemes[0]?.theme ?? "No repeated lessons yet."}
                />
                <SummaryStat
                  label="Latest rule update"
                  value={insights.recentRules[0]?.futureRuleAdjustment ?? "No recent rule updates yet."}
                />
              </div>
              <InsightBlock
                title="Repeated lessons"
                items={insights.topThemes.length > 0
                  ? insights.topThemes.slice(0, 3).map((theme) => `${theme.count}x · ${theme.theme}`)
                  : ["No repeated lessons yet."]}
              />
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between border-border/60">
                    Show reviews and rule history
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4 space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <InsightBlock
                      title="Most recent rule updates"
                      items={insights.recentRules.length > 0
                        ? insights.recentRules.slice(0, 3).map((rule) => `${rule.reviewedAt} · ${rule.futureRuleAdjustment}`)
                        : ["No recent rule updates yet."]}
                    />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {(reviews ?? []).slice(0, 3).map((item) => (
                      <Card key={item.id} className="border-border/60 bg-card/60">
                        <CardHeader>
                          <CardTitle className="text-white">Wrong Prediction Review</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-slate-200">
                          <ReviewLine label="Original thesis" value={item.originalThesis} />
                          <ReviewLine label="Expected outcome" value={item.expectedOutcome} />
                          <ReviewLine label="Actual outcome" value={item.actualOutcome} />
                          <ReviewLine label="What was missed" value={item.whatWasMissed.join("; ")} />
                          <ReviewLine label="Updated lesson" value={item.updatedLesson} />
                          <ReviewLine label="Future rule change" value={item.futureRuleAdjustment} />
                        </CardContent>
                      </Card>
                    ))}
                    {(overview?.journalEntries ?? []).slice(0, 3).map((entry) => (
                      <Card key={entry.id} className="border-border/60 bg-card/50">
                        <CardHeader>
                          <CardTitle className="text-white">{entry.title}</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-slate-200">{entry.lessons.join("; ")}</CardContent>
                      </Card>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function InsightBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="mt-2 space-y-2 text-sm text-slate-200">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewPrompt({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-primary">{title}</div>
      <p className="mt-1 text-xs text-slate-200">{value}</p>
    </div>
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

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-muted-foreground">{label}:</span> {value}
    </p>
  );
}
