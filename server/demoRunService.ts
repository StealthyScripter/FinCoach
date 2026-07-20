import { randomUUID } from "crypto";
import { eventLogService } from "./eventLogService";
import { executionAuditLog } from "./execution/riskControls";
import { metricsService } from "./metricsService";
import { providerRecoveryTelemetry } from "./execution/providerRecoveryTelemetry";
import { sandboxExecutionMetrics } from "./execution/sandboxMetrics";
import { marketDataMetrics } from "./execution/marketDataMetrics";
import { paperStrategyRuntime } from "./execution/paperStrategyRuntime";
import { paperAutomationService } from "./execution/paperAutomation";
import { strategyLabService } from "./execution/strategyLabService";
import { strategyEvidenceStore } from "./execution/strategyEvidenceStore";
import { storage } from "./storage";
import { verificationQualityService } from "./verificationQualityService";
import { ToolConnectorRegistryService } from "./toolConnectorRegistryService";
import { predictionReviewService } from "./predictionReviewService";
import { portfolioRiskAnalyticsService } from "./portfolioRiskAnalyticsService";
import { demoRunRecordStore, type PersistedDemoRunRecord } from "./demoRunRecordStore";
import { strategyResearchSchedulerService } from "./strategyResearchSchedulerService";
import type {
  DemoRunAdjustment,
  DemoRunDailyReport,
  DemoRunExportPayload,
  DemoRunFinalReport,
  DemoRunMode,
  DemoRunState,
  DemoRunStatus,
  DemoRunTelemetry,
  DemoRunResearchPipelineSummary,
} from "@shared/demoRun";

const DEMO_ALLOWED_SYMBOLS = ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD"];
const TELEMETRY_VERSION = "marketpilot-demo-run-v1";
const MAX_DAILY_REPORTS = 7;

type DemoRunRecord = {
  runId: string;
  mode: DemoRunMode;
  state: DemoRunState;
  startTime: string;
  endTime: string | null;
  pausedAt: string | null;
  allowedSymbols: string[];
  allowedStrategies: string[];
  connectedProviders: string[];
  riskLimits: {
    maxDailyLoss: number;
    maxOpenPositions: number;
    maxTradesPerDay: number;
    confidenceThreshold: number;
  };
  dailyReports: DemoRunDailyReport[];
  adjustments: DemoRunAdjustment[];
  screenVisits: Map<string, number>;
  finalReport: DemoRunFinalReport | null;
};

type DemoRunContext = {
  overview: Awaited<ReturnType<typeof storage.getMarketPilotOverview>>;
  verificationQuality: ReturnType<typeof verificationQualityService.evaluate>;
  connectors: ReturnType<ToolConnectorRegistryService["snapshot"]>["connectors"];
  lab: ReturnType<typeof strategyLabService.build>;
  telemetry: DemoRunTelemetry;
  currentPnL: number;
  allowedStrategies: string[];
  connectedProviders: string[];
  reliabilityFailures: string[];
};

export class DemoRunService {
  private record: DemoRunRecord | null = null;
  private hydrated = false;
  private hydratePromise: Promise<void> | null = null;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async start(now = new Date()) {
    await this.hydrateFromPersistence();
    if (this.record && (this.record.state === "running" || this.record.state === "paused")) {
      return this.status(now);
    }
    const context = await this.collectContext(now);
    this.record = {
      runId: randomUUID(),
      mode: "demo_observation",
      state: "running",
      startTime: now.toISOString(),
      endTime: null,
      pausedAt: null,
      allowedSymbols: [...DEMO_ALLOWED_SYMBOLS],
      allowedStrategies: [],
      connectedProviders: context.connectedProviders,
      riskLimits: {
        maxDailyLoss: 250,
        maxOpenPositions: 2,
        maxTradesPerDay: 5,
        confidenceThreshold: 60,
      },
      dailyReports: [],
      adjustments: [],
      screenVisits: new Map<string, number>(),
      finalReport: null,
    };
    await this.persistRecord();
    this.appendEvent("demo.run_started", {
      runId: this.record.runId,
      mode: this.record.mode,
      allowedSymbols: this.record.allowedSymbols,
      allowedStrategies: this.record.allowedStrategies,
      connectedProviders: this.record.connectedProviders,
      productionLiveExecutionBlocked: true,
    }, "started", now);
    return this.status(now);
  }

  async pause(reason = "manual pause", now = new Date()) {
    await this.hydrateFromPersistence();
    const record = this.requireActive();
    if (record.state === "paused") return this.status(now);
    record.state = "paused";
    record.pausedAt = now.toISOString();
    await this.persistRecord();
    this.appendEvent("demo.run_paused", {
      runId: record.runId,
      reason,
      productionLiveExecutionBlocked: true,
    }, "accepted", now);
    return this.status(now);
  }

  async resume(reason = "manual resume", now = new Date()) {
    await this.hydrateFromPersistence();
    const record = this.requireActive();
    if (record.state === "running") return this.status(now);
    record.state = "running";
    record.pausedAt = null;
    await this.persistRecord();
    this.appendEvent("demo.run_resumed", {
      runId: record.runId,
      reason,
      productionLiveExecutionBlocked: true,
    }, "accepted", now);
    return this.status(now);
  }

  async stop(reason = "manual stop", now = new Date()) {
    await this.hydrateFromPersistence();
    const record = this.requireActive();
    record.state = "stopped";
    record.endTime = now.toISOString();
    const finalReport = await this.generateFinalReport(now, reason);
    record.finalReport = finalReport;
    await this.persistRecord();
    this.appendEvent("demo.run_stopped", {
      runId: record.runId,
      reason,
      productionLiveExecutionBlocked: true,
    }, "accepted", now);
    return this.status(now);
  }

  async recordScreenVisit(screen: string, now = new Date()) {
    await this.hydrateFromPersistence();
    const record = this.record;
    if (!record || record.state === "stopped" || record.state === "completed") return;
    const normalized = normalizeScreen(screen);
    record.screenVisits.set(normalized, (record.screenVisits.get(normalized) ?? 0) + 1);
    await this.persistRecord();
    eventLogService.append({
      type: "demo.screen_visited",
      userId: "system",
      sourceService: "demo-run-service",
      payload: {
        runId: record.runId,
        screen: normalized,
        path: screen,
        productionLiveExecutionBlocked: true,
      },
      createdAt: now.toISOString(),
    });
  }

  async triggerDailyEvaluation(now = new Date()) {
    await this.hydrateFromPersistence();
    const record = this.requireActive();
    const report = await this.dailyEvaluation(now);
    record.dailyReports = upsertDailyReport(record.dailyReports, report);
    if (record.dailyReports.length > MAX_DAILY_REPORTS) record.dailyReports = record.dailyReports.slice(-MAX_DAILY_REPORTS);
    const adjustments = await this.applyAutoAdjustments(report, now);
    await this.persistRecord();
    this.appendEvent("demo.run_daily_evaluated", {
      runId: record.runId,
      day: report.day,
      reliabilityScore: report.reliabilityScore,
      safetyScore: report.safetyScore,
      usabilityScore: report.usabilityScore,
      calibrationScore: report.calibrationScore,
      strategyPerformanceScore: report.strategyPerformanceScore,
      riskScore: report.riskScore,
      recommendedChanges: report.recommendedChanges,
      productionLiveExecutionBlocked: true,
    }, "created", now);
    return this.status(now);
  }

  async dailyEvaluation(now = new Date()): Promise<DemoRunDailyReport> {
    await this.hydrateFromPersistence();
    const context = await this.collectContext(now);
    const telemetry = context.telemetry;
    const day = this.dayNumber(now);
    const report = {
      day,
      date: now.toISOString().slice(0, 10),
      reliabilityScore: computeReliabilityScore(telemetry),
      safetyScore: computeSafetyScore(telemetry),
      usabilityScore: computeUsabilityScore(telemetry),
      calibrationScore: computeCalibrationScore(context),
      strategyPerformanceScore: computeStrategyPerformanceScore(context),
      riskScore: computeRiskScore(context),
      recommendedChanges: this.recommendChanges(context),
      topStrategies: context.lab.topStrategies.map((item) => item.strategyName).slice(0, 3),
      weakStrategies: context.lab.weakStrategies.map((item) => item.strategyName).slice(0, 3),
      retirementCandidates: context.lab.retirementCandidates.map((item) => item.strategyName).slice(0, 3),
    } satisfies DemoRunDailyReport;
    const record = this.record;
    if (record) {
      record.dailyReports = upsertDailyReport(record.dailyReports, report);
      await this.persistRecord();
    }
    return report;
  }

  async report(now = new Date()) {
    await this.hydrateFromPersistence();
    const record = this.record;
    if (!record) {
      return this.generateEmptyReport(now);
    }
    if (!record.finalReport && record.state === "stopped") {
      record.finalReport = await this.generateFinalReport(now, "Stopped before completion");
      await this.persistRecord();
    }
    await this.ensureDailyEvaluation(now);
    return record.finalReport ?? this.generatePreliminaryReport(now);
  }

  async export(now = new Date()): Promise<DemoRunExportPayload> {
    const finalReport = await this.report(now);
    const status = await this.status(now);
    const telemetry = await this.telemetry(now);
    return {
      generatedAt: now.toISOString(),
      status,
      telemetry,
      finalReport,
    };
  }

  async telemetry(now = new Date()): Promise<DemoRunTelemetry> {
    await this.hydrateFromPersistence();
    const context = await this.collectContext(now);
    return context.telemetry;
  }

  async status(now = new Date()): Promise<DemoRunStatus> {
    await this.hydrateFromPersistence();
    const context = await this.collectContext(now);
    const record = this.record;
    const latestDailyReport = record?.dailyReports[record.dailyReports.length - 1] ?? null;
    const topAdjustment = record?.adjustments[0] ?? null;
    const telemetrySummary = latestDailyReport
      ? {
          reliabilityScore: latestDailyReport.reliabilityScore,
          safetyScore: latestDailyReport.safetyScore,
          usabilityScore: latestDailyReport.usabilityScore,
          calibrationScore: latestDailyReport.calibrationScore,
          strategyPerformanceScore: latestDailyReport.strategyPerformanceScore,
          riskScore: latestDailyReport.riskScore,
        }
      : summarizeTelemetry(context.telemetry);
    return {
      runId: record?.runId ?? null,
      mode: "demo_observation",
      state: record?.state ?? "idle",
      startTime: record?.startTime ?? null,
      endTime: record?.endTime ?? null,
      pausedAt: record?.pausedAt ?? null,
      uptimeSeconds: Math.max(0, Math.round(((record ? Date.parse(record.endTime ?? now.toISOString()) : now.getTime()) - (record ? Date.parse(record.startTime) : now.getTime())) / 1000)),
      dayCount: record ? this.dayNumber(now) : 0,
      connectedProviders: record?.connectedProviders ?? context.connectedProviders,
      allowedStrategies: record?.allowedStrategies ?? context.allowedStrategies,
      allowedSymbols: record?.allowedSymbols ?? [...DEMO_ALLOWED_SYMBOLS],
      riskLimits: record?.riskLimits ?? {
        maxDailyLoss: 250,
        maxOpenPositions: 2,
        maxTradesPerDay: 5,
        confidenceThreshold: 60,
      },
      modeConfigured: this.env.MARKETPILOT_RUN_MODE?.trim() === "demo_observation",
      productionLiveExecutionBlocked: true,
      telemetryVersion: TELEMETRY_VERSION,
      telemetrySummary,
      currentPnL: context.currentPnL,
      blockedActions: this.blockedActions(context),
      topAdjustment,
      latestDailyReport,
      researchPipeline: summarizeResearchPipeline(),
    };
  }

  getMode() {
    return this.env.MARKETPILOT_RUN_MODE?.trim() === "demo_observation";
  }

  private async ensureDailyEvaluation(now: Date) {
    const record = this.record;
    if (!record || record.state === "idle" || record.state === "stopped" || record.state === "completed") return;
    const normalizedDailyReports = normalizeDailyReports(record.dailyReports);
    if (normalizedDailyReports.length !== record.dailyReports.length) {
      record.dailyReports = normalizedDailyReports;
      await this.persistRecord();
    }
    const day = this.dayNumber(now);
    const existing = record.dailyReports.find((report) => report.day === day);
    if (!existing && record.dailyReports.length < MAX_DAILY_REPORTS) {
      await this.triggerDailyEvaluation(now);
    }
    if (this.isComplete(now)) {
      record.state = "completed";
      record.endTime = record.endTime ?? now.toISOString();
      record.finalReport = await this.generateFinalReport(now, "7-day demo run completed");
      await this.persistRecord();
      this.appendEvent("demo.run_stopped", {
        runId: record.runId,
        reason: "7-day demo run completed",
        productionLiveExecutionBlocked: true,
      }, "accepted", now);
    }
  }

  private async generateFinalReport(now: Date, exitReason: string): Promise<DemoRunFinalReport> {
    const context = await this.collectContext(now);
    const adjustments = this.record?.adjustments ?? [];
    const dailyReports = this.record?.dailyReports ?? [];
    const finalReport: DemoRunFinalReport = {
      generatedAt: now.toISOString(),
      runId: this.record?.runId ?? null,
      mode: "demo_observation",
      state: this.record?.state ?? "idle",
      dayCount: dailyReports.length,
      whatWorked: [
        ...context.lab.topStrategies.map((item) => `${item.strategyName}: ${item.verdict}`),
        context.telemetry.tradingPerformance.pl >= 0 ? "Risk controls kept the run profitable or near-flat." : "Losses were constrained in demo-only execution.",
      ].slice(0, 5),
      whatFailed: [
        ...context.lab.weakStrategies.map((item) => `${item.strategyName}: ${item.verdict}`),
        ...context.reliabilityFailures.slice(0, 2),
      ].slice(0, 5),
      unsafePatterns: [
        ...context.lab.performanceDecay.items.filter((item) => item.verdict === "pause" || item.verdict === "retire").map((item) => `${item.strategyName}: ${item.reasons[0] ?? item.verdict}`),
        ...this.blockedActions(context),
      ].slice(0, 5),
      bestStrategies: context.lab.topStrategies.map((item) => `${item.strategyName} (${item.overallScore})`).slice(0, 5),
      weakStrategies: context.lab.weakStrategies.map((item) => `${item.strategyName} (${item.overallScore})`).slice(0, 5),
      missedOpportunities: rejectedSignalSummaries(context, "missedOpportunity"),
      avoidedLosses: rejectedSignalSummaries(context, "avoidedLoss"),
      confidenceCalibrationResults: context.lab.confidenceCalibration.confidenceAdjustmentSuggestions.slice(0, 5),
      nextDeploymentRecommendation: exitReason.includes("completed")
        ? "Proceed to the next controlled test only if the risk and telemetry trends remain stable."
        : "Keep the system in demo_observation until the weak strategies and telemetry gaps are addressed.",
      dailyReports,
      adjustments,
      telemetrySummary: summarizeTelemetry(context.telemetry),
    };
    return finalReport;
  }

  private async generatePreliminaryReport(now: Date): Promise<DemoRunFinalReport> {
    const context = await this.collectContext(now);
    return {
      generatedAt: now.toISOString(),
      runId: this.record?.runId ?? null,
      mode: "demo_observation",
      state: this.record?.state ?? "idle",
      dayCount: this.record?.dailyReports.length ?? 0,
      whatWorked: ["Preliminary report only; continue the 7-day demo run."],
      whatFailed: ["Final 7-day evidence is not ready yet."],
      unsafePatterns: this.blockedActions(context),
      bestStrategies: context.lab.topStrategies.map((item) => `${item.strategyName} (${item.overallScore})`).slice(0, 5),
      weakStrategies: context.lab.weakStrategies.map((item) => `${item.strategyName} (${item.overallScore})`).slice(0, 5),
      missedOpportunities: rejectedSignalSummaries(context, "missedOpportunity"),
      avoidedLosses: rejectedSignalSummaries(context, "avoidedLoss"),
      confidenceCalibrationResults: context.lab.confidenceCalibration.confidenceAdjustmentSuggestions.slice(0, 5),
      nextDeploymentRecommendation: "Keep observing until the 7-day window finishes.",
      dailyReports: this.record?.dailyReports ?? [],
      adjustments: this.record?.adjustments ?? [],
      telemetrySummary: summarizeTelemetry(context.telemetry),
    };
  }

  private async generateEmptyReport(now: Date): Promise<DemoRunFinalReport> {
    const telemetry = await this.telemetry(now);
    return {
      generatedAt: now.toISOString(),
      runId: null,
      mode: "demo_observation",
      state: "idle",
      dayCount: 0,
      whatWorked: [],
      whatFailed: ["Demo run has not started yet."],
      unsafePatterns: [],
      bestStrategies: [],
      weakStrategies: [],
      missedOpportunities: [],
      avoidedLosses: [],
      confidenceCalibrationResults: [],
      nextDeploymentRecommendation: "Start the demo run before expecting telemetry or strategy evidence.",
      dailyReports: [],
      adjustments: [],
      telemetrySummary: summarizeTelemetry(telemetry),
    };
  }

  private async collectContext(now: Date): Promise<DemoRunContext> {
    const overview = await storage.getMarketPilotOverview();
    const verificationQuality = verificationQualityService.evaluate(overview);
    const connectors = new ToolConnectorRegistryService(this.env).snapshot();
    const lab = await this.buildStrategyLabSnapshot(overview, now);
    const telemetry = await this.buildTelemetry(now, overview, connectors.connectors, lab);
    const reliabilityFailures = [
      ...providerRecoveryTelemetry.list()
        .filter((item) => item.failures > 0)
        .map((item) => `${item.provider} ${item.operation}: ${item.failures} failures`),
      ...this.findAuditEntries("sandbox.account.sync", "rejected").map((entry) => `Sandbox sync failed: ${String(entry.detail.provider ?? "unknown")}`),
    ];
    const currentPnL = paperStrategyRuntime.listOpen().reduce((sum, trade) => sum + trade.unrealizedPnL, 0)
      + paperStrategyRuntime.listClosed().reduce((sum, trade) => sum + trade.realizedPnL, 0);
    return {
      overview,
      verificationQuality,
      connectors: connectors.connectors,
      lab,
      telemetry,
      currentPnL: round(currentPnL),
      allowedStrategies: paperAutomationService.listStrategies().map((strategy) => strategy.name),
      connectedProviders: connectors.connectors
        .filter((connector) => connector.enabled && connector.health === "healthy")
        .map((connector) => connector.name),
      reliabilityFailures,
    };
  }

  private async buildTelemetry(now: Date, overview: DemoRunContext["overview"], connectors: DemoRunContext["connectors"], lab: DemoRunContext["lab"]): Promise<DemoRunTelemetry> {
    const auditEntries = executionAuditLog.list();
    const events = eventLogService.list(2000);
    const metrics = metricsService.snapshot({
      overview,
      verificationQuality: verificationQualityService.evaluate(overview),
      now,
    });
    const telemetry: DemoRunTelemetry = {
      generatedAt: now.toISOString(),
      runId: this.record?.runId ?? null,
      state: this.record?.state ?? "idle",
      uptimeSeconds: this.record ? Math.max(0, Math.round((now.getTime() - Date.parse(this.record.startTime)) / 1000)) : 0,
      reliability: {
        uptimeSeconds: this.record ? Math.max(0, Math.round((now.getTime() - Date.parse(this.record.startTime)) / 1000)) : 0,
        requestCount: metrics.requestCount,
        errorCount: auditEntries.filter((entry) => entry.outcome === "rejected" || /failed/i.test(entry.action)).length,
        failedProviderCalls: providerRecoveryTelemetry.list().reduce((sum, item) => sum + item.failures, 0),
        staleDataEvents: auditEntries.filter((entry) => /stale/i.test(JSON.stringify(entry.detail))).length,
        reconnectEvents: providerRecoveryTelemetry.list().reduce((sum, item) => sum + item.recovered, 0),
        webhookFailures: events.filter((event) => event.type === "telegram.command_rejected" && /webhook/i.test(JSON.stringify(event.payload))).length,
        telegramCommandFailures: events.filter((event) => event.type === "telegram.command_rejected").length,
        brokerSyncFailures: auditEntries.filter((entry) => entry.action === "sandbox.account.sync" && entry.outcome === "rejected").length,
      },
      safety: {
        killSwitchEvents: auditEntries.filter((entry) => entry.action.includes("kill_switch") || /kill switch/i.test(JSON.stringify(entry.detail))).length,
        blockedOrders: auditEntries.filter((entry) => entry.action.includes("order") && entry.outcome === "blocked").length,
        rejectedSignals: strategyEvidenceStore.analyzeRejectedSignals().length,
        riskPrecheckFailures: auditEntries.filter((entry) => /risk precheck|precheck/i.test(entry.action) || /risk precheck/i.test(JSON.stringify(entry.detail))).length,
        staleDataBlocks: auditEntries.filter((entry) => /stale/i.test(JSON.stringify(entry.detail))).length,
        dailyLossBlocks: auditEntries.filter((entry) => /daily loss/i.test(JSON.stringify(entry.detail))).length,
        confirmationFailures: events.filter((event) => event.type === "telegram.command_rejected" && JSON.stringify(event.payload).includes("Confirmation")).length,
        unauthorizedTelegramAttempts: events.filter((event) => event.type === "telegram.command_rejected" && JSON.stringify(event.payload).includes("Unauthorized Telegram user")).length,
      },
      usability: {
        telegramCommandsUsed: events.filter((event) => event.type === "telegram.command_requested" || event.type === "telegram.command_confirmed" || event.type === "telegram.command_rejected").length,
        askMarketPilotPrompts: events.filter((event) => event.type === "market.explanation_generated").length,
        commandSuccessCount: events.filter((event) => event.type === "telegram.command_requested").length + events.filter((event) => event.type === "telegram.command_confirmed").length,
        commandFailureCount: events.filter((event) => event.type === "telegram.command_rejected").length,
        repeatedUserActions: summarizeRepeatedActions(events),
        abandonedConfirmationFlows: countAbandonedConfirmations(events, now),
        mostUsedScreens: summarizeScreens(events),
        alertOverloadCount: Math.max(0, events.filter((event) => event.type === "telegram.alert_sent").length - 12),
      },
      calibration: {
        predictionConfidence: lab.confidenceCalibration.expectedAccuracy * 100,
        actualOutcome: lab.confidenceCalibration.observedAccuracy * 100,
        confidenceDrift: lab.confidenceCalibration.calibrationDrift * 100,
        falsePositives: lab.confidenceCalibration.items.filter((item) => item.wasOverconfident).length,
        falseNegatives: lab.confidenceCalibration.items.filter((item) => !item.wasOverconfident && item.confidence < 50).length,
        strategyWinLoss: summarizeWinLoss(paperStrategyRuntime.listClosed()),
        regretAnalysis: {
          regretScore: lab.regretAnalysis.regretScore,
          items: lab.regretAnalysis.items.reduce((sum, item) => sum + item.count, 0),
        },
        counterfactualResults: lab.counterfactualAnalysis.items.reduce((sum, item) => sum + item.scenarios.length, 0),
        performanceDecay: lab.performanceDecay.items.filter((item) => item.verdict === "pause" || item.verdict === "retire").length,
      },
      tradingPerformance: {
        tradesOpened: paperStrategyRuntime.listOpen().length + paperStrategyRuntime.listClosed().length,
        tradesClosed: paperStrategyRuntime.listClosed().length,
        pl: round(paperStrategyRuntime.listClosed().reduce((sum, trade) => sum + trade.realizedPnL, 0) + paperStrategyRuntime.listOpen().reduce((sum, trade) => sum + trade.unrealizedPnL, 0)),
        winRate: tradeWinRate(paperStrategyRuntime.listClosed()),
        expectancy: tradeExpectancy(paperStrategyRuntime.listClosed()),
        maxDrawdown: portfolioRiskAnalyticsService.analyze(overview.portfolio).maxDrawdownPct,
        sharpeEstimate: estimateSharpe(paperStrategyRuntime.listClosed()),
        sortinoEstimate: estimateSortino(paperStrategyRuntime.listClosed()),
        riskReward: estimateRiskReward(paperStrategyRuntime.listClosed()),
        averageRMultiple: averageRMultiple(paperStrategyRuntime.listClosed()),
        bestTrade: paperStrategyRuntime.listClosed()[0] ? `${paperStrategyRuntime.listClosed()[0].symbol} ${paperStrategyRuntime.listClosed()[0].realizedPnL}` : null,
        worstTrade: [...paperStrategyRuntime.listClosed()].sort((left, right) => left.realizedPnL - right.realizedPnL)[0]
          ? `${[...paperStrategyRuntime.listClosed()].sort((left, right) => left.realizedPnL - right.realizedPnL)[0].symbol} ${[...paperStrategyRuntime.listClosed()].sort((left, right) => left.realizedPnL - right.realizedPnL)[0].realizedPnL}`
          : null,
        strategyPerformance: lab.topStrategies.slice(0, 5).map((item) => ({
          strategyId: item.strategyId,
          strategyName: item.strategyName,
          score: item.overallScore,
          verdict: item.verdict,
        })),
      },
      dailyReports: this.record?.dailyReports ?? [],
      adjustments: this.record?.adjustments ?? [],
      researchPipeline: summarizeResearchPipeline(),
    };
    return telemetry;
  }

  private async applyAutoAdjustments(report: DemoRunDailyReport, now: Date) {
    if (this.env.MARKETPILOT_RUN_MODE?.trim() !== "demo_observation") return [];
    const lab = await this.buildStrategyLabSnapshot(await storage.getMarketPilotOverview(), now);
    const adjustments: DemoRunAdjustment[] = [];
    const candidates = [
      ...lab.weakStrategies.slice(0, 2),
      ...lab.retirementCandidates.slice(0, 2),
    ];
    for (const candidate of candidates) {
      const strategy = paperAutomationService.getStrategy(candidate.strategyId);
      if (!strategy) continue;
      if (candidate.verdict === "retire" || candidate.verdict === "pause" || candidate.overallScore < 45) {
        if (strategy.enabled) {
          const before = strategy;
          const after = paperAutomationService.updateStrategy(strategy.id, { enabled: false });
          adjustments.push(this.makeAdjustment(strategy.id, "disable_strategy", `${strategy.name} is weak enough to pause in demo mode.`, before, after, now));
        }
        continue;
      }
      const tightenedRisk = Math.max(0.1, round(strategy.riskPerTradePct * 0.8, 2));
      const lowerTradeLimit = Math.max(1, strategy.maxTradesPerDay - 1);
      if (tightenedRisk < strategy.riskPerTradePct || lowerTradeLimit < strategy.maxTradesPerDay) {
        const before = strategy;
        const after = paperAutomationService.updateStrategy(strategy.id, {
          riskPerTradePct: tightenedRisk < strategy.riskPerTradePct ? tightenedRisk : undefined,
          maxTradesPerDay: lowerTradeLimit < strategy.maxTradesPerDay ? lowerTradeLimit : undefined,
        });
        adjustments.push(this.makeAdjustment(strategy.id, "reduce_position_size", `Reduced demo risk after ${candidate.verdict} evidence.`, before, after, now));
      }
    }
    const shouldReduceAlertNoise = report.usabilityScore < 70
      && report.recommendedChanges.some((change) => /telegram|alert/i.test(change));
    if (shouldReduceAlertNoise && this.record) {
      adjustments.push(this.makeAdjustment(null, "mark_watch_candidate", "Telegram alert or command noise is elevated. Prefer the digest path.", {}, { alertPolicy: "digest-first" }, now));
    }
    if (this.record) {
      this.record.adjustments = [...adjustments, ...this.record.adjustments].slice(0, 25);
      await this.persistRecord();
    }
    for (const adjustment of adjustments) {
      this.appendEvent("demo.run_adjusted", {
        runId: this.record?.runId ?? null,
        adjustmentId: adjustment.id,
        kind: adjustment.kind,
        strategyId: adjustment.strategyId,
        reason: adjustment.reason,
        before: adjustment.before,
        after: adjustment.after,
        rollback: adjustment.rollback,
        productionLiveExecutionBlocked: true,
      }, "created", now);
    }
    return adjustments;
  }

  private makeAdjustment(strategyId: string | null, kind: DemoRunAdjustment["kind"], reason: string, before: Record<string, unknown>, after: Record<string, unknown>, now: Date): DemoRunAdjustment {
    return {
      id: randomUUID(),
      strategyId,
      kind,
      reason,
      before,
      after,
      rollback: {
        possible: true,
        before,
      },
      createdAt: now.toISOString(),
      applied: true,
    };
  }

  private async buildStrategyLabSnapshot(overview: Awaited<ReturnType<typeof storage.getMarketPilotOverview>>, now = new Date()) {
    const strategies = paperAutomationService.listStrategies();
    const validations = paperAutomationService.listStrategyValidations();
    const validationInputs = paperAutomationService.listStrategyValidationInputs();
    const closedTrades = paperStrategyRuntime.listClosed();
    const postTradeReviews = await import("./execution/postTradeReviewService").then((module) => module.postTradeReviewService.list());
    const predictionReviews = predictionReviewService.listReviews();
    const journalReviews = await storage.getJournalReviews();
    const adaptations = await import("./execution/strategyAdaptationService").then((module) => module.strategyAdaptationService.list());
    const lifecycleReports = await import("./execution/strategyLifecycleMonitorService").then((module) => module.strategyLifecycleMonitorService.list());
    const evidenceRecords = strategyEvidenceStore.snapshot().records;
    const rejectedSignalAnalyses = strategyEvidenceStore.snapshot().rejectedSignals;
    return strategyLabService.build({
      strategies,
      validationInputs,
      scorecards: validations,
      closedTrades,
      postTradeReviews,
      predictionReviews,
      journalReviews,
      adaptations,
      lifecycleReports,
      evidenceRecords,
      rejectedSignalAnalyses,
    }, now);
  }

  private blockedActions(context: DemoRunContext) {
    const blocked = [
      context.telemetry.safety.killSwitchEvents > 0 ? "all execution while kill switch is active" : null,
      context.telemetry.safety.staleDataBlocks > 0 ? "new signals while data freshness is below threshold" : null,
      context.telemetry.safety.dailyLossBlocks > 0 ? "new trades after daily loss limits" : null,
      context.telemetry.usability.alertOverloadCount > 0 ? "non-critical Telegram pushes during alert overload" : null,
    ].filter((item): item is string => Boolean(item));
    return blocked.length > 0 ? blocked : ["live account execution"];
  }

  private recommendChanges(context: DemoRunContext) {
    const changes = [...context.lab.learningPriorities.items.slice(0, 2).map((item) => item.explanation)];
    if (context.telemetry.safety.staleDataBlocks > 0) changes.push("Tighten freshness checks before allowing new demo signals.");
    if (context.telemetry.usability.alertOverloadCount > 0) changes.push("Reduce Telegram alert frequency or move more alerts into the digest.");
    if (context.telemetry.calibration.confidenceDrift > 10) changes.push("Raise the confidence threshold for demo entries.");
    if (context.lab.retirementCandidates.length > 0) changes.push("Pause or retire the weakest strategies until evidence improves.");
    return changes.slice(0, 5);
  }

  private appendEvent(type: Parameters<typeof eventLogService.append>[0]["type"], payload: Record<string, unknown>, outcome: "started" | "accepted" | "created", now = new Date()) {
    eventLogService.append({
      type,
      userId: "system",
      sourceService: "demo-run-service",
      payload: {
        ...payload,
        productionLiveExecutionBlocked: true,
      },
      createdAt: now.toISOString(),
    });
    executionAuditLog.append({
      action: type,
      outcome: outcome === "started" ? "created" : outcome,
      correlationId: String(payload.runId ?? payload.adjustmentId ?? randomUUID()),
      detail: {
        ...payload,
        productionLiveExecutionBlocked: true,
      },
    });
  }

  private requireActive() {
    if (!this.record) throw new Error("Demo run has not started");
    return this.record;
  }

  private isComplete(now: Date) {
    if (!this.record) return false;
    return (now.getTime() - Date.parse(this.record.startTime)) >= 7 * 24 * 60 * 60 * 1000;
  }

  private dayNumber(now: Date) {
    if (!this.record) return 0;
    return Math.min(
      MAX_DAILY_REPORTS,
      Math.max(1, Math.floor((now.getTime() - Date.parse(this.record.startTime)) / (24 * 60 * 60 * 1000)) + 1),
    );
  }

  private findAuditEntries(action: string, outcome?: string) {
    return executionAuditLog.list().filter((entry) => entry.action === action && (!outcome || entry.outcome === outcome));
  }

  private async hydrateFromPersistence() {
    if (this.hydrated || this.record) return;
    if (!this.hydratePromise) {
      this.hydratePromise = (async () => {
        const persisted = await demoRunRecordStore.loadLatest();
        if (persisted && !this.record) {
          this.record = {
            ...persisted,
            dailyReports: normalizeDailyReports(persisted.dailyReports as DemoRunDailyReport[]),
            adjustments: persisted.adjustments as DemoRunAdjustment[],
            screenVisits: new Map(persisted.screenVisits),
            finalReport: persisted.finalReport as DemoRunFinalReport | null,
          };
        }
        this.hydrated = true;
      })().finally(() => {
        this.hydratePromise = null;
      });
    }
    await this.hydratePromise;
  }

  private async persistRecord() {
    if (!this.record) return;
    const payload: PersistedDemoRunRecord = {
      ...this.record,
      screenVisits: Array.from(this.record.screenVisits.entries()),
    };
    await demoRunRecordStore.save(payload);
  }
}

function summarizeResearchPipeline(): DemoRunResearchPipelineSummary {
  const status = strategyResearchSchedulerService.snapshot();
  return {
    status: status.health.status,
    reason: status.lastSkipReason,
    cyclesRun: status.health.cyclesRun,
    patternsDetected: status.counts.patternsDetected,
    hypothesesCreated: status.counts.hypothesesCreated,
    experimentsCreated: status.counts.experimentsCreated,
    backtestsRun: status.counts.backtestsRun,
    validationsRun: status.counts.validationsRun,
    promoted: status.counts.promoted,
    forwardTestsStarted: status.counts.forwardTestsStarted,
    journalEntriesCreated: status.counts.journalEntriesCreated,
    rejected: status.counts.rejected,
    weakRejectedCount: status.counts.weakRejectedCount,
    insufficientDataCount: status.counts.insufficientDataCount,
    promotedWithFullEvidenceCount: status.counts.promotedWithFullEvidenceCount,
    promotedWithoutFullEvidenceCount: status.counts.promotedWithoutFullEvidenceCount,
    latestRejectionReasons: status.latestRejectionReasons,
    latestRunAt: status.lastRunAt,
  };
}

function summarizeRepeatedActions(events: ReturnType<typeof eventLogService.list>) {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.type.startsWith("telegram.")) continue;
    const intent = asRecord(event.payload.intent);
    const command = String(event.payload.command ?? intent?.kind ?? event.payload.screen ?? "telegram");
    counts.set(command, (counts.get(command) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([action, count]) => ({ action, count }));
}

function rejectedSignalSummaries(
  context: DemoRunContext,
  flag: "missedOpportunity" | "avoidedLoss",
) {
  return context.lab.rejectedSignalLearning
    .flatMap((group) => group.signals)
    .filter((signal) => signal[flag])
    .map((signal) => `${signal.symbol}: ${signal.ruleImprovementSuggestion}`)
    .slice(0, 5);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function summarizeScreens(events: ReturnType<typeof eventLogService.list>) {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "demo.screen_visited") continue;
    const screen = String(event.payload.screen ?? "unknown");
    counts.set(screen, (counts.get(screen) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([screen, count]) => ({ screen, count }));
}

function countAbandonedConfirmations(events: ReturnType<typeof eventLogService.list>, now: Date) {
  const requested = events.filter((event) => event.type === "telegram.command_requested" && event.payload.confirmationStatus === "requested");
  let abandoned = 0;
  for (const event of requested) {
    const related = events.filter((candidate) => candidate.correlationId === event.correlationId);
    const hasResolution = related.some((candidate) => candidate.type === "telegram.command_confirmed" || candidate.type === "telegram.command_rejected");
    if (hasResolution) continue;
    const ageMs = now.getTime() - Date.parse(event.createdAt);
    if (ageMs > 10 * 60 * 1000) abandoned += 1;
  }
  return abandoned;
}

function summarizeWinLoss(trades: Awaited<ReturnType<typeof paperStrategyRuntime.listClosed>>) {
  const wins = trades.filter((trade) => trade.realizedPnL > 0).length;
  const losses = trades.filter((trade) => trade.realizedPnL < 0).length;
  return { wins, losses };
}

function tradeWinRate(trades: Awaited<ReturnType<typeof paperStrategyRuntime.listClosed>>) {
  if (trades.length === 0) return 0;
  return round((trades.filter((trade) => trade.realizedPnL > 0).length / trades.length) * 100);
}

function tradeExpectancy(trades: Awaited<ReturnType<typeof paperStrategyRuntime.listClosed>>) {
  if (trades.length === 0) return 0;
  return round(trades.reduce((sum, trade) => sum + trade.realizedPnL, 0) / trades.length);
}

function estimateSharpe(trades: Awaited<ReturnType<typeof paperStrategyRuntime.listClosed>>) {
  if (trades.length < 2) return 0;
  const returns = trades.map((trade) => trade.realizedPnL / Math.max(1, trade.riskTaken));
  return round(mean(returns) / Math.max(0.01, stddev(returns)) * Math.sqrt(12));
}

function estimateSortino(trades: Awaited<ReturnType<typeof paperStrategyRuntime.listClosed>>) {
  if (trades.length < 2) return 0;
  const returns = trades.map((trade) => trade.realizedPnL / Math.max(1, trade.riskTaken));
  const downside = returns.filter((value) => value < 0);
  return round(mean(returns) / Math.max(0.01, stddev(downside.length > 0 ? downside : [0])) * Math.sqrt(12));
}

function estimateRiskReward(trades: Awaited<ReturnType<typeof paperStrategyRuntime.listClosed>>) {
  const wins = trades.filter((trade) => trade.realizedPnL > 0).reduce((sum, trade) => sum + trade.realizedPnL, 0);
  const losses = Math.abs(trades.filter((trade) => trade.realizedPnL < 0).reduce((sum, trade) => sum + trade.realizedPnL, 0));
  if (losses === 0) return wins > 0 ? 99 : 0;
  return round(wins / losses);
}

function averageRMultiple(trades: Awaited<ReturnType<typeof paperStrategyRuntime.listClosed>>) {
  if (trades.length === 0) return 0;
  return round(trades.reduce((sum, trade) => sum + trade.realizedPnL / Math.max(1, trade.riskTaken), 0) / trades.length);
}

function computeReliabilityScore(telemetry: DemoRunTelemetry) {
  return clampScore(100 - telemetry.reliability.failedProviderCalls * 6 - telemetry.reliability.webhookFailures * 4 - telemetry.reliability.telegramCommandFailures * 2 - telemetry.reliability.brokerSyncFailures * 5 - telemetry.reliability.errorCount * 2);
}

function computeSafetyScore(telemetry: DemoRunTelemetry) {
  return clampScore(100 - telemetry.safety.killSwitchEvents * 10 - telemetry.safety.blockedOrders * 5 - telemetry.safety.riskPrecheckFailures * 4 - telemetry.safety.staleDataBlocks * 6 - telemetry.safety.dailyLossBlocks * 8 - telemetry.safety.confirmationFailures * 2 - telemetry.safety.unauthorizedTelegramAttempts * 8);
}

function computeUsabilityScore(telemetry: DemoRunTelemetry) {
  return clampScore(55 + (telemetry.usability.commandSuccessCount - telemetry.usability.commandFailureCount) * 2 - telemetry.usability.alertOverloadCount * 3 - telemetry.usability.abandonedConfirmationFlows * 5);
}

function computeCalibrationScore(context: DemoRunContext) {
  return clampScore(100 - Math.abs(context.lab.confidenceCalibration.calibrationDrift) * 60 - context.lab.confidenceCalibration.overconfidenceTendency * 40 - context.lab.regretAnalysis.items.reduce((sum, item) => sum + Math.max(0, item.count), 0));
}

function computeStrategyPerformanceScore(context: DemoRunContext) {
  if (context.lab.topStrategies.length === 0) return 50;
  return clampScore(context.lab.topStrategies.slice(0, 3).reduce((sum, item) => sum + item.overallScore, 0) / Math.min(3, context.lab.topStrategies.length));
}

function computeRiskScore(context: DemoRunContext) {
  const drawdown = context.telemetry.tradingPerformance.maxDrawdown;
  return clampScore(100 - drawdown * 4 - context.telemetry.safety.dailyLossBlocks * 5 - context.telemetry.safety.killSwitchEvents * 5);
}

function summarizeTelemetry(telemetry: DemoRunTelemetry) {
  return {
    reliabilityScore: computeReliabilityScore(telemetry),
    safetyScore: computeSafetyScore(telemetry),
    usabilityScore: computeUsabilityScore(telemetry),
    calibrationScore: clampScore(telemetry.calibration.predictionConfidence - Math.abs(telemetry.calibration.confidenceDrift)),
    strategyPerformanceScore: clampScore(telemetry.tradingPerformance.strategyPerformance.slice(0, 3).reduce((sum, item) => sum + item.score, 0) / Math.max(1, Math.min(3, telemetry.tradingPerformance.strategyPerformance.length))),
    riskScore: clampScore(100 - telemetry.tradingPerformance.maxDrawdown * 4 - telemetry.safety.dailyLossBlocks * 5),
  };
}

function upsertDailyReport(dailyReports: DemoRunDailyReport[], report: DemoRunDailyReport) {
  return normalizeDailyReports([...dailyReports.filter((item) => item.day !== report.day), report]);
}

function normalizeDailyReports(dailyReports: DemoRunDailyReport[]) {
  return Array.from(
    dailyReports
      .sort((left, right) => left.day - right.day || left.date.localeCompare(right.date))
      .reduce((byDay, report) => byDay.set(report.day, report), new Map<number, DemoRunDailyReport>())
      .values(),
  ).sort((left, right) => left.day - right.day).slice(-MAX_DAILY_REPORTS);
}

function normalizeScreen(screen: string) {
  const normalized = screen.trim().toLowerCase();
  return normalized.startsWith("/") ? normalized : `/${normalized.replace(/\s+/g, "-")}`;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, round(value)));
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]) {
  if (values.length === 0) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

export const demoRunService = new DemoRunService();
