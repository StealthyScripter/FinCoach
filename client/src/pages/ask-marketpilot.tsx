import { AssistantSignalCard } from "@/components/assistant-signal-card";
import { DecisionCard } from "@/components/decision-card";
import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import type { TradingAssistantResponse } from "@/lib/marketpilot";
import { useMutation } from "@tanstack/react-query";
import { BrainCircuit, Search, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";

const examples = [
  "Why did Microsoft drop?",
  "Should I short Boeing?",
  "Find forex setups.",
  "Is this crypto move real?",
  "Review my portfolio risk.",
  "Teach me credit scores.",
  "Explain today's Fed impact.",
];

export default function AskMarketPilot() {
  const [prompt, setPrompt] = useState("Why did Microsoft fall?");
  const ask = useMutation({
    mutationFn: async (nextPrompt: string) => {
      const response = await apiRequest("POST", "/api/marketpilot/assistant/ask", { prompt: nextPrompt });
      return response.json() as Promise<TradingAssistantResponse>;
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    ask.mutate(prompt);
  };

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="rounded-xl border border-border/60 bg-card/70 p-5">
          <div className="flex items-center gap-2 text-primary">
            <BrainCircuit className="h-5 w-5" />
            <span className="text-xs uppercase tracking-widest">Ask MarketPilot</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold text-white">What do you want to understand or trade?</h1>
          <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="min-h-24 text-base"
            />
            <div className="flex flex-wrap gap-2">
              {examples.map((example) => (
                <Button key={example} type="button" variant="outline" size="sm" onClick={() => setPrompt(example)}>
                  {example}
                </Button>
              ))}
            </div>
            <Button type="submit" disabled={ask.isPending} className="gap-2">
              <Search className="h-4 w-4" />
              {ask.isPending ? "Investigating..." : "Ask"}
            </Button>
          </form>
        </div>

        {ask.data ? (
          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <div className="space-y-5">
              <DecisionCard card={ask.data.decisionCard} />
              {ask.data.strategyOptions[0] && (
                <Card className="border-border/60 bg-card/70">
                  <CardHeader>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="border-primary/30 text-primary">Strategy</Badge>
                      <Badge variant="secondary">Confidence {ask.data.strategyOptions[0].confidence}%</Badge>
                    </div>
                    <CardTitle className="text-white">{ask.data.strategyOptions[0].possibleStrategy}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-2">
                    <Info label="Instrument" value={ask.data.strategyOptions[0].bestInstrument} />
                    <Info label="Position size" value={ask.data.strategyOptions[0].positionSize} />
                    <Info label="Entry" value={ask.data.strategyOptions[0].entryLogic} />
                    <Info label="Stop" value={ask.data.strategyOptions[0].stopLossLogic} />
                    <Info label="Why not to trade" value={ask.data.strategyOptions[0].whyItMightFail[0] ?? "Evidence may weaken."} />
                    <Info label="Safer alternative" value={ask.data.strategyOptions[0].saferAlternatives[0]} />
                  </CardContent>
                </Card>
              )}
            </div>
            <div className="space-y-4">
              <Card className="border-rose-500/30 bg-rose-500/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <ShieldCheck className="h-5 w-5 text-rose-300" />
                    Risk Check
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <Badge variant="outline" className="border-rose-500/40 text-rose-300">{ask.data.riskCheck.decision}</Badge>
                  {ask.data.riskCheck.reasons.slice(0, 3).map((reason) => (
                    <p key={reason} className="text-slate-200">{reason}</p>
                  ))}
                </CardContent>
              </Card>
              <Card className="border-border/60 bg-card/70">
                <CardHeader>
                  <CardTitle className="text-white">Learning Note</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-200">{ask.data.learningNote}</p>
                  <p className="mt-3 text-xs text-muted-foreground">Prediction ID: {ask.data.predictionTrackingId}</p>
                </CardContent>
              </Card>
              {ask.data.signals.slice(0, 4).map((signal) => (
                <AssistantSignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {["Understand", "Decide", "Act safely"].map((title) => (
              <Card key={title} className="border-border/60 bg-card/50">
                <CardHeader>
                  <CardTitle className="text-white">{title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  MarketPilot will surface only the main cause, confidence, risks, next step, and relevant drill-down details.
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="mt-1 text-sm text-slate-200">{value}</p>
    </div>
  );
}
