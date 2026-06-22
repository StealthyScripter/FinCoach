import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { buildIntelligenceLessonHighlight } from "@shared/assistantPresentation";
import {
  useAgentOutputs,
  useAgentSupervisor,
  useAIResearchEvaluation,
  useAIStatus,
  useAlerts,
  useAnalyticsArchive,
  useCacheHealth,
  useEventLogSnapshot,
  useIngestionSnapshot,
  useIngestionArchive,
  useInstitutionalAnalytics,
  useKnowledgeGraph,
  useKnowledgeGraphArchive,
  useMemoryHealth,
  useMetricsSnapshot,
  useModelValidationBenchmark,
  useProviderHealth,
  useRAGContext,
  useStorageHealth,
  useTimeSeriesHealth,
  useTimeSeriesArchive,
  useVectorStoreHealth,
  useVectorStoreArchive,
} from "@/lib/marketpilot";
import type { AgentOutput } from "@shared/schema";
import { BellRing, BrainCircuit, ChevronDown, DatabaseZap, FileCheck2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "wouter";

export default function Intelligence() {
  const [location] = useLocation();
  const startNodeId = new URLSearchParams(location.split("?")[1] ?? "").get("start");
  const { data: outputs, isLoading, error } = useAgentOutputs();
  const { data: supervisor } = useAgentSupervisor();
  const { data: alerts } = useAlerts();
  const { data: ingestion } = useIngestionSnapshot();
  const { data: storageHealth } = useStorageHealth();
  const { data: providerHealth } = useProviderHealth();
  const { data: metrics } = useMetricsSnapshot();
  const { data: events } = useEventLogSnapshot();
  const { data: memoryHealth } = useMemoryHealth();
  const { data: ingestionArchive } = useIngestionArchive();
  const { data: knowledgeGraph } = useKnowledgeGraph(startNodeId);
  const { data: knowledgeGraphArchive } = useKnowledgeGraphArchive();
  const { data: analyticsArchive } = useAnalyticsArchive();
  const { data: analytics } = useInstitutionalAnalytics();
  const { data: modelValidation } = useModelValidationBenchmark();
  const { data: aiStatus } = useAIStatus();
  const { data: ragContext } = useRAGContext();
  const { data: vectorHealth } = useVectorStoreHealth();
  const { data: vectorArchive } = useVectorStoreArchive();
  const { data: cacheHealth } = useCacheHealth();
  const { data: timeSeriesHealth } = useTimeSeriesHealth();
  const { data: timeSeriesArchive } = useTimeSeriesArchive();
  const { data: aiEvaluation } = useAIResearchEvaluation();
  const [traceCorrelationId, setTraceCorrelationId] = useState("");

  const traceLookup = useMutation({
    mutationFn: async (correlationId: string) => {
      const response = await apiRequest("GET", `/api/marketpilot/traces/${correlationId}`);
      return response.json() as Promise<{
        correlationId: string;
        generatedAt: string;
        entryCount: number;
        eventCount: number;
        auditCount: number;
        firstSeenAt: string | null;
        lastSeenAt: string | null;
        entries: Array<{ timestamp: string; summary: string }>;
      }>;
    },
  });
  const otelLookup = useMutation({
    mutationFn: async (correlationId: string) => {
      const response = await apiRequest("GET", `/api/marketpilot/traces/${correlationId}/otel`);
      return response.json() as Promise<{
        correlationId: string;
        generatedAt: string;
        traceId: string;
        spanCount: number;
        spans: Array<{ name: string; status: "ok" | "error" }>;
      }>;
    },
  });

  const riskOfficer = outputs?.find((output) => output.agent === "risk");
  const graphNodes = knowledgeGraph?.nodes ?? [];
  const graphNodeById = new Map(graphNodes.map((node) => [node.id, node] as const));
  const trailNodes = knowledgeGraph
    ? knowledgeGraph.traversal.visitedNodeIds
        .map((nodeId) => graphNodeById.get(nodeId))
        .filter((node): node is typeof graphNodes[number] => Boolean(node))
    : [];
  const lessonTrailNodes = graphNodes
    .filter((node) => node.type === "LessonLearned" || (node.type === "AgentDecision" && typeof node.metadata.predictionId === "string"))
    .slice(0, 4);
  const lessonHighlight = buildIntelligenceLessonHighlight(
    graphNodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      metadata: node.metadata,
    })),
  );

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col gap-3 border-b border-border/50 pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="border-primary/40 text-primary">Structured agents</Badge>
                <Badge variant="outline" className="border-rose-500/40 text-rose-300">Risk Officer can veto</Badge>
                {startNodeId && (
                  <Badge variant="outline" className="border-sky-500/40 text-sky-300">
                    Graph start: {startNodeId}
                  </Badge>
                )}
              </div>
            <h1 className="mt-3 text-3xl font-bold text-white">Intelligence Desk</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              MarketPilot shows a compact set of summaries first, then lets you open the deeper analytics, traces, and infrastructure view on demand.
            </p>
          </div>
          {riskOfficer && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-right">
              <div className="text-xs uppercase tracking-wide text-rose-200">Risk override</div>
              <div className="mt-1 font-mono text-2xl font-bold text-white">{riskOfficer.confidence}%</div>
            </div>
          )}
        </div>

        {isLoading && (
          <Card className="border-border/50 bg-card/70">
            <CardContent className="p-6 text-muted-foreground">Loading agent outputs...</CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-500/10">
            <CardContent className="p-6 text-rose-100">Unable to load agent outputs.</CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <SummaryStat
            label="Operator readiness"
            value={storageHealth ? `${storageHealth.mode} / ${storageHealth.status}` : "loading"}
          />
          <SummaryStat
            label="Institutional posture"
            value={analytics ? `${analytics.regime.primaryRegime.replace("_", " ")} · consensus ${analytics.consensus.consensusScore}` : "loading"}
          />
          <SummaryStat
            label="AI stack"
            value={aiStatus ? `${aiStatus.provider} / ${aiStatus.status}` : "loading"}
          />
        </div>

        {lessonHighlight && (
          <Card className="border-primary/30 bg-card/70">
            <CardHeader>
              <CardTitle className="text-white">Lesson priority</CardTitle>
              <CardDescription>
                {lessonHighlight.reason}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-200">
              <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Top memory</div>
                <p className="mt-2">{lessonHighlight.title}</p>
                <p className="mt-2 text-xs text-muted-foreground">{lessonHighlight.summary}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/${lessonHighlight.graphLink}`}>
                  <Button variant="outline" size="sm" className="border-border/60">Open graph trail</Button>
                </Link>
                {lessonHighlight.reviewLink && (
                  <Link href={lessonHighlight.reviewLink}>
                    <Button variant="outline" size="sm" className="border-border/60">Open review</Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full justify-between border-border/60">
              Show intelligence, infrastructure, and trace details
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 space-y-4">
            {(storageHealth || providerHealth || metrics || events || memoryHealth) && (
              <Card className="border-border/50 bg-card/70">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <DatabaseZap className="h-5 w-5 text-primary" />
                    Operator Readiness
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-5">
                    <Metric label="Storage" value={storageHealth ? `${storageHealth.mode} / ${storageHealth.status}` : "loading"} />
                    <Metric label="Providers" value={providerHealth ? String(providerHealth.providers.length) : "loading"} />
                    <Metric label="Events" value={events ? String(events.eventCount) : "loading"} />
                    <Metric label="Memory" value={memoryHealth ? `${memoryHealth.longTerm.records}/${memoryHealth.semantic.records}` : "loading"} />
                    <Metric label="Requests" value={metrics ? String(metrics.requestCount) : "loading"} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-3">
                    <Section title="Storage checks" items={storageHealth ? storageHealth.checks.map((check) => `${check.status}: ${check.detail}`) : ["Loading storage checks"]} />
                    <Section title="Provider readiness" items={providerHealth ? providerHealth.providers.slice(0, 5).map((provider) => `${provider.name}: ${provider.status} (${provider.providerMode})`) : ["Loading providers"]} />
                    <Section
                      title="Metrics"
                      items={metrics ? [
                        `Rate limits: ${metrics.rateLimitCount}`,
                        `Supervisor workflows: ${metrics.supervisorWorkflowCount}`,
                        `Verification pass/fail: ${metrics.verificationPassCount}/${metrics.verificationFailCount}`,
                        `Risk approve/reject: ${metrics.riskApprovalCount}/${metrics.riskRejectionCount}`,
                        `Avg verification: ${metrics.averageVerificationScore}`,
                      ] : ["Loading metrics"]}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {(analytics || knowledgeGraph) && (
              <Card className="border-border/50 bg-card/70">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <BrainCircuit className="h-5 w-5 text-primary" />
                    Institutional Analytics
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-6">
                    <Metric label="KG nodes" value={knowledgeGraph ? String(knowledgeGraph.nodes.length) : "loading"} />
                    <Metric label="KG edges" value={knowledgeGraph ? String(knowledgeGraph.edges.length) : "loading"} />
                    <Metric label="KG archive" value={knowledgeGraphArchive ? String(knowledgeGraphArchive.events.length) : "loading"} />
                    <Metric label="Analytics archive" value={analyticsArchive ? String(analyticsArchive.events.length) : "loading"} />
                    <Metric label="Model bench" value={modelValidation ? String(modelValidation.overallScore) : "loading"} />
                    <Metric label="Behavior" value={analytics ? String(analytics.behavior.behavioralScore) : "loading"} />
                  </div>
                  {analytics && (
                    <div className="grid gap-4 lg:grid-cols-3">
                      <Section
                        title="Key signal"
                        items={[
                          `Regime ${analytics.regime.primaryRegime.replace("_", " ")} · ${analytics.regime.confidence}%`,
                          `Consensus ${analytics.consensus.consensusScore}`,
                          `Loss probability ${analytics.monteCarlo.probabilityOfLossPct}%`,
                        ]}
                      />
                      <Section
                        title="Risk warnings"
                        items={analytics.factors.concentrationWarnings.length > 0 ? analytics.factors.concentrationWarnings.slice(0, 3) : ["No factor concentration warning"]}
                      />
                      <Section
                        title="Behavior and disagreement"
                        items={[
                          ...analytics.consensus.disagreement.slice(0, 2),
                          `Behavior score ${analytics.behavior.behavioralScore}`,
                        ]}
                      />
                    </div>
                  )}
                  {modelValidation && (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Section title="Historical benchmarks" items={modelValidation.models.slice(0, 4).map((model) => `${model.name}: ${model.verdict} (${model.score})`)} />
                      <Section title="Model validation actions" items={modelValidation.requiredActions.length > 0 ? modelValidation.requiredActions : ["No immediate validation action"]} />
                    </div>
                  )}
                  {knowledgeGraph?.traversal.startNodeId && (
                    <Section
                      title="Graph traversal"
                      items={[
                        `Start node ${knowledgeGraph.traversal.startNodeId}`,
                        `Visited ${knowledgeGraph.traversal.visitedNodeIds.length} nodes`,
                        ...knowledgeGraph.traversal.pathSummaries.slice(0, 4),
                      ]}
                    />
                  )}
                  {knowledgeGraph && (
                    <Card className="border-border/60 bg-background/35">
                      <CardHeader>
                        <CardTitle className="text-white">Lesson trail</CardTitle>
                        <CardDescription>
                          Follow the remembered lesson back to the review or forward into the graph.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-3 lg:grid-cols-2">
                          <Section
                            title="Current trail"
                            items={trailNodes.length > 0
                              ? trailNodes.slice(0, 4).map((node) => `${node.type}: ${node.label}`)
                              : ["No traversal trail available yet"]}
                          />
                          <Section
                            title="Memory anchors"
                            items={lessonTrailNodes.length > 0
                              ? lessonTrailNodes.map((node) => `${node.type}: ${node.label}`)
                              : ["No lesson nodes available yet"]}
                          />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {lessonTrailNodes.map((node) => {
                            const predictionId = typeof node.metadata.predictionId === "string" ? node.metadata.predictionId : null;
                            const reviewId = typeof node.metadata.reviewId === "string" ? node.metadata.reviewId : null;
                            return (
                              <div key={node.id} className="rounded-lg border border-border/60 bg-card/50 p-3">
                                <div className="text-xs uppercase tracking-wide text-muted-foreground">{node.type}</div>
                                <div className="mt-1 font-medium text-white">{node.label}</div>
                                <div className="mt-2 text-xs text-muted-foreground">Node {node.id}</div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Link href={`/intelligence?start=${encodeURIComponent(node.id)}`}>
                                    <Button size="sm" variant="outline" className="border-border/60">
                                      Open in graph
                                    </Button>
                                  </Link>
                                  {predictionId && (
                                    <Link href={`/journal?predictionId=${encodeURIComponent(predictionId)}`}>
                                      <Button size="sm" variant="outline" className="border-border/60">
                                        Open review
                                      </Button>
                                    </Link>
                                  )}
                                  {reviewId && !predictionId && (
                                    <span className="text-xs text-muted-foreground">Review {reviewId}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </CardContent>
              </Card>
            )}

            {aiStatus && (
              <Card className="border-border/50 bg-card/70">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <FileCheck2 className="h-5 w-5 text-sky-300" />
                    AI Infrastructure
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-6">
                    <Metric label="AI provider" value={`${aiStatus.provider} / ${aiStatus.status}`} />
                    <Metric label="Tokens" value={String(aiStatus.tokenUsage?.totalTokens ?? 0)} />
                    <Metric label="RAG chunks" value={ragContext ? String(ragContext.chunks?.length ?? 0) : "loading"} />
                    <Metric label="Vector" value={vectorHealth ? `${vectorHealth.provider} / ${vectorHealth.status}` : "loading"} />
                    <Metric label="Cache" value={cacheHealth ? `${cacheHealth.provider} / ${cacheHealth.status}` : "loading"} />
                    <Metric label="Series" value={timeSeriesHealth ? `${timeSeriesHealth.provider} / ${timeSeriesHealth.status}` : "loading"} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-3">
                    <Section title="AI safety" items={aiStatus.safety?.notes ?? ["Loading AI safety metadata"]} />
                    <Section title="RAG citations" items={ragContext?.citations?.slice(0, 4).map((citation: any) => `${citation.source}: ${citation.label}`) ?? ["Loading retrieval context"]} />
                    <Section
                      title="AI evaluation"
                      items={aiEvaluation ? [
                        `Overall ${aiEvaluation.overallScore}`,
                        `Schema ${aiEvaluation.schemaAdherence}`,
                        `Citation ${aiEvaluation.citationCoverage}`,
                        `Safety ${aiEvaluation.refusalSafetyCorrectness}`,
                      ] : ["Loading AI evaluation"]}
                    />
                  </div>
                  <Section
                    title="Vector archive"
                    items={vectorArchive ? [
                      `Stored vectors ${vectorArchive.records.length}`,
                      ...vectorArchive.records.slice(0, 3).map((record) => `${record.id}: ${record.text.slice(0, 80)}`),
                    ] : ["Loading vector archive"]}
                  />
                  <Section
                    title="Time-series archive"
                    items={timeSeriesArchive ? [
                      `Price bars ${timeSeriesArchive.priceBars.length}`,
                      `Economic observations ${timeSeriesArchive.economicObservations.length}`,
                      `Options snapshots ${timeSeriesArchive.optionsSnapshots.length}`,
                      `Ingestion runs ${timeSeriesArchive.ingestionRuns.length}`,
                    ] : ["Loading time-series archive"]}
                  />
                </CardContent>
              </Card>
            )}

            {ingestion && (
              <Card className="border-border/50 bg-card/70">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <DatabaseZap className="h-5 w-5 text-primary" />
                    Ingestion Snapshot
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <Metric label="Provider mode" value={ingestion.providerMode} />
                    <Metric label="Prices" value={String(ingestion.marketPrices.length)} />
                    <Metric label="Events" value={String(ingestion.economicEvents.length)} />
                    <Metric label="News" value={String(ingestion.newsArticles.length)} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                    <div>
                      <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Tracked prices</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {ingestion.marketPrices.slice(0, 6).map((price) => (
                          <div key={price.id} className="grid grid-cols-[1fr_auto] rounded-md border border-border/60 bg-background/35 px-3 py-2 text-sm">
                            <span className="text-slate-200">{price.symbol}</span>
                            <span className={price.changePct >= 0 ? "font-mono text-emerald-300" : "font-mono text-rose-300"}>
                              ${price.price.toFixed(2)} / {price.changePct >= 0 ? "+" : ""}{price.changePct.toFixed(2)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Section title="Freshness actions" items={ingestion.freshness.staleItems.length > 0 ? ingestion.freshness.staleItems : ingestion.requiredActions} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Section title="Upcoming events" items={ingestion.economicEvents.slice(0, 3).map((event) => `${event.impact}: ${event.title}`)} />
                    <Section title="News sample" items={ingestion.newsArticles.slice(0, 3).map((article) => `${article.source}: ${article.headline}`)} />
                  </div>
                </CardContent>
              </Card>
            )}

            {ingestionArchive && (
              <Card className="border-border/50 bg-card/70">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <DatabaseZap className="h-5 w-5 text-primary" />
                    Ingestion Archive
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Section
                    title="Recent runs"
                    items={ingestionArchive.runs.length > 0
                      ? ingestionArchive.runs.slice(0, 4).map((run) => `${run.status}: ${run.providerId} · ${run.records} records`)
                      : ["No ingestion runs recorded yet"]}
                  />
                </CardContent>
              </Card>
            )}

            {supervisor && (
              <Card className="border-border/50 bg-card/70">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-white">
                        <BrainCircuit className="h-5 w-5 text-primary" />
                        Supervisor Workflow
                      </CardTitle>
                      <CardDescription>{supervisor.summary}</CardDescription>
                    </div>
                    <Badge variant="outline" className={supervisor.mode === "live_blocked" ? "border-rose-500/40 text-rose-300" : "border-sky-500/40 text-sky-300"}>
                      {supervisor.mode.replace("_", " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <Metric label="Workflow steps" value={supervisor.workflow.length.toString()} />
                    <Metric label="Required actions" value={supervisor.requiredActions.length.toString()} />
                    <Metric label="Blocked caps" value={supervisor.blockedCapabilities.length.toString()} />
                    <Metric label="Mode" value={supervisor.mode.replace("_", " ")} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Section title="Step notes" items={supervisor.workflow.slice(0, 4).map((step) => `${step}`)} />
                    <Section title="Alerts" items={alerts ? alerts.slice(0, 4).map((alert) => `${alert.severity} · ${alert.title}`) : ["Loading alerts"]} />
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <BellRing className="h-5 w-5 text-primary" />
                  Agent Council
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                {(outputs ?? []).slice(0, 3).map((output) => (
                  <div key={output.id} className="rounded-lg border border-border/60 bg-background/35 p-3 text-sm text-slate-200">
                    <div className="font-medium text-white">{agentTitle(output.agent)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{output.title}</div>
                    <div className="mt-2">{output.summary}</div>
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

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="mt-1 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="mt-1 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-2 text-sm text-slate-200">
        {items.slice(0, 4).map((item) => (
          <div key={item} className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function agentTitle(agent: AgentOutput["agent"]) {
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}
