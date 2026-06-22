import Layout from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { usePredictionInsights } from "@/lib/marketpilot";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Ban, CircleDollarSign, Radio, ShieldCheck } from "lucide-react";
import { buildControlledLiveSequence } from "@shared/controlledLiveWorkflow";
import { buildMemoryActionChecklist, buildPredictionLessonCue } from "@shared/assistantPresentation";

type ExecutionStatus = {
  primary: {
    automationLevel: { level: number; name: string; description: string };
    killSwitchStatus: "armed" | "triggered";
    latestSignals: Array<{ id?: string; strategyId?: string; createdAt?: string; reviewStatus?: string }>;
    openPaperPositions: Array<{
      id: string;
      instrument: string;
      side: string;
      units: number;
      unrealizedPnL: number;
      stopLossStatus: string;
    }>;
    strategyValidationVerdicts: Array<{
      strategyId: string;
      instrument: string;
      score: number;
      verdict: string;
    }>;
    riskPrecheckStatus: { action: string; reasons: string[]; checkedAt: string };
    liveReadiness: {
      readinessVerdict: "blocked" | "sandbox_only" | "supervised_live_ready";
      missingRequirements: string[];
      activeRiskLimits: { maxDailyLoss: number; maxRiskPerTradePct: number };
      killSwitchState: "armed" | "triggered";
      nextRequiredAction: string;
    } | null;
  };
  controlledLiveWorkflow: {
    quizPassed: boolean;
    quizExpiresAt: string | null;
    permission: {
      userId: string;
      allowed: boolean;
      blocked: boolean;
      missingRequirements: string[];
      warnings: string[];
      requirements: Array<{ id: string; passed: boolean; requiredAction: string }>;
      issuedAt: string;
      expirationTimestamp: string;
      productionLiveSubmissionAllowed: false;
      explicitConfirmationRequired: true;
    } | null;
    previewCount: number;
    confirmationCount: number;
    latestPreview: ControlledLivePreview | null;
    latestConfirmation: ControlledLiveConfirmation | null;
    requiredConfirmationPhrase: string;
    productionLiveSubmissionAllowed: false;
  };
  advanced: {
    strategyValidation: unknown[];
    brokerReadiness: { readyForPaper?: boolean; blockingReasons?: string[] };
    auditLog: unknown[];
    circuitBreakers: { killSwitchActive: boolean };
    liveReadinessDetails: Record<string, {
      ready: boolean;
      checks: Array<{ id: string; passed: boolean; requiredAction: string }>;
      missingRequirements: string[];
    }> | null;
  };
};

type SandboxPanel = {
  primary: {
    connectionStatus: "healthy" | "degraded" | "disconnected";
    accountMode: "practice" | "demo";
    equity: number;
    marginAvailable: number;
    openSandboxPositions: Array<{
      id: string;
      instrument: string;
      side: string;
      units: number;
      unrealizedPnL: number;
    }>;
    latestSandboxOrderStatus: {
      orderId: string;
      status: string;
      reason: string | null;
      requestedUnits: number | null;
      filledUnits: number | null;
      remainingUnits: number | null;
    } | null;
    emergencyControls: { killSwitchActive: boolean; disconnectAvailable: boolean };
  };
  advanced: {
    provider: "oanda_practice" | "metatrader_demo" | null;
    accountId: string | null;
    providerHealthReason: string | null;
    latestReconciliation: { id: string; status: "matched" | "discrepancy"; discrepancyCount: number; reconciledAt: string } | null;
  };
  safety: { productionOrderSubmissionEnabled: false; sandboxOnly: true };
};

type StrategyOpsDashboard = {
  primary: {
    activePaperStrategies: Array<{ strategyId: string; name: string; running: boolean; openPositions: number }>;
    todaysSignals: Array<{ id?: string; strategyId?: string; symbol?: string; status?: string; createdAt?: string }>;
    openPositions: Array<{ id: string; strategyId: string; symbol: string; side: string; unrealizedPnL: number }>;
    pnlSummary: { unrealized: number; realized: number; wins: number; losses: number };
    riskStatus: { killSwitchActive: boolean; dailyLoss: number; maxDailyLoss: number; status: "operational" | "blocked" };
  };
  advanced: {
    priceFeeds: Array<{ symbol: string; bid: number; ask: number; freshness: string; provider: string }>;
    strategyOps: unknown[];
    paperRuntime: unknown[];
    postTradeReviews: Array<{ id: string; strategyId: string; symbol: string; result: string; updatedLesson: string }>;
    adaptationSuggestions: Array<{ id: string; type: string; status: string; reason: string }>;
    strategyLifecycleReports: Array<{
      id: string;
      strategyId: string;
      sampleSize: number;
      recommendation: "maintain" | "watch" | "pause" | "retire";
      status: string;
      decayDetected: boolean;
      driftSignals: string[];
      automaticallyApplied: false;
    }>;
    eventBlackouts: Array<{ id: string; title: string; severity: string; startsAt: string }>;
  };
};

type ReliabilityHealth = {
  provider: "memory" | "json_file";
  durable: boolean;
  records: number;
  location: string | null;
  transactionCoordinator: {
    provider: "memory" | "postgres";
    transactional: boolean;
    configured: boolean;
  };
  productionOrderSubmissionEnabled: false;
};

type ProviderRecovery = {
  providers: Array<{
    provider: string;
    operation: string;
    attempts: number;
    recovered: number;
    failures: number;
    lastFailureCode: string | null;
  }>;
  automaticOrderResubmissionEnabled: false;
  productionOrderSubmissionEnabled: false;
};

type ProductionResilience = {
  ready: boolean;
  generatedAt: string;
  evidence: Array<{
    id: string;
    category: "observability" | "incident_response" | "disaster_recovery" | "provider_recovery" | "audit_replication" | "emergency_controls";
    actorId: string;
    status: "configured" | "acknowledged" | "drilled" | "verified";
    detail: string;
    createdAt: string;
  }>;
  providerRecovery: Array<{
    provider: string;
    operation: string;
    attempts: number;
    recovered: number;
    failures: number;
    lastAttemptAt: string | null;
    lastRecoveredAt: string | null;
    lastFailureAt: string | null;
    lastFailureCode: string | null;
  }>;
  checks: Array<{
    id: string;
    passed: boolean;
    detail: string;
    requiredAction?: string;
  }>;
  requiredActions: string[];
  productionOrderSubmissionEnabled: false;
};

type AutonomyGovernance = {
  approvals: Array<{
    id: string;
    status: string;
    requestedBy: string;
    expiresAt: string;
    reviews: Array<{ role: string; decision: string; reviewerId: string }>;
    scope: { strategyIds: string[]; allowedInstruments: string[]; maxRiskPerTradePct: number; maxDailyLoss: number };
  }>;
  active: {
    id: string;
    status: string;
    requestedBy: string;
    requestedAt: string;
    expiresAt: string;
    scope: {
      strategyIds: string[];
      allowedInstruments: string[];
      maxRiskPerTradePct: number;
      maxDailyLoss: number;
      maxOpenPositions: number;
      maxNotional: number;
      referenceEquity: number;
      monitoringIntervalSeconds: number;
      sandboxOnly: true;
    };
    reviews: Array<{ role: string; decision: string; reviewerId: string }>;
  } | null;
  repository: { provider: "memory" | "postgres"; durable: boolean };
  productionOrderSubmissionEnabled: false;
};

type AuditExports = {
  exports: Array<{
    id: string;
    artifactDigest: string;
    signatureAlgorithm: string;
    generatedBy: string;
    generatedAt: string;
    storageLocation: string | null;
    archiveLocation: string | null;
  }>;
  health: {
    repository: { provider: "memory" | "postgres"; durable: boolean };
    signingConfigured: boolean;
    exportDirectoryConfigured: boolean;
    archiveDirectoryConfigured: boolean;
  };
};

type AuditExportBundle = {
  record: {
    id: string;
    artifactDigest: string;
    previousArtifactDigest: string | null;
    signature: string | null;
    signatureAlgorithm: string;
    eventCount: number;
    auditEntryCount: number;
    storageLocation: string | null;
    archiveLocation: string | null;
    generatedBy: string;
    generatedAt: string;
  };
  artifact: {
    format: "marketpilot-audit-export-v1";
    id: string;
    generatedAt: string;
    generatedBy: string;
    previousArtifactDigest: string | null;
    eventChain: Array<{ sequence: number; previousDigest: string | null; digest: string; item: Record<string, unknown> }>;
    executionAuditChain: Array<{ sequence: number; previousDigest: string | null; digest: string; item: Record<string, unknown> }>;
    productionOrderSubmissionEnabled: false;
  } | null;
  verification: {
    valid: boolean;
    digestValid: boolean;
    signatureValid: boolean;
    eventChainValid: boolean;
    executionAuditChainValid: boolean;
  } | null;
  productionOrderSubmissionEnabled: false;
};

type LiveSafetyQuizQuestion = {
  id: string;
  topic: string;
  prompt: string;
  choices: string[];
};

type ControlledLivePermission = {
  userId: string;
  allowed: boolean;
  blocked: boolean;
  missingRequirements: string[];
  warnings: string[];
  requirements: Array<{ id: string; passed: boolean; requiredAction: string }>;
  issuedAt: string;
  expirationTimestamp: string;
  productionLiveSubmissionAllowed: false;
  explicitConfirmationRequired: true;
};

type ControlledLivePreview = {
  id: string;
  strategyId: string;
  correlationId: string;
  provider: string;
  environment: "sandbox" | "live";
  instrument: string;
  side: string;
  orderType: string;
  quantity: number;
  notionalValue: number;
  estimatedMargin: number;
  estimatedSpreadCost: number;
  estimatedCommission: number;
  estimatedSlippage: number;
  stopLoss: number;
  takeProfit: number | null;
  maxLossEstimate: number;
  portfolioImpact: {
    currentExposure: number;
    proposedExposure: number;
    incrementalNotional: number;
  };
  riskAsPctOfAccount: number;
  invalidationRule: string;
  confirmationText: string;
  riskSummaryHash: string;
  createdAt: string;
  expiresAt: string;
  submissionAllowed: false;
  productionLiveSubmissionAllowed: false;
};

type ControlledLiveConfirmation = {
  id: string;
  accepted: boolean;
  reasons: string[];
  orderPreviewId: string;
  userId: string;
  brokerAccountId: string;
  riskSummaryHash: string;
  confirmedAt: string;
  expiresAt: string;
  singleUse: true;
  productionLiveSubmissionAllowed: false;
};

type ControlledLiveHistoryEntry = {
  id: string;
  type:
    | "controlled_live.quiz_recorded"
    | "controlled_live.permission_evaluated"
    | "controlled_live.preview_created"
    | "controlled_live.confirmation_recorded"
    | "controlled_live.sandbox_submitted";
  userId: string;
  correlationId: string;
  summary: string;
  detail: Record<string, unknown>;
  durable: boolean;
  createdAt: string;
};

type ControlledLiveHistoryScope = {
  userId: string;
  previewId: string | null;
  correlationId: string | null;
};

type ControlledLivePreviewDraft = {
  request: OrderRequest;
  accountEquity: number;
  currentPortfolioExposure: number;
  estimatedSpread: number;
  commissionRate: number;
  estimatedSlippageRate: number;
  invalidationRule: string;
  provider: "oanda_sandbox" | "metatrader_demo" | "generic_rest_sandbox";
};

type OrderRequest = {
  strategyId: string;
  instrument: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop";
  units: number;
  price: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLoss: number;
  takeProfit?: number;
  mode: "backtest" | "paper" | "supervised_live";
  explicitUserConfirmation: boolean;
  correlationId: string;
};

const AUTOMATION_LEVEL_ACKNOWLEDGEMENT = "I understand this increases MarketPilot automation within configured safety limits.";

export default function ExecutionCenter() {
  const queryClient = useQueryClient();
  const [selectedAuditExport, setSelectedAuditExport] = useState<AuditExportBundle | null>(null);
  const [latestLivePreview, setLatestLivePreview] = useState<ControlledLivePreview | null>(() => readSessionJson<ControlledLivePreview>("marketpilot-controlled-live-preview"));
  const [latestLiveConfirmation, setLatestLiveConfirmation] = useState<ControlledLiveConfirmation | null>(() => readSessionJson<ControlledLiveConfirmation>("marketpilot-controlled-live-confirmation"));
  const { data } = useQuery<ExecutionStatus>({ queryKey: ["/api/marketpilot/execution/status"] });
  const { data: sandbox } = useQuery<SandboxPanel>({ queryKey: ["/api/marketpilot/execution/sandbox-panel"] });
  const { data: ops } = useQuery<StrategyOpsDashboard>({ queryKey: ["/api/marketpilot/execution/strategy-ops/dashboard"] });
  const { data: reliability } = useQuery<ReliabilityHealth>({ queryKey: ["/api/marketpilot/execution/reliability-state/health"] });
  const { data: providerRecovery } = useQuery<ProviderRecovery>({ queryKey: ["/api/marketpilot/execution/provider-recovery"] });
  const { data: resilience } = useQuery<ProductionResilience>({ queryKey: ["/api/marketpilot/execution/resilience"] });
  const { data: autonomyGovernance } = useQuery<AutonomyGovernance>({ queryKey: ["/api/marketpilot/execution/semi-autonomous-approvals"] });
  const { data: auditExports } = useQuery<AuditExports>({ queryKey: ["/api/marketpilot/execution/audit-exports"] });
  const { data: liveSafetyQuiz } = useQuery<LiveSafetyQuizQuestion[]>({ queryKey: ["/api/marketpilot/execution/live-safety-quiz"] });
  const workflow = data?.controlledLiveWorkflow;
  const [historyScope, setHistoryScope] = useState<ControlledLiveHistoryScope | null>(() => readSessionJson<ControlledLiveHistoryScope>("marketpilot-controlled-live-history-scope"));
  const defaultHistoryScope: ControlledLiveHistoryScope = {
    userId: workflow?.permission?.userId ?? "execution-center-user",
    previewId: latestLivePreview?.id ?? workflow?.latestPreview?.id ?? null,
    correlationId: latestLivePreview?.correlationId ?? workflow?.latestPreview?.correlationId ?? null,
  };
  const liveWorkflowScope = historyScope ?? defaultHistoryScope;
  const liveWorkflowHistoryQueryKey = [
    "/api/marketpilot/execution/controlled-live-workflow/history",
    liveWorkflowScope.userId,
    liveWorkflowScope.previewId ?? "",
    liveWorkflowScope.correlationId ?? "",
  ] as const;
  const { data: liveWorkflowHistory } = useQuery<ControlledLiveHistoryEntry[]>({
    queryKey: liveWorkflowHistoryQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("userId", liveWorkflowScope.userId);
      if (liveWorkflowScope.previewId) params.set("previewId", liveWorkflowScope.previewId);
      if (liveWorkflowScope.correlationId) params.set("correlationId", liveWorkflowScope.correlationId);
      const response = await apiRequest("GET", `/api/marketpilot/execution/controlled-live-workflow/history?${params.toString()}`);
      return response.json() as Promise<ControlledLiveHistoryEntry[]>;
    },
  });
  const liveWorkflowSequence = buildControlledLiveSequence(liveWorkflowHistory ?? []);
  useEffect(() => {
    if (historyScope) {
      writeSessionJson("marketpilot-controlled-live-history-scope", historyScope);
    } else {
      clearSessionValue("marketpilot-controlled-live-history-scope");
    }
  }, [historyScope]);
  useEffect(() => {
    if (!latestLivePreview && workflow?.latestPreview) {
      setLatestLivePreview(workflow.latestPreview);
    }
  }, [latestLivePreview, workflow?.latestPreview]);
  useEffect(() => {
    if (!historyScope && workflow) {
      setHistoryScope(defaultHistoryScope);
    }
  }, [defaultHistoryScope, historyScope, workflow]);
  useEffect(() => {
    if (!latestLiveConfirmation && workflow?.latestConfirmation) {
      setLatestLiveConfirmation(workflow.latestConfirmation);
    }
  }, [latestLiveConfirmation, workflow?.latestConfirmation]);
  useEffect(() => {
    if (latestLivePreview) {
      writeSessionJson("marketpilot-controlled-live-preview", latestLivePreview);
    } else {
      clearSessionValue("marketpilot-controlled-live-preview");
    }
  }, [latestLivePreview]);
  useEffect(() => {
    if (latestLiveConfirmation) {
      writeSessionJson("marketpilot-controlled-live-confirmation", latestLiveConfirmation);
    } else {
      clearSessionValue("marketpilot-controlled-live-confirmation");
    }
  }, [latestLiveConfirmation]);
  const recordResilienceEvidence = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiRequest("POST", "/api/marketpilot/execution/resilience/evidence", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/resilience"] });
    },
  });
  const loadAuditExport = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("GET", `/api/marketpilot/execution/audit-exports/${id}`);
      return response.json() as Promise<AuditExportBundle>;
    },
    onSuccess: (bundle) => setSelectedAuditExport(bundle),
  });
  const gradeLiveSafetyQuiz = useMutation({
    mutationFn: (payload: { userId: string; answers: Record<string, number> }) => apiRequest("POST", "/api/marketpilot/execution/live-safety-quiz", payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/status"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/controlled-live-workflow/history"] }),
      ]);
    },
  });
  const evaluateLivePermission = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiRequest("POST", "/api/marketpilot/execution/live-permission", payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/status"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/controlled-live-workflow/history"] }),
      ]);
    },
  });
  const createLivePreview = useMutation({
    mutationFn: (payload: ControlledLivePreviewDraft) => apiRequest("POST", "/api/marketpilot/execution/live-order-preview", payload),
    onSuccess: async (response) => {
      setLatestLivePreview(await response.json());
      setLatestLiveConfirmation(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/status"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/controlled-live-workflow/history"] }),
      ]);
    },
  });
  const confirmLiveOrder = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiRequest("POST", "/api/marketpilot/execution/live-final-confirmation", payload),
    onSuccess: async (response) => {
      setLatestLiveConfirmation(await response.json());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/status"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/controlled-live-workflow/history"] }),
      ]);
    },
  });
  const requestApproval = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiRequest("POST", "/api/marketpilot/execution/semi-autonomous-approvals", payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/semi-autonomous-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/automation-level"] }),
      ]);
    },
  });
  const reviewApproval = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiRequest("POST", `/api/marketpilot/execution/semi-autonomous-approvals/${id}/reviews`, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/semi-autonomous-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/automation-level"] }),
      ]);
    },
  });
  const revokeApproval = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { revokedBy: string; reason: string } }) =>
      apiRequest("POST", `/api/marketpilot/execution/semi-autonomous-approvals/${id}/revoke`, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/semi-autonomous-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/automation-level"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/status"] }),
      ]);
    },
  });
  const generateAuditExport = useMutation({
    mutationFn: (payload: { generatedBy: string }) => apiRequest("POST", "/api/marketpilot/execution/audit-exports", payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/audit-exports"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/automation-level"] }),
      ]);
    },
  });
  const transitionAutomation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiRequest("POST", "/api/marketpilot/execution/automation-level", payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/automation-level"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/status"] }),
      ]);
    },
  });
  const killSwitch = useMutation({
    mutationFn: () => apiRequest("POST", "/api/marketpilot/execution/kill-switch"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/status"] }),
  });
  const emergency = useMutation({
    mutationFn: () => apiRequest("POST", "/api/marketpilot/execution/emergency", {
      actorId: "execution-center-user",
      reason: "User activated emergency controls from Execution Center",
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/status"] }),
  });
  const disconnectSandbox = useMutation({
    mutationFn: () => {
      if (!sandbox?.advanced.provider) throw new Error("No sandbox provider is connected");
      return apiRequest("POST", `/api/marketpilot/execution/sandbox/${sandbox.advanced.provider}/disconnect`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/sandbox-panel"] }),
  });
  const reconcileSandbox = useMutation({
    mutationFn: () => {
      if (!sandbox?.advanced.provider) throw new Error("No sandbox provider is connected");
      return apiRequest("POST", `/api/marketpilot/execution/sandbox/${sandbox.advanced.provider}/reconcile`, {
        userId: "execution-center-user",
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketpilot/execution/sandbox-panel"] }),
  });
  const primary = data?.primary;
  const autonomyRoadmap = buildAutonomyRoadmap(primary?.automationLevel.level ?? 0, primary?.liveReadiness?.missingRequirements ?? [], primary?.liveReadiness?.readinessVerdict ?? "blocked");
  const { data: insights } = usePredictionInsights();
  const lessonCue = buildPredictionLessonCue(insights?.topThemes[0], insights?.recentRules[0]);
  const lessonChecklist = buildMemoryActionChecklist(lessonCue);

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-white">Execution Center</h1>
            <Badge variant="outline">Forex + commodities</Badge>
            <Badge variant="secondary">Live submission blocked</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Automation defaults to Level 0 and is kill-switch protected and auditable. Levels 5–6 represent eligibility candidates only; production order submission remains disabled.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatusCard icon={Radio} title="Automation level" value={primary ? `Level ${primary.automationLevel.level} · ${primary.automationLevel.name}` : "..."} />
          <StatusCard icon={Ban} title="Kill switch" value={primary?.killSwitchStatus ?? "..."} danger={primary?.killSwitchStatus === "triggered"} />
          <StatusCard icon={CircleDollarSign} title="Open paper positions" value={String(primary?.openPaperPositions.length ?? 0)} />
          <StatusCard icon={ShieldCheck} title="Risk precheck" value={primary?.riskPrecheckStatus.action ?? "..."} danger={primary?.riskPrecheckStatus.action === "reject"} />
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Autonomy Roadmap</CardTitle>
              <Badge variant={autonomyRoadmap.currentLevel >= 5 ? "outline" : "secondary"}>
                {autonomyRoadmap.currentLabel}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              MarketPilot advances one level at a time. Each step keeps production live submission blocked until the required controls are present.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <Summary label="Current target" value={autonomyRoadmap.nextTargetLabel} />
              <Summary label="Next blockers" value={autonomyRoadmap.nextBlockers.length > 0 ? autonomyRoadmap.nextBlockers[0] : "No blockers from current snapshot"} />
              <Summary label="Readiness state" value={autonomyRoadmap.readinessState} />
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {autonomyRoadmap.levels.map((level) => (
                <div key={level.level} className={`rounded-lg border p-3 ${level.active ? "border-primary/40 bg-primary/5" : "bg-background/35"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-white">Level {level.level}</div>
                    <Badge variant={level.active ? "outline" : "secondary"}>{level.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{level.name}</p>
                  <p className="mt-2 text-xs text-slate-200">{level.description}</p>
                  {level.blockers.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {level.blockers.slice(0, 3).map((blocker) => (
                        <div key={blocker} className="text-xs text-muted-foreground">• {blocker}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {lessonCue && (
          <Card className="border-primary/30 bg-card/70">
            <CardHeader>
              <CardTitle className="text-white">Preflight lesson</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="rounded-lg border border-border/60 bg-background/35 p-3 text-slate-200">
                <div className="text-xs uppercase tracking-wide text-primary">Memory reuse</div>
                <p className="mt-2">{lessonCue.cue}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {lessonCue.theme} · {lessonCue.count} repeats · {lessonCue.source}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Summary label="Current lesson" value={lessonCue.lesson} />
                <Summary label="Rule reminder" value={lessonCue.rule} />
              </div>
              {lessonChecklist.length > 0 && (
                <div className="rounded-lg border border-border/60 bg-background/35 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Preflight checklist</div>
                  <ul className="mt-2 space-y-2 text-muted-foreground">
                    {lessonChecklist.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className={primary?.liveReadiness?.readinessVerdict === "blocked" ? "border-amber-500/40" : ""}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Live Readiness</CardTitle>
              <Badge variant={primary?.liveReadiness?.readinessVerdict === "blocked" ? "destructive" : "outline"}>
                {primary?.liveReadiness?.readinessVerdict ?? "blocked"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-3">
              <Summary label="Active risk limits" value={primary?.liveReadiness ? `$${primary.liveReadiness.activeRiskLimits.maxDailyLoss} daily · ${primary.liveReadiness.activeRiskLimits.maxRiskPerTradePct}% per trade` : "Unavailable"} />
              <Summary label="Kill switch" value={primary?.liveReadiness?.killSwitchState ?? "unknown"} />
              <Summary label="Next required action" value={primary?.liveReadiness?.nextRequiredAction ?? "Complete readiness assessment"} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Missing requirements</p>
              {primary?.liveReadiness?.missingRequirements.length
                ? <ul className="space-y-1 text-muted-foreground">{primary.liveReadiness.missingRequirements.map((item) => <li key={item}>• {item}</li>)}</ul>
                : <p className="text-muted-foreground">No missing sandbox-readiness requirements.</p>}
            </div>
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer font-medium text-white">Advanced readiness details</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {Object.entries(data?.advanced.liveReadinessDetails ?? {}).map(([name, section]) => (
                  <div key={name} className="rounded-md bg-muted/30 p-3">
                    <p className="font-medium text-white">{humanize(name)} · {section.ready ? "ready" : "blocked"}</p>
                    {section.missingRequirements.map((item) => <p key={item} className="mt-1 text-xs text-muted-foreground">{item}</p>)}
                  </div>
                ))}
              </div>
            </details>
          </CardContent>
        </Card>

        <Card className={!workflow?.permission?.allowed ? "border-amber-500/40" : ""}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Live Permission & Confirmation</CardTitle>
              <Badge variant={workflow?.permission?.allowed ? "outline" : "destructive"}>
                {workflow?.permission?.allowed ? "permission allowed" : "permission blocked"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Controlled-live orders stay in a four-step chain: current quiz pass, current permission, current preview, then one-time final confirmation. Production submission remains disabled.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <Summary
                label="Safety quiz"
                value={workflow?.quizPassed
                  ? `passed${workflow?.quizExpiresAt ? ` · expires ${new Date(workflow.quizExpiresAt).toLocaleString()}` : ""}`
                  : "not passed"}
              />
              <Summary
                label="Permission"
                value={workflow?.permission
                  ? `${workflow.permission.allowed ? "allowed" : "blocked"}${workflow.permission.expirationTimestamp ? ` · expires ${new Date(workflow.permission.expirationTimestamp).toLocaleString()}` : ""}`
                  : "unavailable"}
              />
              <Summary
                label="Order chain"
                value={`${workflow?.previewCount ?? 0} previews · ${workflow?.confirmationCount ?? 0} confirmations`}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Missing requirements</p>
                {workflow?.permission?.missingRequirements.length
                  ? <ul className="mt-2 space-y-1 text-muted-foreground">{workflow.permission.missingRequirements.map((item) => <li key={item}>• {item}</li>)}</ul>
                  : <p className="mt-2 text-muted-foreground">No permission gates are currently missing.</p>}
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Warnings</p>
                {workflow?.permission?.warnings.length
                  ? <ul className="mt-2 space-y-1 text-muted-foreground">{workflow.permission.warnings.map((item) => <li key={item}>• {item}</li>)}</ul>
                  : <p className="mt-2 text-muted-foreground">No active warnings.</p>}
              </div>
            </div>
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer font-medium text-white">Advanced controlled-live details</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Summary label="Required phrase" value={workflow?.requiredConfirmationPhrase ?? "unavailable"} />
                <Summary label="Permission issued" value={workflow?.permission?.issuedAt ? new Date(workflow.permission.issuedAt).toLocaleString() : "unavailable"} />
                <Summary label="Production submission" value={workflow?.productionLiveSubmissionAllowed ? "enabled" : "disabled"} />
                <Summary label="Explicit confirmation" value={workflow?.permission?.explicitConfirmationRequired ? "required" : "not required"} />
              </div>
            </details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Guided Live Workflow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 text-sm">
            <p className="text-muted-foreground">
              This sequence is intentionally explicit: pass the quiz, evaluate permission, create a current preview, then issue a single-use confirmation. Production live submission still remains disabled.
            </p>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-medium text-white">1. Live safety quiz</h3>
                  <Badge variant={workflow?.quizPassed ? "outline" : "secondary"}>{workflow?.quizPassed ? "passed" : "not passed"}</Badge>
                </div>
                <form
                  className="mt-4 space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const formData = new FormData(form);
                    const answers = Object.fromEntries((liveSafetyQuiz ?? []).map((question) => [question.id, Number(formData.get(question.id) ?? 0)]));
                    gradeLiveSafetyQuiz.mutate({
                      userId: String(formData.get("quizUserId") ?? ""),
                      answers,
                    });
                  }}
                >
                  <Field label="User ID" name="quizUserId" defaultValue="execution-center-user" />
                  <div className="grid gap-3">
                    {liveSafetyQuiz?.map((question) => (
                      <label key={question.id} className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">{question.prompt}</span>
                        <select
                          name={question.id}
                          defaultValue="1"
                          className="rounded-md border bg-background px-3 py-2 text-sm text-white outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {question.choices.map((choice, index) => (
                            <option key={choice} value={index}>
                              {index}: {choice}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" disabled={gradeLiveSafetyQuiz.isPending}>Submit quiz</Button>
                  </div>
                </form>
              </section>

              <section className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-medium text-white">2. Permission evidence</h3>
                  <Badge variant={workflow?.permission?.allowed ? "outline" : "destructive"}>{workflow?.permission?.allowed ? "allowed" : "blocked"}</Badge>
                </div>
                <form
                  className="mt-4 grid gap-3 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const formData = new FormData(form);
                    evaluateLivePermission.mutate({
                      userId: String(formData.get("permissionUserId") ?? ""),
                      proficiencyScore: Number(formData.get("proficiencyScore") ?? 0),
                      requiredProficiencyScore: Number(formData.get("requiredProficiencyScore") ?? 80),
                      complianceDisclosureAcknowledged: asBoolean(formData.get("complianceDisclosureAcknowledged")),
                      accountRiskProfileCompleted: asBoolean(formData.get("accountRiskProfileCompleted")),
                      brokerConnectionVerified: asBoolean(formData.get("brokerConnectionVerified")),
                      accountMode: String(formData.get("accountMode") ?? "sandbox"),
                      expectedAccountMode: String(formData.get("expectedAccountMode") ?? "sandbox"),
                      maxDailyLossConfigured: asBoolean(formData.get("maxDailyLossConfigured")),
                      maxTradeRiskConfigured: asBoolean(formData.get("maxTradeRiskConfigured")),
                      killSwitchArmed: asBoolean(formData.get("killSwitchArmed")),
                      strategyValidationVerdict: String(formData.get("strategyValidationVerdict") ?? "supervised_live_candidate"),
                      emergencyClosePolicyAccepted: asBoolean(formData.get("emergencyClosePolicyAccepted")),
                      brokerCredentialsEncrypted: asBoolean(formData.get("brokerCredentialsEncrypted")),
                      sessionMfaVerified: asBoolean(formData.get("sessionMfaVerified")),
                    });
                  }}
                >
                  <Field label="User ID" name="permissionUserId" defaultValue="execution-center-user" />
                  <Field label="Proficiency score" name="proficiencyScore" type="number" defaultValue="92" />
                  <Field label="Required score" name="requiredProficiencyScore" type="number" defaultValue="80" />
                  <SelectField label="Compliance acknowledged" name="complianceDisclosureAcknowledged" options={["true", "false"]} defaultValue="true" />
                  <SelectField label="Risk profile complete" name="accountRiskProfileCompleted" options={["true", "false"]} defaultValue="true" />
                  <SelectField label="Broker verified" name="brokerConnectionVerified" options={["true", "false"]} defaultValue="true" />
                  <SelectField label="Account mode" name="accountMode" options={["paper", "sandbox", "live"]} defaultValue="sandbox" />
                  <SelectField label="Expected mode" name="expectedAccountMode" options={["sandbox", "live"]} defaultValue="sandbox" />
                  <SelectField label="Daily loss configured" name="maxDailyLossConfigured" options={["true", "false"]} defaultValue="true" />
                  <SelectField label="Trade risk configured" name="maxTradeRiskConfigured" options={["true", "false"]} defaultValue="true" />
                  <SelectField label="Kill switch armed" name="killSwitchArmed" options={["true", "false"]} defaultValue="true" />
                  <SelectField label="Strategy verdict" name="strategyValidationVerdict" options={["reject", "paper_only", "watchlist", "supervised_live_candidate"]} defaultValue="supervised_live_candidate" />
                  <SelectField label="Emergency close policy" name="emergencyClosePolicyAccepted" options={["true", "false"]} defaultValue="true" />
                  <SelectField label="Encrypted credentials" name="brokerCredentialsEncrypted" options={["true", "false"]} defaultValue="true" />
                  <SelectField label="MFA verified" name="sessionMfaVerified" options={["true", "false"]} defaultValue="true" />
                  <div className="md:col-span-2 flex flex-wrap gap-3">
                    <Button type="submit" disabled={evaluateLivePermission.isPending}>Evaluate permission</Button>
                  </div>
                </form>
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-medium text-white">3. Order preview</h3>
                  <Badge variant={latestLivePreview ? "outline" : "secondary"}>{latestLivePreview ? "created" : "not created"}</Badge>
                </div>
                <form
                  className="mt-4 grid gap-3 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const formData = new FormData(form);
                    createLivePreview.mutate({
                      request: {
                        strategyId: String(formData.get("strategyId") ?? "demo-live-guardrail"),
                        instrument: String(formData.get("instrument") ?? "EUR/USD"),
                        side: String(formData.get("side") ?? "buy") as OrderRequest["side"],
                        type: String(formData.get("orderType") ?? "market") as OrderRequest["type"],
                        units: Number(formData.get("units") ?? 10000),
                        price: Number(formData.get("price") ?? 1.1),
                        limitPrice: readOptionalNumber(formData, "limitPrice"),
                        stopPrice: readOptionalNumber(formData, "stopPrice"),
                        stopLoss: Number(formData.get("stopLoss") ?? 1.095),
                        takeProfit: readOptionalNumber(formData, "takeProfit"),
                        mode: "supervised_live",
                        explicitUserConfirmation: true,
                        correlationId: String(formData.get("correlationId") ?? "execution-center-guided"),
                      },
                      accountEquity: Number(formData.get("accountEquity") ?? 100000),
                      currentPortfolioExposure: Number(formData.get("currentPortfolioExposure") ?? 20000),
                      estimatedSpread: Number(formData.get("estimatedSpread") ?? 0.0001),
                      commissionRate: Number(formData.get("commissionRate") ?? 0.00002),
                      estimatedSlippageRate: Number(formData.get("estimatedSlippageRate") ?? 0.00005),
                      invalidationRule: String(formData.get("invalidationRule") ?? "Exit if the thesis breaks or risk exceeds the configured limit."),
                      provider: String(formData.get("provider") ?? "oanda_sandbox") as ControlledLivePreviewDraft["provider"],
                    });
                  }}
                >
                  <Field label="Strategy ID" name="strategyId" defaultValue="demo-live-guardrail" />
                  <Field label="Correlation ID" name="correlationId" defaultValue="execution-center-guided" />
                  <SelectField label="Instrument" name="instrument" options={["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD"]} defaultValue="EUR/USD" />
                  <SelectField label="Side" name="side" options={["buy", "sell"]} defaultValue="buy" />
                  <SelectField label="Order type" name="orderType" options={["market", "limit", "stop"]} defaultValue="market" />
                  <Field label="Units" name="units" type="number" defaultValue="10000" />
                  <Field label="Price" name="price" type="number" step="0.0001" defaultValue="1.1" />
                  <Field label="Stop loss" name="stopLoss" type="number" step="0.0001" defaultValue="1.095" />
                  <Field label="Take profit" name="takeProfit" type="number" step="0.0001" defaultValue="1.11" />
                  <Field label="Limit price" name="limitPrice" type="number" step="0.0001" defaultValue="" />
                  <Field label="Stop price" name="stopPrice" type="number" step="0.0001" defaultValue="" />
                  <Field label="Account equity" name="accountEquity" type="number" defaultValue="100000" />
                  <Field label="Current exposure" name="currentPortfolioExposure" type="number" defaultValue="20000" />
                  <Field label="Estimated spread" name="estimatedSpread" type="number" step="0.0001" defaultValue="0.0001" />
                  <Field label="Commission rate" name="commissionRate" type="number" step="0.00001" defaultValue="0.00002" />
                  <Field label="Estimated slippage rate" name="estimatedSlippageRate" type="number" step="0.00001" defaultValue="0.00005" />
                  <Field className="md:col-span-2" label="Invalidation rule" name="invalidationRule" defaultValue="Exit if the thesis breaks or risk exceeds the configured limit." />
                  <SelectField label="Provider" name="provider" options={["oanda_sandbox", "metatrader_demo", "generic_rest_sandbox"]} defaultValue="oanda_sandbox" />
                  <div className="md:col-span-2 flex flex-wrap gap-3">
                    <Button type="submit" disabled={createLivePreview.isPending}>Create preview</Button>
                    <Button type="button" variant="outline" disabled={!latestLivePreview} onClick={() => { setLatestLivePreview(null); setLatestLiveConfirmation(null); }}>
                      Clear cached preview
                    </Button>
                  </div>
                </form>
                {latestLivePreview && Date.parse(latestLivePreview.expiresAt) < Date.now() && (
                  <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    The current preview is expired. Create a fresh preview before final confirmation.
                  </p>
                )}
              </section>

              <section className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-medium text-white">4. Final confirmation</h3>
                  <Badge variant={latestLiveConfirmation?.accepted ? "outline" : "secondary"}>
                    {latestLiveConfirmation?.accepted ? "accepted" : "pending"}
                  </Badge>
                </div>
                <form
                  className="mt-4 grid gap-3 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const formData = new FormData(form);
                    const previewId = String(formData.get("confirmationPreviewId") ?? "");
                    const riskSummaryHash = String(formData.get("riskSummaryHash") ?? "");
                    confirmLiveOrder.mutate({
                      orderPreviewId: previewId,
                      userId: String(formData.get("confirmationUserId") ?? ""),
                      brokerAccountId: String(formData.get("brokerAccountId") ?? ""),
                      riskSummaryHash,
                      confirmationPhrase: String(formData.get("confirmationPhrase") ?? ""),
                      currentTimestamp: new Date().toISOString(),
                    });
                  }}
                >
                  <Field label="Preview ID" name="confirmationPreviewId" defaultValue={latestLivePreview?.id ?? ""} />
                  <Field label="User ID" name="confirmationUserId" defaultValue="execution-center-user" />
                  <Field label="Broker account ID" name="brokerAccountId" defaultValue="sandbox-demo-account" />
                  <Field label="Risk summary hash" name="riskSummaryHash" defaultValue={latestLivePreview?.riskSummaryHash ?? ""} />
                  <Field
                    className="md:col-span-2"
                    label="Confirmation phrase"
                    name="confirmationPhrase"
                    defaultValue={workflow?.requiredConfirmationPhrase ?? "I understand this is a live trade and I accept the risk."}
                  />
                  <div className="md:col-span-2 flex flex-wrap gap-3">
                    <Button type="submit" disabled={confirmLiveOrder.isPending || !latestLivePreview}>Confirm order</Button>
                    <Button type="button" variant="outline" disabled={!latestLiveConfirmation} onClick={() => setLatestLiveConfirmation(null)}>
                      Clear cached confirmation
                    </Button>
                  </div>
                </form>
              </section>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <Summary label="Latest preview" value={latestLivePreview ? `${latestLivePreview.instrument} · ${latestLivePreview.side} · ${latestLivePreview.riskAsPctOfAccount}% risk` : "none"} />
              <Summary label="Preview expiry" value={latestLivePreview?.expiresAt ? `${new Date(latestLivePreview.expiresAt).toLocaleString()}${Date.parse(latestLivePreview.expiresAt) < Date.now() ? " · expired" : ""}` : "n/a"} />
              <Summary label="Latest confirmation" value={latestLiveConfirmation ? `${latestLiveConfirmation.accepted ? "accepted" : "blocked"} · ${new Date(latestLiveConfirmation.confirmedAt).toLocaleString()}` : "none"} />
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium text-white">Workflow sequence</h3>
                <Badge variant="outline">{liveWorkflowSequence.currentStepLabel}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1">complete</span>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1">current</span>
                <span className="rounded-full border border-border bg-background/40 px-2 py-1">pending</span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                {liveWorkflowSequence.steps.map((step) => (
                  <div key={step.key} className={`rounded-lg border p-3 ${step.current ? "border-primary/50 bg-primary/10" : step.completed ? "border-emerald-500/30 bg-emerald-500/5" : "bg-background/35"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-white">{step.label}</p>
                      <Badge variant={step.completed ? "outline" : step.current ? "secondary" : "secondary"}>{step.completed ? "complete" : step.current ? "current" : "pending"}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{step.detail}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium text-white">Workflow history</h3>
                <Badge variant="outline">{liveWorkflowHistory?.length ?? 0} events</Badge>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Summary label="Current step" value={liveWorkflowSequence.currentStepLabel} />
                <Summary
                  label="Pinned scope"
                  value={formatControlledLiveScope(liveWorkflowScope)}
                />
                <Summary
                  label="History durability"
                  value={liveWorkflowHistory?.length
                    ? (liveWorkflowHistory.every((entry) => entry.durable) ? "durable" : "mixed")
                    : "unknown"}
                />
                <Summary
                  label="Last transition"
                  value={liveWorkflowSequence.latestTransitionAt ? new Date(liveWorkflowSequence.latestTransitionAt).toLocaleString() : "n/a"}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setHistoryScope(defaultHistoryScope)}
                >
                  Jump to current run
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={!historyScope}
                  onClick={() => setHistoryScope(null)}
                >
                  Reset run scope
                </Button>
              </div>
              {!liveWorkflowHistory?.length && <p className="mt-3 text-sm text-muted-foreground">No controlled-live events have been recorded yet.</p>}
              <div className="mt-3 space-y-2">
                {liveWorkflowHistory?.slice(0, 5).map((entry) => (
                  <details key={entry.id} className="rounded-lg border bg-background/30 p-3 text-sm">
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-white">{entry.summary}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={entry.durable ? "outline" : "secondary"}>{entry.durable ? "durable" : "ephemeral"}</Badge>
                          <Badge variant="secondary">{humanizeControlledLiveType(entry.type)}</Badge>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(entry.createdAt).toLocaleString()} · {entry.correlationId}
                      </p>
                    </summary>
                    <div className="mt-3 rounded-md border bg-background/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Detail</p>
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => setHistoryScope(deriveHistoryScope(entry, defaultHistoryScope))}
                        >
                          Jump to this run
                        </Button>
                      </div>
                      <pre className="mt-2 overflow-x-auto text-xs text-slate-200">
                        {JSON.stringify(entry.detail, null, 2)}
                      </pre>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Broker Sandbox</CardTitle>
              <Badge variant={sandbox?.primary.connectionStatus === "healthy" ? "outline" : "secondary"}>
                {sandbox?.primary.connectionStatus ?? "disconnected"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Summary label="Account mode" value={sandbox?.primary.accountMode ?? "demo"} />
              <Summary label="Equity" value={`$${(sandbox?.primary.equity ?? 0).toLocaleString()}`} />
              <Summary label="Margin available" value={`$${(sandbox?.primary.marginAvailable ?? 0).toLocaleString()}`} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open sandbox positions</p>
              {!sandbox?.primary.openSandboxPositions.length && <Empty>No open sandbox positions.</Empty>}
              {sandbox?.primary.openSandboxPositions.map((position) => (
                <div key={position.id} className="flex flex-wrap justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span className="font-medium text-white">{position.instrument} · {position.side} · {position.units}</span>
                  <span>Unrealized P/L ${position.unrealizedPnL.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <Summary
              label="Latest sandbox order"
              value={sandbox?.primary.latestSandboxOrderStatus
                ? `${sandbox.primary.latestSandboxOrderStatus.status}${sandbox.primary.latestSandboxOrderStatus.filledUnits !== null
                  ? ` · ${sandbox.primary.latestSandboxOrderStatus.filledUnits}/${sandbox.primary.latestSandboxOrderStatus.requestedUnits ?? "?"} units filled`
                  : ""}${sandbox.primary.latestSandboxOrderStatus.reason ? ` · ${sandbox.primary.latestSandboxOrderStatus.reason}` : ""}`
                : "No sandbox order submitted"}
            />
            <div className="flex flex-wrap gap-3">
              <Button variant="destructive" disabled={Boolean(sandbox?.primary.emergencyControls.killSwitchActive) || killSwitch.isPending} onClick={() => killSwitch.mutate()}>
                Trigger kill switch
              </Button>
              <Button variant="outline" disabled={!sandbox?.primary.emergencyControls.disconnectAvailable || disconnectSandbox.isPending} onClick={() => disconnectSandbox.mutate()}>
                Disconnect sandbox broker
              </Button>
              <Button variant="outline" disabled={!sandbox?.primary.emergencyControls.disconnectAvailable || reconcileSandbox.isPending} onClick={() => reconcileSandbox.mutate()}>
                Reconcile broker state
              </Button>
            </div>
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium text-white">Advanced broker details</summary>
              <p className="mt-2 text-muted-foreground">
                Provider: {sandbox?.advanced.provider ?? "not configured"} · Account: {sandbox?.advanced.accountId ?? "unavailable"}
              </p>
              {sandbox?.advanced.providerHealthReason && <p className="mt-1 text-muted-foreground">{sandbox.advanced.providerHealthReason}</p>}
              <p className="mt-1 text-muted-foreground">
                Reconciliation: {sandbox?.advanced.latestReconciliation
                  ? `${sandbox.advanced.latestReconciliation.status} · ${sandbox.advanced.latestReconciliation.discrepancyCount} discrepancies · ${new Date(sandbox.advanced.latestReconciliation.reconciledAt).toLocaleString()}`
                  : "not yet run"}
              </p>
              <p className="mt-1 text-muted-foreground">
                Reliability state: {reliability?.durable ? "durable single-process file" : "ephemeral memory"} · {reliability?.records ?? 0} records
              </p>
              <p className="mt-1 text-muted-foreground">
                Transaction coordinator: {reliability?.transactionCoordinator.provider ?? "memory"} · {reliability?.transactionCoordinator.transactional ? "multi-instance transactional" : "single-instance"}
              </p>
              <p className="mt-1 text-muted-foreground">
                Provider recovery: {providerRecovery?.providers.reduce((sum, item) => sum + item.recovered, 0) ?? 0} recovered · {providerRecovery?.providers.reduce((sum, item) => sum + item.failures, 0) ?? 0} failed · order resubmission disabled
              </p>
            </details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Strategy Performance</CardTitle>
              <Badge variant={ops?.primary.riskStatus.status === "blocked" ? "destructive" : "outline"}>
                {ops?.primary.riskStatus.status ?? "operational"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Summary label="Active paper strategies" value={String(ops?.primary.activePaperStrategies.length ?? 0)} />
              <Summary label="Today's signals" value={String(ops?.primary.todaysSignals.length ?? 0)} />
              <Summary label="Open positions" value={String(ops?.primary.openPositions.length ?? 0)} />
              <Summary label="Unrealized P/L" value={`$${(ops?.primary.pnlSummary.unrealized ?? 0).toFixed(2)}`} />
              <Summary label="Realized P/L" value={`$${(ops?.primary.pnlSummary.realized ?? 0).toFixed(2)}`} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active strategies</p>
                {!ops?.primary.activePaperStrategies.length && <Empty>No active paper strategies.</Empty>}
                {ops?.primary.activePaperStrategies.map((strategy) => (
                  <div key={strategy.strategyId} className="rounded-lg border p-3 text-sm">
                    <span className="font-medium text-white">{strategy.name}</span>
                    <span className="text-muted-foreground"> · {strategy.openPositions} open positions</span>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest signals</p>
                {!ops?.primary.todaysSignals.length && <Empty>No signals today.</Empty>}
                {ops?.primary.todaysSignals.map((signal, index) => (
                  <div key={signal.id ?? index} className="rounded-lg border p-3 text-sm">
                    <span className="font-medium text-white">{signal.strategyId ?? "Strategy"} · {signal.symbol ?? "symbol"}</span>
                    <span className="text-muted-foreground"> · {signal.status ?? "evaluated"}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Latest signals</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!primary?.latestSignals.length && <Empty>No recent paper signals.</Empty>}
              {primary?.latestSignals.map((signal, index) => (
                <div key={signal.id ?? index} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium text-white">{signal.strategyId ?? "Strategy signal"}</p>
                  <p className="text-muted-foreground">{signal.reviewStatus ?? "Recorded"}{signal.createdAt ? ` · ${new Date(signal.createdAt).toLocaleString()}` : ""}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Strategy validation verdicts</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!primary?.strategyValidationVerdicts.length && <Empty>No registered strategies.</Empty>}
              {primary?.strategyValidationVerdicts.map((validation) => (
                <div key={`${validation.strategyId}-${validation.instrument}`} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span><span className="font-medium text-white">{validation.strategyId}</span> · {validation.instrument}</span>
                  <Badge variant={validation.verdict === "reject" ? "destructive" : "outline"}>{validation.verdict} · {validation.score}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Open paper positions</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!primary?.openPaperPositions.length && <Empty>No open paper positions.</Empty>}
            {primary?.openPaperPositions.map((position) => (
              <div key={position.id} className="flex flex-wrap justify-between gap-3 rounded-lg border p-3 text-sm">
                <span className="font-medium text-white">{position.instrument} · {position.side} · {position.units} units</span>
                <span>Unrealized P/L ${position.unrealizedPnL.toFixed(2)} · stop {position.stopLossStatus}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Tabs defaultValue="backtests" className="space-y-4">
          <TabsList className="h-auto flex-wrap justify-start">
            {["Price Feeds", "Strategy Ops", "Paper Runtime", "Post-Trade Reviews", "Strategy Lifecycle", "Autonomy Governance", "Audit Exports", "Production Resilience", "Event Blackouts", "Backtests", "Strategy validation", "Broker readiness", "Audit log", "Circuit breakers"].map((label) => (
              <TabsTrigger key={label} value={slug(label)}>{label}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="price-feeds"><Info title="Price Feeds" detail={`${ops?.advanced.priceFeeds.length ?? 0} latest practice/demo prices. Stale prices are excluded from strategy submission.`} /></TabsContent>
          <TabsContent value="strategy-ops"><Info title="Strategy Ops" detail={`${ops?.advanced.strategyOps.length ?? 0} subscribed strategies. Candle rules, quality filters, risk checks, and event windows are evaluated before routing.`} /></TabsContent>
          <TabsContent value="paper-runtime"><Info title="Paper Runtime" detail={`${ops?.advanced.paperRuntime.length ?? 0} configured paper runtimes with session, position, stop, target, and trailing-stop controls.`} /></TabsContent>
          <TabsContent value="post-trade-reviews">
            <Card><CardHeader><CardTitle>Post-Trade Reviews</CardTitle></CardHeader><CardContent className="space-y-3">
              {!ops?.advanced.postTradeReviews.length && <Empty>No closed trades awaiting display.</Empty>}
              {ops?.advanced.postTradeReviews.slice(0, 5).map((review) => (
                <div key={review.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium text-white">{review.strategyId} · {review.symbol} · {review.result}</p>
                  <p className="text-muted-foreground">{review.updatedLesson}</p>
                </div>
              ))}
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer font-medium text-white">Adaptation suggestions</summary>
                <div className="mt-2 space-y-2">
                  {ops?.advanced.adaptationSuggestions.map((suggestion) => (
                    <p key={suggestion.id} className="text-sm text-muted-foreground">{suggestion.type} · {suggestion.status} · {suggestion.reason}</p>
                  ))}
                </div>
              </details>
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="strategy-lifecycle">
            <Card><CardHeader><CardTitle>Strategy Lifecycle</CardTitle></CardHeader><CardContent className="space-y-3">
              {!ops?.advanced.strategyLifecycleReports.length && <Empty>No lifecycle reports available.</Empty>}
              {ops?.advanced.strategyLifecycleReports.map((report) => (
                <div key={report.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium text-white">{report.strategyId} · {report.recommendation} · {report.status}</p>
                  <p className="text-muted-foreground">
                    {report.sampleSize} closed trades · decay {report.decayDetected ? "detected" : "not detected"} · never auto-applied
                  </p>
                  {report.driftSignals.slice(0, 3).map((signal) => <p key={signal} className="mt-1 text-muted-foreground">• {signal}</p>)}
                </div>
              ))}
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="autonomy-governance">
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Automation transition</CardTitle></CardHeader>
                <CardContent>
                  <form
                    className="grid gap-3 md:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const formData = new FormData(form);
                      transitionAutomation.mutate({
                        level: Number(formData.get("targetLevel") ?? 0),
                        actorId: String(formData.get("actorId") ?? ""),
                        acknowledgement: String(formData.get("acknowledgement") ?? ""),
                        registeredStrategyCount: ops?.primary.activePaperStrategies.length ?? 0,
                        validatedStrategyCount: data?.advanced.strategyValidation.length ?? 0,
                        constraintsConfigured: Boolean(data?.primary.liveReadiness),
                        monitoringEnabled: true,
                        killSwitchAvailable: true,
                        sandboxReady: Boolean(sandbox?.advanced.provider),
                        supervisedPermissionActive: Boolean(data?.primary.liveReadiness?.readinessVerdict === "supervised_live_ready"),
                        semiAutonomousApproved: Boolean(autonomyGovernance?.active),
                        auditExportReady: Boolean(
                          auditExports?.health.signingConfigured
                          && auditExports?.health.exportDirectoryConfigured
                          && auditExports?.health.repository.durable
                        ),
                        semiAutonomousScope: autonomyGovernance?.active?.scope ?? null,
                      });
                    }}
                  >
                    <SelectField label="Target level" name="targetLevel" options={["0", "1", "2", "3", "4", "5", "6"]} defaultValue={String(data?.primary.automationLevel.level ?? 0)} />
                    <Field label="Actor ID" name="actorId" defaultValue="execution-center-user" />
                    <Field className="md:col-span-2" label="Acknowledgement" name="acknowledgement" defaultValue={AUTOMATION_LEVEL_ACKNOWLEDGEMENT} />
                    <div className="md:col-span-2">
                      <Button type="submit" disabled={transitionAutomation.isPending}>Request transition</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Request semi-autonomous approval</CardTitle></CardHeader>
                <CardContent>
                  <form
                    className="grid gap-3 md:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const data = new FormData(form);
                      requestApproval.mutate({
                        requestedBy: String(data.get("requestedBy") ?? ""),
                        justification: String(data.get("justification") ?? ""),
                        durationMinutes: Number(data.get("durationMinutes") ?? 60),
                        scope: {
                          strategyIds: splitList(String(data.get("strategyIds") ?? "")),
                          allowedInstruments: splitList(String(data.get("allowedInstruments") ?? "")),
                          maxRiskPerTradePct: Number(data.get("maxRiskPerTradePct") ?? 0),
                          maxDailyLoss: Number(data.get("maxDailyLoss") ?? 0),
                          maxOpenPositions: Number(data.get("maxOpenPositions") ?? 0),
                          maxNotional: Number(data.get("maxNotional") ?? 0),
                          referenceEquity: Number(data.get("referenceEquity") ?? 0),
                          monitoringIntervalSeconds: Number(data.get("monitoringIntervalSeconds") ?? 10),
                          sandboxOnly: true,
                        },
                      });
                      form.reset();
                    }}
                  >
                    <Field label="Requested by" name="requestedBy" defaultValue="execution-center-user" />
                    <Field label="Duration minutes" name="durationMinutes" type="number" defaultValue="60" min={15} max={1440} />
                    <Field className="md:col-span-2" label="Justification" name="justification" defaultValue="Bounded sandbox automation request for a validated strategy under continuous monitoring." />
                    <Field className="md:col-span-2" label="Strategy IDs, comma separated" name="strategyIds" defaultValue="strategy-1" />
                    <Field className="md:col-span-2" label="Allowed instruments, comma separated" name="allowedInstruments" defaultValue="EUR/USD" />
                    <Field label="Max risk per trade %" name="maxRiskPerTradePct" type="number" step="0.01" defaultValue="0.5" />
                    <Field label="Max daily loss" name="maxDailyLoss" type="number" step="0.01" defaultValue="100" />
                    <Field label="Max open positions" name="maxOpenPositions" type="number" defaultValue="1" />
                    <Field label="Max notional" name="maxNotional" type="number" step="0.01" defaultValue="10000" />
                    <Field label="Reference equity" name="referenceEquity" type="number" step="0.01" defaultValue="100000" />
                    <Field label="Monitoring interval seconds" name="monitoringIntervalSeconds" type="number" defaultValue="10" min={5} max={60} />
                    <div className="md:col-span-2">
                      <Button type="submit" disabled={requestApproval.isPending}>Request approval</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Review or revoke approval</CardTitle></CardHeader>
                <CardContent>
                  <form
                    className="grid gap-3 md:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const data = new FormData(form);
                      reviewApproval.mutate({
                        id: String(data.get("approvalId") ?? ""),
                        payload: {
                          reviewerId: String(data.get("reviewerId") ?? ""),
                          role: String(data.get("role") ?? ""),
                          decision: String(data.get("decision") ?? ""),
                          rationale: String(data.get("rationale") ?? ""),
                        },
                      });
                    }}
                  >
                    <Field label="Approval ID" name="approvalId" defaultValue={autonomyGovernance?.active?.id ?? autonomyGovernance?.approvals[0]?.id ?? ""} />
                    <Field label="Reviewer ID" name="reviewerId" defaultValue="risk-reviewer" />
                    <SelectField label="Role" name="role" options={["risk_officer", "compliance_officer"]} defaultValue="risk_officer" />
                    <SelectField label="Decision" name="decision" options={["approved", "rejected"]} defaultValue="approved" />
                    <Field className="md:col-span-2" label="Rationale" name="rationale" defaultValue="Reviewed against scope, limits, and sandbox-only constraints." />
                    <div className="md:col-span-2 flex flex-wrap gap-2">
                      <Button type="submit" disabled={reviewApproval.isPending}>Submit review</Button>
                    </div>
                  </form>
                  <form
                    className="mt-4 grid gap-3 md:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const data = new FormData(form);
                      revokeApproval.mutate({
                        id: String(data.get("revokeApprovalId") ?? ""),
                        payload: {
                          revokedBy: String(data.get("revokedBy") ?? ""),
                          reason: String(data.get("reason") ?? ""),
                        },
                      });
                    }}
                  >
                    <Field label="Approval ID" name="revokeApprovalId" defaultValue={autonomyGovernance?.active?.id ?? autonomyGovernance?.approvals[0]?.id ?? ""} />
                    <Field label="Revoked by" name="revokedBy" defaultValue="security-officer" />
                    <Field className="md:col-span-2" label="Reason" name="reason" defaultValue="Emergency governance revocation." />
                    <div className="md:col-span-2">
                      <Button type="submit" variant="destructive" disabled={revokeApproval.isPending}>Revoke approval</Button>
                    </div>
                  </form>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Active approval: {autonomyGovernance?.active ? `expires ${new Date(autonomyGovernance.active.expiresAt).toLocaleString()}` : "none"} · repository {autonomyGovernance?.repository.provider ?? "memory"}
                  </p>
                  {!autonomyGovernance?.approvals.length && <Empty>No semi-autonomous approval requests.</Empty>}
                  {autonomyGovernance?.approvals.slice(0, 5).map((approval) => (
                    <div key={approval.id} className="rounded-lg border p-3 text-sm">
                      <p className="font-medium text-white">{approval.status} · requested by {approval.requestedBy}</p>
                      <p className="text-muted-foreground">
                        {approval.scope.strategyIds.join(", ")} · {approval.scope.allowedInstruments.join(", ")} · {approval.reviews.length}/2 independent reviews
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          <TabsContent value="audit-exports">
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Generate export</CardTitle></CardHeader>
                <CardContent>
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const data = new FormData(form);
                      generateAuditExport.mutate({ generatedBy: String(data.get("generatedBy") ?? "") });
                      form.reset();
                    }}
                  >
                    <Field className="min-w-72" label="Generated by" name="generatedBy" defaultValue="audit-operator" />
                    <Button type="submit" disabled={generateAuditExport.isPending}>Generate export</Button>
                  </form>
                </CardContent>
              </Card>
              <Card><CardHeader><CardTitle>Audit Exports</CardTitle></CardHeader><CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Signing {auditExports?.health.signingConfigured ? "configured" : "not configured"} · external directory {auditExports?.health.exportDirectoryConfigured ? "configured" : "not configured"} · archive {auditExports?.health.archiveDirectoryConfigured ? "configured" : "not configured"} · repository {auditExports?.health.repository.provider ?? "memory"}
                </p>
                {!auditExports?.exports.length && <Empty>No audit exports generated.</Empty>}
                {auditExports?.exports.slice(0, 5).map((item) => (
                  <div key={item.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-white">{item.signatureAlgorithm} · {new Date(item.generatedAt).toLocaleString()}</p>
                        <p className="break-all text-muted-foreground">{item.artifactDigest}</p>
                        <p className="text-muted-foreground">Primary {item.storageLocation ?? "n/a"} · archive {item.archiveLocation ?? "n/a"}</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => loadAuditExport.mutate(item.id)} disabled={loadAuditExport.isPending}>
                        Verify export
                      </Button>
                    </div>
                  </div>
                ))}
                {selectedAuditExport && (
                  <div className="rounded-lg border border-dashed p-3 text-sm">
                    <p className="font-medium text-white">
                      Verification {selectedAuditExport.verification?.valid ? "passed" : "failed"} · {selectedAuditExport.record.generatedBy}
                    </p>
                    <p className="text-muted-foreground">
                      Digest {selectedAuditExport.verification?.digestValid ? "valid" : "invalid"} · signature {selectedAuditExport.verification?.signatureValid ? "valid" : "invalid"} · event chain {selectedAuditExport.verification?.eventChainValid ? "valid" : "invalid"} · audit chain {selectedAuditExport.verification?.executionAuditChainValid ? "valid" : "invalid"}
                    </p>
                    <p className="break-all text-muted-foreground">
                      Primary {selectedAuditExport.record.storageLocation ?? "n/a"} · archive {selectedAuditExport.record.archiveLocation ?? "n/a"}
                    </p>
                  </div>
                )}
              </CardContent></Card>
            </div>
          </TabsContent>
          <TabsContent value="production-resilience">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>Production Resilience</CardTitle>
                  <Badge variant={resilience?.ready ? "outline" : "destructive"}>{resilience?.ready ? "ready" : "blocked"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="text-muted-foreground">
                  Observability, incident response, disaster recovery, provider-recovery telemetry, mirrored audit exports, and emergency controls must all be present before the environment is treated as supervised-live ready.
                </p>
                <form
                  className="grid gap-3 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = new FormData(form);
                    recordResilienceEvidence.mutate({
                      category: String(data.get("category") ?? ""),
                      actorId: String(data.get("actorId") ?? ""),
                      status: String(data.get("status") ?? ""),
                      detail: String(data.get("detail") ?? ""),
                    });
                    form.reset();
                  }}
                >
                  <SelectField label="Category" name="category" options={["observability", "incident_response", "disaster_recovery", "provider_recovery", "audit_replication", "emergency_controls"]} defaultValue="incident_response" />
                  <Field label="Actor ID" name="actorId" defaultValue="execution-center-user" />
                  <SelectField label="Status" name="status" options={["configured", "acknowledged", "drilled", "verified"]} defaultValue="acknowledged" />
                  <Field className="md:col-span-2" label="Detail" name="detail" defaultValue="Recorded incident-response drill evidence and linked backup verification." />
                  <div className="md:col-span-2">
                    <Button type="submit" disabled={recordResilienceEvidence.isPending}>Record resilience evidence</Button>
                  </div>
                </form>
                <div className="grid gap-3 md:grid-cols-2">
                  {resilience?.checks.map((check) => (
                    <div key={check.id} className="rounded-lg border p-3">
                      <p className="font-medium text-white">{check.id.replaceAll("_", " ")} · {check.passed ? "pass" : "fail"}</p>
                      <p className="text-muted-foreground">{check.detail}</p>
                      {!check.passed && check.requiredAction && <p className="mt-1 text-muted-foreground">Next action: {check.requiredAction}</p>}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-dashed p-3">
                  <p className="font-medium text-white">Required actions</p>
                  {!resilience?.requiredActions.length
                    ? <p className="text-muted-foreground">No outstanding resilience actions.</p>
                    : resilience.requiredActions.map((item) => <p key={item} className="mt-1 text-muted-foreground">• {item}</p>)}
                </div>
                <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                  Provider recovery events: {resilience?.providerRecovery.length ?? 0} · generated at {resilience?.generatedAt ?? "n/a"}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest evidence</p>
                  {!resilience?.evidence.length && <Empty>No resilience evidence recorded yet.</Empty>}
                  {resilience?.evidence.slice(0, 5).map((item) => (
                    <div key={item.id} className="rounded-lg border p-3">
                      <p className="font-medium text-white">{item.category} · {item.status} · {item.actorId}</p>
                      <p className="text-muted-foreground">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="event-blackouts">
            <Card><CardHeader><CardTitle>Event Blackouts</CardTitle></CardHeader><CardContent className="space-y-2">
              {!ops?.advanced.eventBlackouts.length && <Empty>No manually configured event windows.</Empty>}
              {ops?.advanced.eventBlackouts.map((event) => (
                <p key={event.id} className="text-sm text-muted-foreground">{event.severity} · {event.title} · {new Date(event.startsAt).toLocaleString()}</p>
              ))}
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="backtests"><Info title="Backtests" detail="Spread, slippage, leverage, walk-forward splits, and Monte Carlo robustness feed the validation scorecard." /></TabsContent>
          <TabsContent value="strategy-validation"><Info title="Strategy validation" detail={`${data?.advanced.strategyValidation.length ?? 0} strategy scorecards. A verdict never authorizes live execution by itself.`} /></TabsContent>
          <TabsContent value="broker-readiness"><Info title="Broker readiness" detail={data?.advanced.brokerReadiness.readyForPaper ? "The offline paper provider is ready." : (data?.advanced.brokerReadiness.blockingReasons?.join("; ") ?? "Readiness unavailable.")} /></TabsContent>
          <TabsContent value="audit-log"><Info title="Audit log" detail={`${data?.advanced.auditLog.length ?? 0} execution events recorded with correlation IDs.`} /></TabsContent>
          <TabsContent value="circuit-breakers">
            <Card>
              <CardHeader><CardTitle>Circuit breakers</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">The global kill switch blocks every provider order path. Administrative recovery is intentionally separate.</p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="destructive" disabled={Boolean(data?.advanced.circuitBreakers.killSwitchActive) || killSwitch.isPending} onClick={() => killSwitch.mutate()}>
                    Trigger global kill switch
                  </Button>
                  <Button variant="destructive" disabled={emergency.isPending} onClick={() => emergency.mutate()}>
                    Activate all emergency controls
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function StatusCard({ icon: Icon, title, value, danger = false }: { icon: typeof Radio; title: string; value: string; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <Icon className={danger ? "text-red-400" : "text-primary"} />
        <div><p className="text-xs text-muted-foreground">{title}</p><p className="font-semibold text-white">{value}</p></div>
      </CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function buildAutonomyRoadmap(
  currentLevel: number,
  blockers: string[],
  readinessVerdict: "blocked" | "sandbox_only" | "supervised_live_ready",
) {
  const levels = [
    { level: 0, name: "disabled", description: "Automation is disabled.", blockers: ["No automation is enabled."], status: "current" },
    { level: 1, name: "signal_only", description: "Signals may be collected and scored.", blockers: ["Enable signal collection and scoring."], status: "available" },
    { level: 2, name: "paper_tracking", description: "Signals may be tracked without orders.", blockers: ["Register at least one strategy.", "Move one level at a time."], status: "available" },
    { level: 3, name: "paper_execution", description: "Approved paper entries and exits may be automated.", blockers: ["Validate at least one strategy.", "Configure constraints, monitoring, and kill switch."], status: "available" },
    { level: 4, name: "sandbox_execution", description: "Practice/demo execution requires explicit confirmation.", blockers: ["Configure a sandbox-capable broker.", "Keep explicit user confirmation available."], status: "available" },
    { level: 5, name: "supervised_live_candidate", description: "Live previews are allowed, but every order requires user confirmation.", blockers: readinessVerdict === "supervised_live_ready" ? [] : blockers.length > 0 ? blockers : ["Complete live readiness assessment."], status: "candidate" },
    { level: 6, name: "bounded_semi_autonomous_candidate", description: "Bounded semi-autonomous eligibility only; production submission remains disabled.", blockers: ["Independent semi-autonomous approval is required.", "Production submission remains disabled."], status: "eligibility only" },
  ].map((level) => ({
    ...level,
    active: level.level === currentLevel,
  }));

  const nextLevel = levels.find((level) => level.level === Math.min(6, currentLevel + 1)) ?? levels[levels.length - 1];
  return {
    currentLevel,
    currentLabel: `Level ${currentLevel} · ${levels[currentLevel]?.name ?? "unknown"}`,
    nextTargetLabel: `Level ${nextLevel.level} · ${nextLevel.name}`,
    nextBlockers: nextLevel.blockers,
    readinessState: readinessVerdict,
    levels,
  };
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium text-white">{value}</p></div>;
}

function Info({ title, detail }: { title: string; detail: string }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{detail}</CardContent></Card>;
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  min,
  max,
  step,
  className = "",
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  type?: string;
  min?: number;
  max?: number;
  step?: string | number;
  className?: string;
}) {
  return (
    <label className={`grid gap-1 text-sm ${className}`}>
      <span className="text-muted-foreground">{label}</span>
      <input
        name={name}
        type={type}
        min={min}
        max={max}
        step={step}
        defaultValue={defaultValue}
        className="rounded-md border bg-background px-3 py-2 text-sm text-white outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  options,
  defaultValue,
  className = "",
}: {
  label: string;
  name: string;
  options: string[];
  defaultValue: string;
  className?: string;
}) {
  return (
    <label className={`grid gap-1 text-sm ${className}`}>
      <span className="text-muted-foreground">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="rounded-md border bg-background px-3 py-2 text-sm text-white outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function slug(value: string) {
  return value.toLowerCase().replaceAll(" ", "-");
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function humanizeControlledLiveType(value: ControlledLiveHistoryEntry["type"]) {
  return value.replace("controlled_live.", "").replaceAll("_", " ");
}

function formatControlledLiveScope(scope: ControlledLiveHistoryScope) {
  return [
    scope.userId,
    scope.previewId ? `preview ${scope.previewId}` : null,
    scope.correlationId ? `correlation ${scope.correlationId}` : null,
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

function deriveHistoryScope(entry: ControlledLiveHistoryEntry, fallback: ControlledLiveHistoryScope): ControlledLiveHistoryScope {
  const detail = entry.detail as Record<string, unknown>;
  const previewId = typeof detail.previewId === "string"
    ? detail.previewId
    : typeof detail.orderPreviewId === "string"
      ? detail.orderPreviewId
      : fallback.previewId;
  const correlationId = typeof detail.correlationId === "string"
    ? detail.correlationId
    : entry.correlationId;
  return {
    userId: entry.userId || fallback.userId,
    previewId,
    correlationId,
  };
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function asBoolean(value: FormDataEntryValue | null) {
  return String(value) === "true";
}

function readOptionalNumber(formData: FormData, name: string) {
  const value = formData.get(name);
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readSessionJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSessionJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

function clearSessionValue(key: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(key);
}
