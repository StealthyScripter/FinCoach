import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useBrokerReadiness, useComplianceAudit, useComplianceProfile, useLiveAssistancePolicy, useMarketEvents, useMarketPilotOverview, usePredictionInsights, useRiskSettings, type BrokerReadiness, type ComplianceAuditSummary, type ComplianceProfile, type LiveAssistancePolicy, type OrderPreview } from "@/lib/marketpilot";
import { buildMemoryActionChecklist, buildPredictionLessonCue } from "@shared/assistantPresentation";
import type { ComplianceAcknowledgementSubmission, JournalReviewResult, JournalReviewSubmission, PaperTradeCloseRequest, PaperTradeCloseResult, RiskSettingsUpdate, TradeTicketProposal } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, FileCheck2, History, KeyRound, Lock, Plus, ReceiptText, ShieldCheck, SlidersHorizontal, Smartphone, XCircle } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

const initialProposal: TradeTicketProposal = {
  asset: "VTI",
  direction: "buy",
  quantity: 5,
  entryPrice: 260,
  stopLoss: 247,
  timeHorizon: "4 weeks",
  rationale:
    "Paper-only broad market rebalance idea intended to test the risk engine and journal workflow before any real execution is available.",
  supportingEvidence: ["Diversified ETF exposure", "No leverage", "Paper trading only"],
  alternativeChoices: ["Hold cash", "Reduce size"],
  exitCriteria: "Exit the paper trade if the thesis breaks or portfolio risk exceeds the configured limit.",
  invalidationCondition: "Do not proceed if market data verification or risk approval fails.",
};

const initialJournalReview: JournalReviewSubmission = {
  journalEntryId: "journal-rate-shock",
  reflection:
    "I followed the risk plan, identified the oversized allocation change, and wrote a rule to prevent repeating that mistake.",
  followedPlan: true,
  respectedStop: true,
  positionSizingDiscipline: 82,
  emotionalState: "calm",
  lessonsLearned: ["Set maximum allocation change before acting", "Check event calendar before rebalancing"],
};

export default function TradeDesk() {
  const { data, isLoading, error } = useMarketPilotOverview();
  const { data: events } = useMarketEvents();
  const { data: brokerReadiness } = useBrokerReadiness();
  const { data: livePolicy } = useLiveAssistancePolicy();
  const { data: riskSettings } = useRiskSettings();
  const { data: complianceProfile } = useComplianceProfile();
  const { data: insights } = usePredictionInsights();
  const lessonCue = buildPredictionLessonCue(insights?.topThemes[0], insights?.recentRules[0]);
  const lessonChecklist = buildMemoryActionChecklist(lessonCue);
  const auditTarget = data?.tradeTickets.find((ticket) => ticket.status === "paper_filled")?.id ?? data?.tradeTickets[0]?.id;
  const complianceAudit = useComplianceAudit(auditTarget);
  const [proposal, setProposal] = useState<TradeTicketProposal>(initialProposal);
  const [evidenceText, setEvidenceText] = useState(initialProposal.supportingEvidence.join("\n"));
  const [alternativesText, setAlternativesText] = useState(initialProposal.alternativeChoices.join("\n"));
  const [orderPreviews, setOrderPreviews] = useState<Record<string, OrderPreview>>({});
  const [journalReview, setJournalReview] = useState<JournalReviewSubmission>(initialJournalReview);
  const [lessonsText, setLessonsText] = useState(initialJournalReview.lessonsLearned.join("\n"));
  const [riskDraft, setRiskDraft] = useState<RiskSettingsUpdate>({});
  const [closeDrafts, setCloseDrafts] = useState<Record<string, PaperTradeCloseRequest>>({});

  useEffect(() => {
    if (riskSettings) {
      setRiskDraft({
        maxRiskPerTradePct: riskSettings.maxRiskPerTradePct,
        reduceSizeAbovePct: riskSettings.reduceSizeAbovePct,
        maxDailyLossPct: riskSettings.maxDailyLossPct,
        maxWeeklyLossPct: riskSettings.maxWeeklyLossPct,
        maxSinglePositionPct: riskSettings.maxSinglePositionPct,
        maxOptionsPremiumPct: riskSettings.maxOptionsPremiumPct,
        noTradeBeforeHighImpactEventHours: riskSettings.noTradeBeforeHighImpactEventHours,
      });
    }
  }, [riskSettings]);

  const createTicket = useMutation({
    mutationFn: async (nextProposal: TradeTicketProposal) => {
      const response = await apiRequest("POST", "/api/marketpilot/trade-tickets", nextProposal);
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/overview"] });
    },
  });

  const fillPaperTrade = useMutation({
    mutationFn: async ({ ticketId, previewId }: { ticketId: string; previewId: string }) => {
      const response = await apiRequest("POST", `/api/marketpilot/trade-tickets/${ticketId}/paper-fill`, {
        complianceAcknowledged: true,
        userConfirmation: "I acknowledge this is a paper fill and not investment advice.",
        previewId,
      });
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/overview"] });
    },
  });

  const closePaperTrade = useMutation({
    mutationFn: async ({ ticketId, closeRequest }: { ticketId: string; closeRequest: PaperTradeCloseRequest }) => {
      const response = await apiRequest("POST", `/api/marketpilot/trade-tickets/${ticketId}/paper-close`, closeRequest);
      return response.json() as Promise<PaperTradeCloseResult>;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/overview"] });
    },
  });

  const createOrderPreview = useMutation({
    mutationFn: async (ticketId: string) => {
      const response = await apiRequest("POST", `/api/marketpilot/trade-tickets/${ticketId}/order-preview`);
      return response.json() as Promise<OrderPreview>;
    },
    onSuccess: (preview) => {
      setOrderPreviews((current) => ({ ...current, [preview.tradeTicketId]: preview }));
    },
  });

  const reviewJournal = useMutation({
    mutationFn: async (submission: JournalReviewSubmission) => {
      const response = await apiRequest("POST", "/api/marketpilot/journal/reviews", submission);
      return response.json() as Promise<JournalReviewResult>;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/overview"] });
    },
  });

  const updateRiskSettings = useMutation({
    mutationFn: async (settings: RiskSettingsUpdate) => {
      const response = await apiRequest("PATCH", "/api/marketpilot/risk/settings", settings);
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/overview"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/risk/settings"] }),
      ]);
    },
  });

  const acknowledgeCompliance = useMutation({
    mutationFn: async (submission: ComplianceAcknowledgementSubmission) => {
      const response = await apiRequest("POST", "/api/marketpilot/compliance/acknowledgement", submission);
      return response.json() as Promise<ComplianceProfile>;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/compliance/profile"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/live/policy"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/overview"] }),
      ]);
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createTicket.mutate({
      ...proposal,
      supportingEvidence: evidenceText.split("\n").map((item) => item.trim()).filter(Boolean),
      alternativeChoices: alternativesText.split("\n").map((item) => item.trim()).filter(Boolean),
    });
  };

  const handleJournalReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    reviewJournal.mutate({
      ...journalReview,
      lessonsLearned: lessonsText.split("\n").map((item) => item.trim()).filter(Boolean),
    });
  };

  const handleRiskSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateRiskSettings.mutate(riskDraft);
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="text-muted-foreground">Loading trade controls...</div>
      </Layout>
    );
  }

  if (error || !data) {
    return (
      <Layout>
        <div className="text-rose-300">Unable to load trade desk.</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col gap-3 border-b border-border/50 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30" variant="outline">
                Paper trading enabled
              </Badge>
              <Badge className="bg-rose-500/10 text-rose-300 border-rose-500/30" variant="outline">
                Live execution locked
              </Badge>
            </div>
            <h1 className="mt-3 text-3xl font-bold text-white">Trade Desk</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Trade ideas must pass verification, portfolio impact review, and risk officer checks before they can become paper orders.
            </p>
          </div>
          <Button disabled className="gap-2">
            <Lock className="h-4 w-4" />
            Live broker disabled
          </Button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
          <div className="space-y-5">
            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <ReceiptText className="h-5 w-5 text-primary" />
                  Learning Guardrails
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-200">
                {lessonCue && (
                  <div className="rounded-lg border border-primary/30 bg-background/35 p-3">
                    <div className="text-xs uppercase tracking-wide text-primary">Memory reuse</div>
                    <p className="mt-2">{lessonCue.cue}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {lessonCue.theme} · {lessonCue.count} repeats · {lessonCue.source}
                    </p>
                  </div>
                )}
                {lessonChecklist.length > 0 && (
                  <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Pre-submit checklist</div>
                    <ul className="mt-2 space-y-2">
                      {lessonChecklist.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Top repeated lesson</div>
                  <p className="mt-1">
                    {insights?.topThemes[0]?.theme ?? "No repeated lessons recorded yet."}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Latest rule update</div>
                  <p className="mt-1">
                    {insights?.recentRules[0]?.futureRuleAdjustment ?? "No recent rule updates recorded yet."}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Review count</div>
                  <p className="mt-1">
                    {insights?.reviewCount ?? 0} prediction review{(insights?.reviewCount ?? 0) === 1 ? "" : "s"} recorded
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/30 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Plus className="h-5 w-5 text-primary" />
                  New Paper Ticket
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div className="grid gap-3 md:grid-cols-4">
                    <Field label="Asset">
                      <Input
                        value={proposal.asset}
                        onChange={(event) => setProposal({ ...proposal, asset: event.target.value })}
                      />
                    </Field>
                    <Field label="Direction">
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-white"
                        value={proposal.direction}
                        onChange={(event) => setProposal({ ...proposal, direction: event.target.value as TradeTicketProposal["direction"] })}
                      >
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                        <option value="short">Short</option>
                        <option value="cover">Cover</option>
                      </select>
                    </Field>
                    <Field label="Quantity">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={proposal.quantity}
                        onChange={(event) => setProposal({ ...proposal, quantity: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Entry price">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={proposal.entryPrice}
                        onChange={(event) => setProposal({ ...proposal, entryPrice: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Stop loss">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={proposal.stopLoss ?? ""}
                        onChange={(event) => setProposal({ ...proposal, stopLoss: Number(event.target.value) || undefined })}
                      />
                    </Field>
                    <Field label="Take profit">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={proposal.takeProfit ?? ""}
                        onChange={(event) => setProposal({ ...proposal, takeProfit: Number(event.target.value) || undefined })}
                      />
                    </Field>
                    <Field label="Time horizon">
                      <Input
                        value={proposal.timeHorizon}
                        onChange={(event) => setProposal({ ...proposal, timeHorizon: event.target.value })}
                      />
                    </Field>
                  </div>

                  <Field label="Rationale">
                    <Textarea
                      value={proposal.rationale}
                      onChange={(event) => setProposal({ ...proposal, rationale: event.target.value })}
                    />
                  </Field>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Supporting evidence">
                      <Textarea value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} />
                    </Field>
                    <Field label="Alternatives">
                      <Textarea value={alternativesText} onChange={(event) => setAlternativesText(event.target.value)} />
                    </Field>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Exit criteria">
                      <Textarea
                        value={proposal.exitCriteria}
                        onChange={(event) => setProposal({ ...proposal, exitCriteria: event.target.value })}
                      />
                    </Field>
                    <Field label="Invalidation condition">
                      <Textarea
                        value={proposal.invalidationCondition}
                        onChange={(event) => setProposal({ ...proposal, invalidationCondition: event.target.value })}
                      />
                    </Field>
                  </div>

                  {createTicket.error && (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                      {(createTicket.error as Error).message}
                    </div>
                  )}

                  <Button type="submit" className="gap-2" disabled={createTicket.isPending}>
                    <ShieldCheck className="h-4 w-4" />
                    {createTicket.isPending ? "Checking risk..." : "Submit to Risk Officer"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {data.tradeTickets.map((ticket) => {
              const isApproved = ticket.riskCheck.decision === "approve";
              const preview = orderPreviews[ticket.id];
              const closeDraft = closeDrafts[ticket.id] ?? {
                exitPrice: ticket.takeProfit ?? Number((ticket.entryPrice * 1.01).toFixed(2)),
                exitReason: "Closed after reviewing the paper exit plan and portfolio risk.",
                followedExitCriteria: true,
                lessonsLearned: ["Review planned exit before fill", "Record why the close happened"],
              };
              return (
                <Card key={ticket.id} className="border-border/50 bg-card/70">
                  <CardHeader className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-xl text-white">
                          {ticket.direction.toUpperCase()} {ticket.asset}
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">{ticket.timeHorizon}</p>
                      </div>
                      <Badge variant="outline" className={isApproved ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}>
                        {ticket.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-sm leading-6 text-slate-300">{ticket.rationale}</p>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-4">
                      <Metric label="Quantity" value={String(ticket.quantity)} />
                      <Metric label="Entry" value={`$${ticket.entryPrice.toFixed(2)}`} />
                      <Metric label="Risk" value={`$${ticket.riskAmount.toFixed(2)}`} />
                      <Metric label="Confidence" value={`${ticket.confidence}%`} />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-border/60 bg-background/35 p-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                          <FileCheck2 className="h-4 w-4 text-sky-300" />
                          Verification
                        </div>
                        <p className="text-sm text-muted-foreground">{ticket.verification.evidenceSummary}</p>
                        <div className="mt-3">
                          <Progress value={ticket.verification.confidence} className="h-1.5" />
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-background/35 p-4">
                        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                          {isApproved ? <ShieldCheck className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />}
                          Risk Officer
                        </div>
                        <p className="text-sm text-muted-foreground">{ticket.riskCheck.reasons.join(" ")}</p>
                        <div className="mt-3">
                          <Progress value={ticket.riskCheck.score} className="h-1.5" />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="grid gap-4 md:grid-cols-2">
                      <ListBlock title="Required actions" items={ticket.riskCheck.requiredActions} />
                      <ListBlock title="Invalidation" items={[ticket.invalidationCondition]} />
                    </div>

                    {ticket.status === "proposed" && ticket.riskCheck.decision === "approve" && (
                      <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-sm font-semibold text-emerald-200">Risk-approved for paper preview</div>
                        <p className="text-xs text-emerald-100/80">
                              Generate a paper broker preview before any simulated fill. Behavioral cooling-off or event risk will block this path.
                        </p>
                          </div>
                          <Button
                            variant="outline"
                            className="gap-2 border-emerald-500/40 text-emerald-100"
                            disabled={createOrderPreview.isPending}
                            onClick={() => createOrderPreview.mutate(ticket.id)}
                          >
                            <ReceiptText className="h-4 w-4" />
                            {createOrderPreview.isPending ? "Previewing..." : "Order Preview"}
                          </Button>
                        </div>

                        {preview && (
                          <div className="rounded-lg border border-emerald-500/30 bg-background/35 p-3">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-white">Paper Broker Preview</div>
                              <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                                {preview.environment.replace("_", " ")}
                              </Badge>
                            </div>
                            <div className="grid gap-3 md:grid-cols-4">
                              <Metric label="Notional" value={`$${preview.estimatedNotional.toLocaleString()}`} />
                              <Metric label="Fees" value={`$${preview.estimatedFees.toFixed(2)}`} />
                              <Metric label="Slippage" value={`$${preview.estimatedSlippage.toFixed(2)}`} />
                              <Metric label="Total cost" value={`$${preview.estimatedTotalCost.toLocaleString()}`} />
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              <ListBlock title="Approval steps" items={preview.approvalSteps} />
                              <ListBlock title="Warnings" items={preview.warnings} />
                            </div>
                            <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                              <div className="text-xs text-emerald-100/80">
                                Liquidity check: {preview.liquidityCheck}. Compliance acknowledgement required: {preview.complianceAcknowledgementRequired ? "yes" : "no"}.
                              </div>
                              <Button
                                className="bg-emerald-600 hover:bg-emerald-700"
                                disabled={fillPaperTrade.isPending || preview.liveExecutionBlocked !== true}
                                onClick={() => fillPaperTrade.mutate({ ticketId: ticket.id, previewId: preview.id })}
                              >
                                {fillPaperTrade.isPending ? "Filling..." : "Final Paper Fill"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {ticket.status === "paper_filled" && (
                      <div className="space-y-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-sky-100">Paper monitoring active</div>
                            <p className="text-xs text-sky-100/80">
                              Close only after checking the exit criteria, invalidation condition, and paper journal plan.
                            </p>
                          </div>
                          <Badge variant="outline" className="border-sky-500/40 text-sky-300">
                            monitored
                          </Badge>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Field label="Exit price">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={closeDraft.exitPrice}
                              onChange={(event) => setCloseDrafts({
                                ...closeDrafts,
                                [ticket.id]: { ...closeDraft, exitPrice: Number(event.target.value) },
                              })}
                            />
                          </Field>
                          <label className="flex items-center gap-2 rounded-md bg-background/30 px-3 py-2 text-sm text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={closeDraft.followedExitCriteria}
                              onChange={(event) => setCloseDrafts({
                                ...closeDrafts,
                                [ticket.id]: { ...closeDraft, followedExitCriteria: event.target.checked },
                              })}
                            />
                            Followed exit criteria
                          </label>
                        </div>
                        <Field label="Exit reason">
                          <Textarea
                            value={closeDraft.exitReason}
                            onChange={(event) => setCloseDrafts({
                              ...closeDrafts,
                              [ticket.id]: { ...closeDraft, exitReason: event.target.value },
                            })}
                          />
                        </Field>
                        <Field label="Lessons learned">
                          <Textarea
                            value={closeDraft.lessonsLearned.join("\n")}
                            onChange={(event) => setCloseDrafts({
                              ...closeDrafts,
                              [ticket.id]: {
                                ...closeDraft,
                                lessonsLearned: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean),
                              },
                            })}
                          />
                        </Field>
                        <Button
                          variant="outline"
                          className="border-sky-500/40 text-sky-100"
                          disabled={closePaperTrade.isPending}
                          onClick={() => closePaperTrade.mutate({ ticketId: ticket.id, closeRequest: closeDraft })}
                        >
                          {closePaperTrade.isPending ? "Closing..." : "Close Paper Trade"}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="space-y-5">
            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <KeyRound className="h-5 w-5 text-sky-300" />
                  Broker Readiness
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(brokerReadiness ?? []).map((broker) => (
                  <BrokerReadinessPanel key={broker.broker} readiness={broker} />
                ))}
                {!brokerReadiness?.length && (
                  <div className="rounded-lg border border-border/60 bg-background/35 p-3 text-sm text-muted-foreground">
                    Loading broker readiness controls...
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <FileCheck2 className="h-5 w-5 text-emerald-300" />
                  Compliance Evidence
                </CardTitle>
              </CardHeader>
              <CardContent>
                {complianceAudit.data ? (
                  <ComplianceAuditPanel audit={complianceAudit.data} />
                ) : (
                  <div className="rounded-lg border border-border/60 bg-background/35 p-3 text-sm text-muted-foreground">
                    Loading audit evidence...
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <ShieldCheck className="h-5 w-5 text-emerald-300" />
                  Compliance Disclosures
                </CardTitle>
              </CardHeader>
              <CardContent>
                {complianceProfile ? (
                  <ComplianceProfilePanel
                    profile={complianceProfile}
                    isPending={acknowledgeCompliance.isPending}
                    error={acknowledgeCompliance.error}
                    onAcknowledge={() => acknowledgeCompliance.mutate({
                      accepted: true,
                      disclosureVersion: complianceProfile.disclosureVersion,
                      userConfirmation: "I acknowledge MarketPilot disclosures and remain responsible for all decisions.",
                    })}
                  />
                ) : (
                  <div className="rounded-lg border border-border/60 bg-background/35 p-3 text-sm text-muted-foreground">
                    Loading disclosure status...
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Lock className="h-5 w-5 text-rose-300" />
                  Supervised Live Policy
                </CardTitle>
              </CardHeader>
              <CardContent>
                {livePolicy ? (
                  <LivePolicyPanel policy={livePolicy} />
                ) : (
                  <div className="rounded-lg border border-border/60 bg-background/35 p-3 text-sm text-muted-foreground">
                    Loading live policy...
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <SlidersHorizontal className="h-5 w-5 text-primary" />
                  Configurable Risk Limits
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={handleRiskSettings}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Reduce above %">
                      <Input
                        type="number"
                        min="0.01"
                        max="5"
                        step="0.01"
                        value={riskDraft.reduceSizeAbovePct ?? ""}
                        onChange={(event) => setRiskDraft({ ...riskDraft, reduceSizeAbovePct: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Reject above %">
                      <Input
                        type="number"
                        min="0.01"
                        max="5"
                        step="0.01"
                        value={riskDraft.maxRiskPerTradePct ?? ""}
                        onChange={(event) => setRiskDraft({ ...riskDraft, maxRiskPerTradePct: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Daily loss %">
                      <Input
                        type="number"
                        min="0.01"
                        max="20"
                        step="0.01"
                        value={riskDraft.maxDailyLossPct ?? ""}
                        onChange={(event) => setRiskDraft({ ...riskDraft, maxDailyLossPct: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Weekly loss %">
                      <Input
                        type="number"
                        min="0.01"
                        max="30"
                        step="0.01"
                        value={riskDraft.maxWeeklyLossPct ?? ""}
                        onChange={(event) => setRiskDraft({ ...riskDraft, maxWeeklyLossPct: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Single position %">
                      <Input
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.01"
                        value={riskDraft.maxSinglePositionPct ?? ""}
                        onChange={(event) => setRiskDraft({ ...riskDraft, maxSinglePositionPct: Number(event.target.value) })}
                      />
                    </Field>
                    <Field label="Event window hours">
                      <Input
                        type="number"
                        min="1"
                        max="168"
                        step="1"
                        value={riskDraft.noTradeBeforeHighImpactEventHours ?? ""}
                        onChange={(event) => setRiskDraft({ ...riskDraft, noTradeBeforeHighImpactEventHours: Number(event.target.value) })}
                      />
                    </Field>
                  </div>
                  {updateRiskSettings.error && (
                    <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                      {(updateRiskSettings.error as Error).message}
                    </div>
                  )}
                  <Button type="submit" variant="outline" disabled={updateRiskSettings.isPending}>
                    {updateRiskSettings.isPending ? "Saving..." : "Save Risk Limits"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <ShieldCheck className="h-5 w-5 text-emerald-300" />
                  Active Risk Rules
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.riskRules.map((rule) => (
                  <div key={rule.id} className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-white">{rule.label}</div>
                      {rule.status === "active" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <XCircle className="h-4 w-4 text-amber-300" />
                      )}
                    </div>
                    <div className="mt-1 text-xs font-mono text-primary">{rule.limit}</div>
                    <p className="mt-2 text-xs text-muted-foreground">{rule.description}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <CalendarClock className="h-5 w-5 text-amber-300" />
                  Event Risk Calendar
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(events ?? []).slice(0, 4).map((event) => (
                  <div key={event.id} className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-white">{event.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {new Date(event.startsAt).toLocaleString()} / {event.category.replace("_", " ")}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={event.impact === "high" ? "border-rose-500/40 text-rose-300" : "border-amber-500/40 text-amber-300"}
                      >
                        {event.impact}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{event.riskNote}</p>
                    <div className="mt-2 text-[10px] uppercase tracking-wide text-primary">
                      {event.relatedAssets.slice(0, 6).join(" / ")}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="text-white">Paper Portfolio</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Metric label="Total value" value={`$${data.portfolio.totalValue.toLocaleString()}`} />
                <Metric label="Cash" value={`$${data.portfolio.cash.toLocaleString()}`} />
                <Metric label="Max drawdown" value={`${data.portfolio.maxDrawdownPct}%`} />
                <Metric label="Risk score" value={`${data.portfolio.riskScore}/100`} />
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <History className="h-5 w-5 text-sky-300" />
                  Audit Trail
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.auditLogs.slice(0, 5).map((event) => (
                  <div key={event.id} className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="text-sm font-medium text-white">{event.action.replaceAll("_", " ")}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {event.actor} / {event.target}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card/70">
              <CardHeader>
                <CardTitle className="text-white">Journal</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {data.journalEntries.length > 0 && (
                  <form className="space-y-3 rounded-lg border border-border/60 bg-background/35 p-3" onSubmit={handleJournalReview}>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Field label="Entry">
                        <select
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-white"
                          value={journalReview.journalEntryId}
                          onChange={(event) => setJournalReview({ ...journalReview, journalEntryId: event.target.value })}
                        >
                          {data.journalEntries.map((entry) => (
                            <option key={entry.id} value={entry.id}>{entry.title}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Emotional state">
                        <select
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-white"
                          value={journalReview.emotionalState}
                          onChange={(event) => setJournalReview({ ...journalReview, emotionalState: event.target.value as JournalReviewSubmission["emotionalState"] })}
                        >
                          <option value="calm">Calm</option>
                          <option value="anxious">Anxious</option>
                          <option value="impulsive">Impulsive</option>
                          <option value="revenge">Revenge</option>
                          <option value="overconfident">Overconfident</option>
                        </select>
                      </Field>
                    </div>
                    <Field label="Reflection">
                      <Textarea
                        value={journalReview.reflection}
                        onChange={(event) => setJournalReview({ ...journalReview, reflection: event.target.value })}
                      />
                    </Field>
                    <Field label="Lessons learned">
                      <Textarea value={lessonsText} onChange={(event) => setLessonsText(event.target.value)} />
                    </Field>
                    <div className="grid gap-2 md:grid-cols-3">
                      <label className="flex items-center gap-2 rounded-md bg-background/30 px-3 py-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={journalReview.followedPlan}
                          onChange={(event) => setJournalReview({ ...journalReview, followedPlan: event.target.checked })}
                        />
                        Followed plan
                      </label>
                      <label className="flex items-center gap-2 rounded-md bg-background/30 px-3 py-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={journalReview.respectedStop}
                          onChange={(event) => setJournalReview({ ...journalReview, respectedStop: event.target.checked })}
                        />
                        Respected stop
                      </label>
                      <Field label="Sizing">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={journalReview.positionSizingDiscipline}
                          onChange={(event) => setJournalReview({ ...journalReview, positionSizingDiscipline: Number(event.target.value) })}
                        />
                      </Field>
                    </div>
                    <Button type="submit" variant="outline" disabled={reviewJournal.isPending}>
                      {reviewJournal.isPending ? "Reviewing..." : "Review Journal"}
                    </Button>
                    {reviewJournal.data && (
                      <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                        Journal quality {reviewJournal.data.review.qualityScore}/100. Trading psychology {reviewJournal.data.previousScore}{" -> "}{reviewJournal.data.updatedScore.score}.
                      </div>
                    )}
                  </form>
                )}
                {data.journalEntries.slice(0, 4).map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border/60 bg-background/35 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-white">{entry.title}</div>
                      <Badge variant="outline" className="border-primary/30 text-primary">
                        {entry.qualityScore}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{entry.notes}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function ComplianceProfilePanel({
  profile,
  isPending,
  error,
  onAcknowledge,
}: {
  profile: ComplianceProfile;
  isPending: boolean;
  error: unknown;
  onAcknowledge: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/60 bg-background/35 p-3">
        <div>
          <div className="font-medium text-white">
            {profile.disclosuresAccepted ? "Disclosures acknowledged" : "Acknowledgement required"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Version {profile.disclosureVersion} / {profile.acceptedAt ? new Date(profile.acceptedAt).toLocaleString() : "not yet accepted"}
          </div>
        </div>
        <Badge
          variant="outline"
          className={profile.disclosuresAccepted ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}
        >
          {profile.disclosuresAccepted ? "accepted" : "blocked"}
        </Badge>
      </div>

      <ul className="space-y-2">
        {profile.requiredDisclosures.map((disclosure) => (
          <li key={disclosure} className="flex gap-2 rounded-md bg-background/30 px-3 py-2 text-sm text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span>{disclosure}</span>
          </li>
        ))}
      </ul>

      {profile.userConfirmation && (
        <div className="rounded-md border border-border/60 bg-background/35 p-3 text-xs text-muted-foreground">
          {profile.userConfirmation}
        </div>
      )}

      {Boolean(error) && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          {(error as Error).message}
        </div>
      )}

      <Button
        variant="outline"
        className="gap-2"
        disabled={profile.disclosuresAccepted || isPending}
        onClick={onAcknowledge}
      >
        <FileCheck2 className="h-4 w-4" />
        {isPending ? "Acknowledging..." : "Acknowledge Disclosures"}
      </Button>
    </div>
  );
}

function ComplianceAuditPanel({ audit }: { audit: ComplianceAuditSummary }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/60 bg-background/35 p-3">
        <div>
          <div className="font-medium text-white">
            {audit.target ? `Ticket ${audit.target.slice(0, 8)}` : "All audit events"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {audit.eventCount} events / digest {audit.latestDigest ? audit.latestDigest.slice(0, 10) : "none"}
          </div>
        </div>
        <Badge
          variant="outline"
          className={audit.completePaperFillChain ? "border-emerald-500/40 text-emerald-300" : "border-amber-500/40 text-amber-300"}
        >
          {audit.completePaperFillChain ? "complete chain" : "incomplete"}
        </Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {Object.entries(audit.evidence).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2 rounded-md bg-background/30 px-3 py-2 text-sm text-muted-foreground">
            {value ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <XCircle className="h-4 w-4 text-amber-300" />}
            {key.replace(/([A-Z])/g, " $1").toLowerCase()}
          </div>
        ))}
      </div>

      {audit.missingEvidence.length > 0 && (
        <ListBlock title="Missing evidence" items={audit.missingEvidence} />
      )}

      <div className="space-y-2">
        {audit.events.slice(0, 4).map((event) => (
          <div key={event.id} className="rounded-md bg-background/30 px-3 py-2">
            <div className="text-sm font-medium text-white">{event.sequence}. {event.action.replaceAll("_", " ")}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {event.actor} / {new Date(event.createdAt).toLocaleString()} / {event.digest.slice(0, 12)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LivePolicyPanel({ policy }: { policy: LiveAssistancePolicy }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/60 bg-background/35 p-3">
        <div>
          <div className="font-medium text-white">{policy.status.replaceAll("_", " ")}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Live preview: {policy.canRequestLivePreview ? "available" : "blocked"} / live order: {policy.canPlaceLiveOrder ? "available" : "blocked"}
          </div>
        </div>
        <Badge variant="outline" className="border-rose-500/40 text-rose-300">
          Risk veto {policy.riskOfficerVeto ? "on" : "off"}
        </Badge>
      </div>

      <ListBlock title="Required actions" items={policy.requiredActions.slice(0, 5)} />
      <ListBlock title="Prohibited live capabilities" items={policy.prohibitedCapabilities.slice(0, 4)} />
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-amber-200">Compliance notices</div>
        <ul className="mt-2 space-y-1 text-xs text-amber-100/80">
          {policy.complianceNotices.slice(0, 3).map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function BrokerReadinessPanel({ readiness }: { readiness: BrokerReadiness }) {
  const isPaperBroker = readiness.broker === "paper_broker";
  const failedChecks = readiness.checks.filter((check) => check.status === "fail").length;

  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium text-white">
            {isPaperBroker ? "MarketPilot Paper Broker" : "Interactive Brokers"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {readiness.connectionStatus.replaceAll("_", " ")} / session timeout {readiness.sessionTimeoutMinutes}m
          </div>
        </div>
        <Badge
          variant="outline"
          className={readiness.connectionStatus === "paper_ready" || readiness.liveExecutionAllowed
            ? "border-emerald-500/40 text-emerald-300"
            : "border-rose-500/40 text-rose-300"}
        >
          {readiness.liveExecutionAllowed ? "read-only ready" : isPaperBroker ? "paper ready" : "live blocked"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        <div className="flex items-center gap-2 rounded-md bg-background/35 px-2 py-2">
          <KeyRound className="h-3.5 w-3.5 text-primary" />
          Vault: {readiness.vault.provider.replaceAll("_", " ")}
        </div>
        <div className="flex items-center gap-2 rounded-md bg-background/35 px-2 py-2">
          <Smartphone className="h-3.5 w-3.5 text-primary" />
          MFA/device: {readiness.mfaRequired || readiness.deviceVerificationRequired ? "required" : "not required"}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {readiness.checks.slice(0, isPaperBroker ? 3 : 6).map((check) => (
          <div key={check.id} className="flex items-start gap-2 rounded-md bg-background/30 px-3 py-2">
            {check.status === "pass" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            ) : check.status === "warning" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            )}
            <div>
              <div className="text-sm font-medium text-white">{check.label}</div>
              <p className="text-xs text-muted-foreground">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {!isPaperBroker && (
        <div className="mt-3 rounded-md border border-rose-500/25 bg-rose-500/10 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-rose-200">
            {failedChecks} blocking checks
          </div>
          <ul className="mt-2 space-y-1 text-xs text-rose-100/80">
            {readiness.requiredActions.slice(0, 4).map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/35 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>
      <ul className="space-y-2 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="rounded-md bg-background/30 px-3 py-2">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
