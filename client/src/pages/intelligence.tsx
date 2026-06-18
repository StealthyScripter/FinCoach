import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAgentOutputs, useAgentSupervisor, useAIResearchEvaluation, useAIStatus, useAlerts, useCacheHealth, useEvaluationReport, useEventLogSnapshot, useIngestionSnapshot, useInstitutionalAnalytics, useKnowledgeGraph, useMemoryHealth, useMetricsSnapshot, useProviderHealth, useRAGContext, useSecurityPosture, useStorageHealth, useTimeSeriesHealth, useVectorStoreHealth, useVerificationQuality } from "@/lib/marketpilot";
import type { AgentOutput, Alert, EvaluationReport, SecurityPostureReport, SupervisorReport, VerificationQualityReport } from "@shared/schema";
import { AlertTriangle, BellRing, BrainCircuit, CheckCircle2, ClipboardCheck, DatabaseZap, FileCheck2, ShieldAlert } from "lucide-react";

const agentLabels: Record<AgentOutput["agent"], string> = {
  macro: "Macro",
  equity: "Equity",
  etf: "ETF",
  options: "Options",
  forex: "Forex",
  commodities: "Commodities",
  bonds: "Bonds",
  portfolio: "Portfolio Manager",
  risk: "Risk Officer",
  verification: "Verification",
};

export default function Intelligence() {
  const { data: outputs, isLoading, error } = useAgentOutputs();
  const { data: supervisor } = useAgentSupervisor();
  const { data: alerts } = useAlerts();
  const { data: ingestion } = useIngestionSnapshot();
  const { data: evaluation } = useEvaluationReport();
  const { data: verificationQuality } = useVerificationQuality();
  const { data: securityPosture } = useSecurityPosture();
  const { data: storageHealth } = useStorageHealth();
  const { data: providerHealth } = useProviderHealth();
  const { data: metrics } = useMetricsSnapshot();
  const { data: events } = useEventLogSnapshot();
  const { data: memoryHealth } = useMemoryHealth();
  const { data: knowledgeGraph } = useKnowledgeGraph();
  const { data: analytics } = useInstitutionalAnalytics();
  const { data: aiStatus } = useAIStatus();
  const { data: ragContext } = useRAGContext();
  const { data: vectorHealth } = useVectorStoreHealth();
  const { data: cacheHealth } = useCacheHealth();
  const { data: timeSeriesHealth } = useTimeSeriesHealth();
  const { data: aiEvaluation } = useAIResearchEvaluation();
  const riskOfficer = outputs?.find((output) => output.agent === "risk");

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col gap-3 border-b border-border/50 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-primary/40 text-primary">
                Structured agents
              </Badge>
              <Badge variant="outline" className="border-rose-500/40 text-rose-300">
                Risk Officer can veto
              </Badge>
            </div>
            <h1 className="mt-3 text-3xl font-bold text-white">Intelligence Desk</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              MarketPilot agents produce structured observations, risks, citations, and confidence scores before ideas reach the Trade Desk.
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

        {(storageHealth || providerHealth || metrics || events || memoryHealth) && (
          <Card className="border-border/50 bg-card/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <DatabaseZap className="h-5 w-5 text-primary" />
                Operator Readiness
              </CardTitle>
              <CardDescription>
                Production-shaped health, provider, memory, event-log, and metrics signals for MarketPilot v1.0 foundations.
              </CardDescription>
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
                <Section
                  title="Storage checks"
                  items={storageHealth ? storageHealth.checks.map((check) => `${check.status}: ${check.detail}`) : ["Loading storage checks"]}
                />
                <Section
                  title="Provider readiness"
                  items={providerHealth ? providerHealth.providers.slice(0, 5).map((provider) => `${provider.name}: ${provider.status} (${provider.providerMode})`) : ["Loading providers"]}
                />
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
              <CardDescription>
                Cross-asset, factor, Monte Carlo, stress, options Greeks, regime, consensus, behavior, and proficiency graph signals.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-6">
                <Metric label="KG nodes" value={knowledgeGraph ? String(knowledgeGraph.nodes.length) : "loading"} />
                <Metric label="KG edges" value={knowledgeGraph ? String(knowledgeGraph.edges.length) : "loading"} />
                <Metric label="Regime" value={analytics ? analytics.regime.primaryRegime.replace("_", " ") : "loading"} />
                <Metric label="Consensus" value={analytics ? String(analytics.consensus.consensusScore) : "loading"} />
                <Metric label="Behavior" value={analytics ? String(analytics.behavior.behavioralScore) : "loading"} />
                <Metric label="Loss prob" value={analytics ? `${analytics.monteCarlo.probabilityOfLossPct}%` : "loading"} />
              </div>
              {analytics && (
                <div className="grid gap-4 lg:grid-cols-3">
                  <Section
                    title="Factor warnings"
                    items={analytics.factors.concentrationWarnings.length > 0 ? analytics.factors.concentrationWarnings : ["No factor concentration warning"]}
                    tone={analytics.factors.concentrationWarnings.length > 0 ? "risk" : "default"}
                  />
                  <Section
                    title="Stress tests"
                    items={[
                      `Worst scenario: ${analytics.stress.worstScenario}`,
                      ...analytics.stress.scenarios.slice(0, 3).map((scenario) => `${scenario.label}: ${scenario.estimatedLossPct}% / survival ${scenario.survivalScore}`),
                    ]}
                  />
                  <Section
                    title="Greeks and regime"
                    items={[
                      `Delta ${analytics.greeks.portfolioGreeks.delta}, theta ${analytics.greeks.portfolioGreeks.theta}, vega ${analytics.greeks.portfolioGreeks.vega}`,
                      `Regime confidence ${analytics.regime.confidence}%`,
                      ...analytics.consensus.disagreement.slice(0, 2),
                    ]}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {(aiStatus || ragContext || vectorHealth || cacheHealth || timeSeriesHealth || aiEvaluation) && (
          <Card className="border-border/50 bg-card/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <FileCheck2 className="h-5 w-5 text-sky-300" />
                AI Infrastructure
              </CardTitle>
              <CardDescription>
                Provider, RAG, vector, cache, time-series, ingestion-ready, and AI evaluation status with demo fallbacks.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-6">
                <Metric label="AI provider" value={aiStatus ? `${aiStatus.provider} / ${aiStatus.status}` : "loading"} />
                <Metric label="Tokens" value={aiStatus ? String(aiStatus.tokenUsage?.totalTokens ?? 0) : "loading"} />
                <Metric label="RAG chunks" value={ragContext ? String(ragContext.chunks?.length ?? 0) : "loading"} />
                <Metric label="Vector" value={vectorHealth ? `${vectorHealth.provider} / ${vectorHealth.status}` : "loading"} />
                <Metric label="Cache" value={cacheHealth ? `${cacheHealth.provider} / ${cacheHealth.status}` : "loading"} />
                <Metric label="Series" value={timeSeriesHealth ? `${timeSeriesHealth.provider} / ${timeSeriesHealth.status}` : "loading"} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <Section
                  title="AI safety"
                  items={aiStatus?.safety?.notes ?? ["Loading AI safety metadata"]}
                />
                <Section
                  title="RAG citations"
                  items={ragContext?.citations?.slice(0, 4).map((citation: any) => `${citation.source}: ${citation.label}`) ?? ["Loading retrieval context"]}
                />
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
              <CardDescription>
                Normalized demo market prices, event records, and news articles that support research and verification.
              </CardDescription>
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
                    {ingestion.marketPrices.map((price) => (
                      <div key={price.id} className="grid grid-cols-[1fr_auto] rounded-md border border-border/60 bg-background/35 px-3 py-2 text-sm">
                        <span className="text-slate-200">{price.symbol}</span>
                        <span className={price.changePct >= 0 ? "font-mono text-emerald-300" : "font-mono text-rose-300"}>
                          ${price.price.toFixed(2)} / {price.changePct >= 0 ? "+" : ""}{price.changePct.toFixed(2)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <Section
                  title="Freshness actions"
                  items={ingestion.freshness.staleItems.length > 0 ? ingestion.freshness.staleItems : ingestion.requiredActions}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Section
                  title="Upcoming events"
                  items={ingestion.economicEvents.slice(0, 3).map((event) => `${event.impact}: ${event.title}`)}
                />
                <Section
                  title="News sample"
                  items={ingestion.newsArticles.slice(0, 3).map((article) => `${article.source}: ${article.headline}`)}
                />
              </div>
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
              <div className="grid gap-2 md:grid-cols-7">
                {supervisor.workflow.map((step, index) => (
                  <div key={step} className="rounded-md border border-border/60 bg-background/35 p-2 text-center">
                    <div className="font-mono text-xs text-muted-foreground">{index + 1}</div>
                    <div className="mt-1 text-xs font-medium text-slate-100">{step.replace("_", " ")}</div>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <div className="space-y-3">
                  {supervisor.ticketReviews.slice(0, 3).map((review) => (
                    <div key={review.ticketId} className="rounded-lg border border-border/60 bg-background/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h2 className="font-semibold text-white">{review.asset}</h2>
                          <p className="text-xs text-muted-foreground">{review.ticketId} / {review.status}</p>
                        </div>
                        <Badge variant="outline" className={review.canRequestPaperPreview ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}>
                          {review.canRequestPaperPreview ? "paper preview ready" : "gated"}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {review.steps.map((step) => (
                          <div key={`${review.ticketId}-${step.id}`} className="rounded-md border border-border/50 bg-card/45 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-slate-100">{step.label}</span>
                              <Badge variant="outline" className={supervisorStepClass(step.status)}>
                                {step.status.replace("_", " ")}
                              </Badge>
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{step.gateOwner.replace("_", " ")}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-4">
                  <Section title="Blocked capabilities" items={supervisor.blockedCapabilities} tone="risk" />
                  <Section
                    title="Supervisor actions"
                    items={supervisor.requiredActions.length > 0 ? supervisor.requiredActions.slice(0, 6) : ["No immediate supervisor action"]}
                    tone={supervisor.requiredActions.length > 0 ? "risk" : "default"}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {evaluation && (
          <Card className="border-border/50 bg-card/70">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <ClipboardCheck className="h-5 w-5 text-emerald-300" />
                    Evaluation Benchmarks
                  </CardTitle>
                  <CardDescription>
                    Read-only benchmark suites measure research quality, risk controls, learning discipline, and agent reliability.
                  </CardDescription>
                </div>
                <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2 text-right">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{evaluation.benchmarkVersion}</div>
                  <div className="font-mono text-2xl font-bold text-white">{evaluation.overallScore}</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-4">
                {evaluation.suites.map((suite) => (
                  <div key={suite.id} className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">{suite.label}</div>
                      <Badge variant="outline" className={evaluationStatusClass(suite.status)}>
                        {suite.status}
                      </Badge>
                    </div>
                    <div className="mt-2 font-mono text-xl font-semibold text-white">{suite.score}</div>
                    <Progress value={suite.score} className="mt-2 h-1.5" />
                  </div>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {evaluation.suites.map((suite) => (
                  <div key={`${suite.id}-detail`} className="rounded-lg border border-border/60 bg-background/30 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="font-semibold text-white">{suite.label}</h2>
                        <p className="mt-1 text-xs text-muted-foreground">{suite.objective}</p>
                      </div>
                      <Badge variant="outline" className={evaluationStatusClass(suite.status)}>
                        {suite.score}
                      </Badge>
                    </div>
                    <div className="mt-4 space-y-3">
                      {suite.metrics.map((metric) => (
                        <div key={metric.id} className="rounded-md border border-border/50 bg-card/45 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium text-slate-100">{metric.label}</div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={evaluationStatusClass(metric.status)}>
                                {metric.status}
                              </Badge>
                              <span className="font-mono text-sm text-white">{metric.score}/{metric.target}</span>
                            </div>
                          </div>
                          <Progress value={metric.score} className="mt-2 h-1.5" />
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <Section title="Evidence" items={metric.evidence} />
                            <Section
                              title="Required actions"
                              items={metric.requiredActions.length > 0 ? metric.requiredActions : ["No immediate action"]}
                              tone={metric.requiredActions.length > 0 ? "risk" : "default"}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Section
                  title="Global actions"
                  items={evaluation.requiredActions.length > 0 ? evaluation.requiredActions : ["No global benchmark action"]}
                  tone={evaluation.requiredActions.length > 0 ? "risk" : "default"}
                />
                <Section title="Monitoring metrics" items={evaluation.monitoring.recommendedMetrics} />
                <Section title="Security notes" items={evaluation.security.notes} />
              </div>
            </CardContent>
          </Card>
        )}

        {verificationQuality && (
          <Card className="border-border/50 bg-card/70">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <FileCheck2 className="h-5 w-5 text-sky-300" />
                    Verification Quality
                  </CardTitle>
                  <CardDescription>
                    Source freshness, evidence weight, contradiction handling, and hallucination-risk controls across research and tickets.
                  </CardDescription>
                </div>
                <Badge variant="outline" className={verificationStatusClass(verificationQuality.status)}>
                  {verificationQuality.status.replace("_", " ")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <Metric label="Overall" value={String(verificationQuality.score)} />
                <Metric label="Freshness" value={String(verificationQuality.freshnessScore)} />
                <Metric label="Evidence" value={String(verificationQuality.evidenceWeightScore)} />
                <Metric label="Contradictions" value={String(verificationQuality.contradictionScore)} />
                <Metric label="Hallucination" value={String(verificationQuality.hallucinationRiskScore)} />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <Section title="Evidence" items={verificationQuality.evidence} />
                <Section
                  title="Required actions"
                  items={verificationQuality.requiredActions.length > 0 ? verificationQuality.requiredActions : ["No verification action required"]}
                  tone={verificationQuality.requiredActions.length > 0 ? "risk" : "default"}
                />
                <Section
                  title="Source coverage"
                  items={[
                    `${verificationQuality.sourceCoverage.totalSources} total source(s)`,
                    `${verificationQuality.sourceCoverage.highReliability} high reliability`,
                    `${verificationQuality.sourceCoverage.mediumReliability} medium reliability`,
                    `${verificationQuality.sourceCoverage.lowReliability} low reliability`,
                    `${verificationQuality.sourceCoverage.staleSources.length} stale source(s)`,
                  ]}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {securityPosture && (
          <Card className="border-border/50 bg-card/70">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <ShieldAlert className="h-5 w-5 text-rose-300" />
                    Security Posture
                  </CardTitle>
                  <CardDescription>
                    MFA, vault, RBAC, session, device, audit, rate-limit, and environment-separation readiness.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={securityStatusClass(securityPosture.status)}>
                    {securityPosture.status}
                  </Badge>
                  <div className="font-mono text-xl font-semibold text-white">{securityPosture.score}</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                {securityPosture.controls.map((control) => (
                  <div key={control.id} className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-slate-100">{control.label}</div>
                      <Badge variant="outline" className={securityStatusClass(control.status)}>
                        {control.status}
                      </Badge>
                    </div>
                    <div className="mt-2 space-y-1">
                      {control.evidence.slice(0, 2).map((item) => (
                        <p key={item} className="text-xs text-muted-foreground">{item}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <Section
                title="Security actions"
                items={securityPosture.requiredActions.length > 0 ? securityPosture.requiredActions : ["No security action required"]}
                tone={securityPosture.requiredActions.length > 0 ? "risk" : "default"}
              />
            </CardContent>
          </Card>
        )}

        {alerts && (
          <Card className="border-border/50 bg-card/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <BellRing className="h-5 w-5 text-amber-300" />
                Active Alert Rules
              </CardTitle>
              <CardDescription>
                Alerts are non-execution guardrails generated from event risk, proficiency gates, verification state, and portfolio risk.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 lg:grid-cols-2">
              {alerts.map((alert) => (
                <div key={alert.id} className={`rounded-lg border p-4 ${alertClass(alert.severity)}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={severityBadgeClass(alert.severity)}>
                          {alert.severity}
                        </Badge>
                        <Badge variant="secondary">
                          {alert.category.replace("_", " ")}
                        </Badge>
                      </div>
                      <h2 className="mt-2 font-semibold text-white">{alert.title}</h2>
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">{alert.status}</div>
                  </div>
                  <p className="mt-2 text-sm text-slate-200">{alert.message}</p>
                  <div className="mt-3 rounded-md bg-background/40 p-2 text-xs text-muted-foreground">
                    Trigger: {alert.trigger}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Section title="Required actions" items={alert.requiredActions} />
                    <Section title="Related assets" items={alert.relatedAssets.length > 0 ? alert.relatedAssets : ["None"]} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {outputs && (
          <div className="grid gap-5 lg:grid-cols-2">
            {outputs.map((output) => (
              <Card key={output.id} className={output.agent === "risk" ? "border-rose-500/30 bg-card/80" : "border-border/50 bg-card/70"}>
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <AgentIcon output={output} />
                      <Badge variant="outline" className="border-primary/30 text-primary">
                        {agentLabels[output.agent]}
                      </Badge>
                      <Badge variant="outline" className={statusClass(output.status)}>
                        {output.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="font-mono text-sm text-white">{output.confidence}%</div>
                  </div>
                  <div>
                    <CardTitle className="text-white">{output.title}</CardTitle>
                    <CardDescription>{output.summary}</CardDescription>
                  </div>
                  <Progress value={output.confidence} className="h-1.5" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Section title="Observations" items={output.observations} />
                  <div className="grid gap-4 md:grid-cols-2">
                    <Section title="Recommendations" items={output.recommendations} />
                    <Section title="Risks" items={output.risks} tone="risk" />
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <FileCheck2 className="h-3.5 w-3.5" />
                      Citations
                    </div>
                    <div className="space-y-2">
                      {output.citations.map((citation) => (
                        <div key={`${output.id}-${citation.name}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card/60 px-3 py-2 text-xs">
                          <span className="text-slate-200">{citation.name}</span>
                          <span className="font-mono text-muted-foreground">{citation.reliability} / {new Date(citation.timestamp).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function AgentIcon({ output }: { output: AgentOutput }) {
  if (output.agent === "risk") return <ShieldAlert className="h-5 w-5 text-rose-300" />;
  if (output.status === "clear") return <CheckCircle2 className="h-5 w-5 text-emerald-300" />;
  if (output.status === "blocked" || output.status === "action_required") {
    return <AlertTriangle className="h-5 w-5 text-amber-300" />;
  }
  return <BrainCircuit className="h-5 w-5 text-primary" />;
}

function Section({ title, items, tone = "default" }: { title: string; items: string[]; tone?: "default" | "risk" }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item}
            className={tone === "risk"
              ? "rounded-md border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-100"
              : "rounded-md border border-border/60 bg-background/40 p-2 text-xs text-slate-200"}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function statusClass(status: AgentOutput["status"]) {
  switch (status) {
    case "clear":
      return "border-emerald-500/40 text-emerald-300";
    case "watch":
      return "border-sky-500/40 text-sky-300";
    case "action_required":
      return "border-amber-500/40 text-amber-300";
    case "blocked":
      return "border-rose-500/40 text-rose-300";
  }
}

function alertClass(severity: Alert["severity"]) {
  switch (severity) {
    case "critical":
      return "border-rose-500/30 bg-rose-500/10";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10";
    case "info":
      return "border-sky-500/30 bg-sky-500/10";
  }
}

function severityBadgeClass(severity: Alert["severity"]) {
  switch (severity) {
    case "critical":
      return "border-rose-500/40 text-rose-300";
    case "warning":
      return "border-amber-500/40 text-amber-300";
    case "info":
      return "border-sky-500/40 text-sky-300";
  }
}

function evaluationStatusClass(status: EvaluationReport["status"]) {
  switch (status) {
    case "pass":
      return "border-emerald-500/40 text-emerald-300";
    case "watch":
      return "border-amber-500/40 text-amber-300";
    case "fail":
      return "border-rose-500/40 text-rose-300";
  }
}

function verificationStatusClass(status: VerificationQualityReport["status"]) {
  switch (status) {
    case "verified":
      return "border-emerald-500/40 text-emerald-300";
    case "partially_verified":
      return "border-sky-500/40 text-sky-300";
    case "conflicting":
      return "border-amber-500/40 text-amber-300";
    case "requires_review":
      return "border-rose-500/40 text-rose-300";
  }
}

function supervisorStepClass(status: SupervisorReport["ticketReviews"][number]["steps"][number]["status"]) {
  switch (status) {
    case "complete":
      return "border-emerald-500/40 text-emerald-300";
    case "pending":
      return "border-sky-500/40 text-sky-300";
    case "blocked":
      return "border-rose-500/40 text-rose-300";
    case "not_applicable":
      return "border-slate-500/40 text-slate-300";
  }
}

function securityStatusClass(status: SecurityPostureReport["status"]) {
  switch (status) {
    case "pass":
      return "border-emerald-500/40 text-emerald-300";
    case "warning":
      return "border-amber-500/40 text-amber-300";
    case "fail":
      return "border-rose-500/40 text-rose-300";
  }
}
