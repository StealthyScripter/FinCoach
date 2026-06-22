import { AssistantSignalCard } from "@/components/assistant-signal-card";
import { DecisionCard } from "@/components/decision-card";
import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { buildMemoryInfluenceCue } from "@shared/assistantPresentation";
import { useRAGArchive, useRAGContext, type TradingAssistantResponse } from "@/lib/marketpilot";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainCircuit, ChevronDown, Search, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "wouter";

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
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const ask = useMutation({
    mutationFn: async (nextPrompt: string) => {
      const response = await apiRequest("POST", "/api/marketpilot/assistant/ask", { prompt: nextPrompt });
      return response.json() as Promise<TradingAssistantResponse>;
    },
  });
  const ragContext = useRAGContext(submittedPrompt.length > 0 ? submittedPrompt : null);
  const ragArchive = useRAGArchive();
  const memoryRecall = useQuery<MemoryRecallResponse>({
    queryKey: ["/api/marketpilot/memory/recall", prompt],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/marketpilot/memory/recall?query=${encodeURIComponent(prompt)}&limit=3`);
      return response.json() as Promise<MemoryRecallResponse>;
    },
    enabled: Boolean(prompt.trim()),
  });
  const memoryInfluenceCue = buildMemoryInfluenceCue(memoryRecall.data?.items ?? []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedPrompt(prompt);
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
            </div>
            <div className="space-y-4">
                  <Card className="border-border/60 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">Memory influence</CardTitle>
                    </CardHeader>
                <CardContent className="space-y-3 text-sm">
                      {memoryInfluenceCue ? (
                        <>
                          <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">
                              {memoryInfluenceCue.label}
                            </div>
                            <p className="mt-2 text-slate-200">
                              {memoryInfluenceCue.summary}
                            </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {memoryInfluenceCue.sourceLabel} · relevance {memoryInfluenceCue.relevance}
                          </p>
                        </div>
                        <p className="text-slate-200">
                          {memoryInfluenceCue.reason}
                        </p>
                        {memoryInfluenceCue.links.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {memoryInfluenceCue.links.map((link) => (
                              <Link key={link.href} href={link.href}>
                                <Button variant="outline" size="sm" className="border-border/60">
                                  {link.label}
                                </Button>
                              </Link>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                        <p className="text-muted-foreground">
                          {memoryRecall.isLoading ? "Loading memory influence..." : "No prior memory matched this prompt yet."}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="border-border/60 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">What matters now</CardTitle>
                    </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Research focus</div>
                    <ul className="mt-2 space-y-2">
                      {ask.data.researchSummary.slice(0, 3).map((item) => (
                        <li key={item} className="flex gap-2 text-slate-200">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Prediction review</div>
                    <p className="mt-1 text-slate-200">Tracked prediction ID {ask.data.predictionTrackingId}</p>
                  </div>
                  </CardContent>
                  </Card>

                  <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between border-border/60">
                    Show strategy and supporting analysis
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  </CollapsibleTrigger>
                <CollapsibleContent className="mt-4 space-y-4">
                  <Card className="border-border/60 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">Retrieved evidence</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {ragContext.data ? (
                        <>
                          <SummaryLine label="Retrieval confidence" value={`${ragContext.data.confidence} / 100`} />
                          <SummaryLine label="Top citation" value={ragContext.data.citations[0]?.label ?? "No retrieval citations available yet."} />
                          <SummaryLine
                            label="Similar memory"
                            value={ragContext.data.similarMemory[0]
                              ? `${ragContext.data.similarMemory[0].source.replace("_", " ")} · ${ragContext.data.similarMemory[0].text.slice(0, 96)}`
                              : "No similar memory surfaced for this query."}
                          />
                          <SummaryLine label="Freshness" value={ragContext.data.sourceFreshness} />
                          <SummaryLine
                            label="Contradiction hint"
                            value={ragContext.data.contradictionHints[0] ?? "No contradiction hints surfaced for this query."}
                          />
                        </>
                      ) : (
                        <p className="text-muted-foreground">
                          {submittedPrompt ? "Loading retrieval context..." : "Submit a question to retrieve supporting evidence."}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="border-border/60 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">RAG history</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {ragArchive.data?.runs.length ? (
                        ragArchive.data.runs.slice(0, 3).map((run) => (
                          <div key={run.id} className="rounded-lg border border-border/60 bg-background/35 p-3">
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">{run.createdAt}</div>
                            <p className="mt-2 text-slate-200">
                              {run.query} · {run.chunkCount} chunks
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Freshness: {run.sourceFreshness} · citations: {run.citationIds.length} · documents: {ragArchive.data?.documents.filter((document) => document.runId === run.id).length ?? 0}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-muted-foreground">No retrieval runs recorded yet.</p>
                      )}
                    </CardContent>
                  </Card>
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
                    </CardContent>
                  </Card>
                  <Card className="border-border/60 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">Historical Analogues</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {ask.data.historicalAnalogues.length > 0 ? (
                        ask.data.historicalAnalogues.slice(0, 3).map((analogue) => (
                          <div key={analogue.id} className="rounded-lg border border-border/60 bg-background/35 p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-slate-100">{analogue.title}</span>
                              <Badge variant="secondary">Conf {analogue.confidence}%</Badge>
                            </div>
                            <p className="mt-2 text-slate-200">{analogue.summary}</p>
                            <p className="mt-2 text-xs text-muted-foreground">Why similar: {analogue.whySimilar}</p>
                            <p className="mt-2 text-xs text-muted-foreground">Lesson: {analogue.lesson}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">No stored analogues matched the current prompt yet.</p>
                      )}
                    </CardContent>
                  </Card>
                  {ask.data.signals.slice(0, 3).map((signal) => (
                    <AssistantSignalCard key={signal.id} signal={signal} />
                  ))}
                  <Card className="border-border/60 bg-card/70">
                    <CardHeader>
                      <CardTitle className="text-white">Memory Recall</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {memoryRecall.data?.items.length ? (
                        memoryRecall.data.items.map((item) => (
                          <div key={item.id} className="rounded-lg border border-border/60 bg-background/35 p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-slate-100">{item.kind.replaceAll("_", " ")}</span>
                              <Badge variant="outline" className="border-primary/30 text-primary">
                                {item.source} · {item.relevance}
                              </Badge>
                            </div>
                            <p className="mt-2 text-slate-200">{item.text}</p>
                            <p className="mt-2 text-xs text-muted-foreground">Tags: {item.tags.join(", ")}</p>
                            {typeof item.metadata.predictionId === "string" && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Link href={`/journal?predictionId=${encodeURIComponent(item.metadata.predictionId)}`}>
                                  <Button variant="outline" size="sm" className="border-border/60">
                                    Open matching journal review
                                  </Button>
                                </Link>
                              </div>
                            )}
                            {typeof item.metadata.journalEntryId === "string" && typeof item.metadata.predictionId !== "string" && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                Related journal entry: {item.metadata.journalEntryId}
                              </p>
                            )}
                            {typeof item.metadata.reportId === "string" && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                Related research report: {item.metadata.reportId}
                              </p>
                            )}
                            {typeof item.metadata.graphNodeId === "string" && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                Knowledge graph node: {item.metadata.graphNodeId}
                              </p>
                            )}
                            {item.artifactLinks.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {item.artifactLinks.map((link) => (
                                  <Link key={link.href} href={link.href}>
                                    <Button variant="outline" size="sm" className="border-border/60">
                                      {link.label}
                                    </Button>
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {memoryRecall.isLoading ? "Loading memory recall..." : "No stored memory matched this prompt yet."}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </CollapsibleContent>
              </Collapsible>
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

type MemoryRecallResponse = {
  generatedAt: string;
  query: string;
  items: Array<{
    id: string;
    kind: string;
    text: string;
    tags: string[];
    metadata: Record<string, unknown>;
    createdAt: string;
    source: "semantic" | "long_term";
    relevance: number;
    artifactLinks: Array<{
      label: string;
      href: string;
    }>;
  }>;
};

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="mt-1 text-sm text-slate-200">{value}</p>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="mt-1 text-sm text-slate-200">{value}</p>
    </div>
  );
}
