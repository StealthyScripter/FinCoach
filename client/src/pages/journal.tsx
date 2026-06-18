import Layout from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMarketPilotOverview, usePredictionRecords, usePredictionReviews } from "@/lib/marketpilot";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

export default function Journal() {
  const { data: overview } = useMarketPilotOverview();
  const { data: predictions } = usePredictionRecords();
  const { data: reviews } = usePredictionReviews();
  const [actualOutcome, setActualOutcome] = useState("The move reversed after contradictory evidence strengthened.");
  const firstPrediction = predictions?.[0]?.id ?? "manual-review";
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
          <p className="mt-2 text-sm text-muted-foreground">Prediction tracking, missed evidence, and wrong-thesis learning loop.</p>
        </div>

        <Card className="border-border/60 bg-card/70">
          <CardHeader>
            <CardTitle className="text-white">Review Prediction</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={handleSubmit}>
              <Textarea value={actualOutcome} onChange={(event) => setActualOutcome(event.target.value)} />
              <Button type="submit" disabled={review.isPending}>Record What We Missed</Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {(reviews ?? []).slice(0, 4).map((item) => (
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
          {(overview?.journalEntries ?? []).slice(0, 4).map((entry) => (
            <Card key={entry.id} className="border-border/60 bg-card/50">
              <CardHeader>
                <CardTitle className="text-white">{entry.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-200">{entry.lessons.join("; ")}</CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-muted-foreground">{label}:</span> {value}
    </p>
  );
}
