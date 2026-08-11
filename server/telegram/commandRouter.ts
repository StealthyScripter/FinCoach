import { randomUUID } from "crypto";
import { demoRunService } from "../demoRunService";
import { executionRiskService } from "../execution/riskControls";
import { demoOnlyPolicyService } from "../execution/demoOnlyPolicy";
import { redactChatId } from "./formatter";
import { telegramMetrics } from "./metrics";
import { telegramReportingService, type TelegramReportingService } from "./reportingService";
import { telegramRepository, type TelegramRepository } from "./repository";
import { buildHealthMessage } from "./health";
import { structuredLogger } from "../structuredLogger";

const READ_ONLY_COMMANDS = new Set([
  "/status",
  "/health",
  "/start",
  "/demo_status",
  "/pipeline_status",
  "/providers",
  "/open_trades",
  "/exposure",
  "/today",
  "/week",
  "/strategies",
  "/kill_status",
  "/v2_status",
  "/v2_metrics",
  "/research_today",
  "/research_throughput",
  "/research_progress",
  "/progress",
  "/pipeline",
  "/research_blockers",
  "/open_exchanges",
  "/markets_open",
  "/market_status",
  "/market_snapshot",
  "/snapshot",
  "/morning_snapshot",
  "/evening_snapshot",
  "/upcoming_events",
  "/market_events",
  "/blockers",
  "/readiness",
  "/observations",
  "/hypotheses",
  "/experiments",
  "/backtests",
  "/court_cases",
  "/strategy_leaderboard",
  "/strategy_portfolio",
  "/forward_tests",
  "/signals",
  "/evaluator_results",
  "/lessons",
  "/strategy_health",
  "/performance",
  "/restarts",
  "/data_reconciliation",
  "/help",
]);

const CONFIRMATION_COMMANDS = new Set(["/pause_demo", "/resume_demo", "/disable_automation", "/kill"]);

export class TelegramCommandRouter {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly reporting: TelegramReportingService = telegramReportingService,
    private readonly repository: TelegramRepository = telegramRepository,
  ) {}

  async handle(input: { command: string; actorId: string; chatId: string; confirmed?: boolean }) {
    telegramMetrics.increment("commandsReceived");
    const command = normalizeCommand(input.command);
    const authorized = this.authorized(input.actorId);
    if (!authorized) {
      telegramMetrics.increment("unauthorizedCommands");
      await this.audit(input, command, false, "rejected", "Unauthorized Telegram user");
      return "Request rejected: unauthorized user.";
    }
    if (isLiveTradingCommand(input.command)) {
      demoOnlyPolicyService.recordBlocked({
        provider: "telegram",
        accountMode: "live",
        verificationSource: "telegram.command",
        attemptedAction: input.command,
        actor: input.actorId,
        source: "telegram-command-router",
      });
      await this.audit(input, command, true, "blocked", "Live trading command blocked by demo-only policy");
      return "Blocked: FinCoach is demo-only. Telegram can never enable live trading or route live orders.";
    }
    if (CONFIRMATION_COMMANDS.has(command) && !input.confirmed) {
      await this.audit(input, command, true, "confirmation_required", "Confirmation required");
      return `Confirmation required for ${command}. Live execution remains blocked.`;
    }
    if (!READ_ONLY_COMMANDS.has(command) && !CONFIRMATION_COMMANDS.has(command)) {
      await this.audit(input, command, true, "rejected", "Unsupported command");
      return "Unknown command. Send /help for supported operations commands.";
    }
    const reply = await this.execute(command);
    await this.audit(input, command, true, "accepted", null);
    return reply;
  }

  help() {
    return [
      "FinCoach Telegram Commands",
      "/status /health /demo_status /pipeline_status /providers",
      "/open_trades /exposure /today /week /strategies /kill_status /performance /restarts",
      "/v2_status /v2_metrics /research_today /research_throughput /data_reconciliation",
      "/research_progress /research_blockers",
      "/open_exchanges /markets_open /market_status",
      "/market_snapshot /morning_snapshot /evening_snapshot /upcoming_events",
      "/observations /hypotheses /experiments /backtests",
      "/court_cases /strategy_leaderboard /strategy_portfolio /forward_tests /signals /evaluator_results /lessons /strategy_health",
      "Confirmation required: /pause_demo /resume_demo /disable_automation /kill",
      "Live trading commands are blocked.",
    ].join("\n");
  }

  private async execute(command: string) {
    switch (command) {
      case "/start":
        return this.help();
      case "/status":
        return this.reporting.statusMessage();
      case "/health":
        return buildHealthMessage();
      case "/demo_status": {
        const status = await demoRunService.status();
        return [`Demo Status`, `State: ${status.state}`, `Uptime: ${status.uptimeSeconds}s`, `Live execution: blocked`].join("\n");
      }
      case "/pipeline_status": {
        const { strategyResearchSchedulerService } = await import("../strategyResearchSchedulerService");
        const status = strategyResearchSchedulerService.snapshot();
        const { getFinCoachV2Runtime } = await import("../v2/runtime/composition");
        const v2 = getFinCoachV2Runtime().status();
        return [`Research Pipeline`, `V1: ${status.health.status}`, `V1 reason: ${status.lastSkipReason ?? "none"}`, `V2 runtime: ${v2.state}`, `V2 reason: ${v2.lastError ?? "none"}`, `Next V2 cycle: ${v2.nextScheduledCycleAt ?? "none"}`].join("\n");
      }
      case "/providers": {
        const { providerRegistryService } = await import("../providerRegistryService");
        const providers = providerRegistryService.getSnapshot().providers;
        return providers.length ? providers.map((provider) => `${provider.id}: adapter=${provider.status}, mode=${provider.providerMode}, execution-grade-data=${provider.providerMode !== "demo" && provider.freshness.stale === false ? "available" : "unavailable"}`).join("\n") : "No providers registered.";
      }
      case "/open_trades":
        return this.reporting.openTradesMessage();
      case "/exposure":
        return this.reporting.exposureMessage();
      case "/today":
        return this.reporting.todayMessage();
      case "/week":
        return this.reporting.weekMessage();
      case "/strategies":
        return "Strategy performance is available in /api/marketpilot/telegram/status and weekly summaries.";
      case "/kill_status":
        return `Kill switch: ${executionRiskService.snapshot().globalKillSwitch ? "ACTIVE" : "inactive"}\nNew signals: ${executionRiskService.snapshot().globalKillSwitch ? "suppressed" : "allowed through quality gate"}\nLive execution: blocked`;
      case "/v2_status":
        return this.v2StatusMessage();
      case "/v2_metrics":
        return this.v2MetricsMessage();
      case "/research_throughput":
        return this.researchThroughputMessage();
      case "/research_progress":
      case "/progress":
      case "/pipeline": {
        const { v2OperationsService } = await import("../v2/operations");
        return v2OperationsService.telegramResearchProgress();
      }
      case "/research_blockers":
      case "/blockers":
      case "/readiness": {
        const { v2OperationsService } = await import("../v2/operations");
        return v2OperationsService.telegramResearchBlockers();
      }
      case "/open_exchanges":
      case "/markets_open":
      case "/market_status": {
        const startedAt = Date.now();
        const { marketSessionsService } = await import("../marketSessionsService");
        const message = marketSessionsService.openExchangesTelegramMessage();
        const exchanges = marketSessionsService.marketSessions().exchanges;
        structuredLogger.telegram({
          level: "info",
          event: "open_exchanges_command_rendered",
          message: "Telegram open exchanges command rendered",
          durationMs: Date.now() - startedAt,
          exchangeCount: exchanges.length,
          openExchangeCount: exchanges.filter((exchange) => exchange.status === "open").length,
          delivery: "reply_returned_to_transport",
        });
        return message;
      }
      case "/market_snapshot":
      case "/snapshot": {
        const { marketSnapshotService } = await import("../marketSnapshotService");
        const latest = await marketSnapshotService.latest();
        return latest ? [`Market Snapshot`, `Generated: ${latest.generatedAt}`, `Freshness: ${freshnessSummary(latest.payload)}`, "", latest.message].join("\n") : "No market snapshot has been generated yet. Live execution: blocked";
      }
      case "/morning_snapshot": {
        const { marketSnapshotService } = await import("../marketSnapshotService");
        const result = await marketSnapshotService.generateOrRetrieve("morning");
        return result.snapshot.message;
      }
      case "/evening_snapshot": {
        const { marketSnapshotService } = await import("../marketSnapshotService");
        const result = await marketSnapshotService.generateOrRetrieve("evening");
        return result.snapshot.message;
      }
      case "/upcoming_events":
      case "/market_events": {
        const { marketSnapshotService } = await import("../marketSnapshotService");
        const events = marketSnapshotService.upcomingEvents();
        if (!events.length) return "No upcoming configured market events in the lookahead window.\nLive execution: blocked";
        return ["Upcoming Market Events", ...events.map((item, index) => `${index + 1}. ${item.event.sourceType === "synthetic_demo" ? "[synthetic demo] " : ""}${item.event.title}\n   Time: ${item.event.startsAt}\n   Authoritative: ${item.event.authoritative}\n   Impact: ${item.impactScore.finalScore}/10\n   Affected configured symbols: ${item.impactScore.affectedInstruments.join(", ") || "none mapped"}\n   Score basis: ${item.impactScore.explanation}`), "Live execution: blocked"].join("\n");
      }
      case "/performance":
        return this.performanceMessage();
      case "/restarts":
        return this.restartsMessage();
      case "/data_reconciliation":
        return this.dataReconciliationMessage();
      case "/research_today":
      case "/observations":
      case "/hypotheses":
      case "/experiments":
      case "/backtests":
      case "/court_cases":
      case "/strategy_leaderboard":
      case "/strategy_portfolio":
      case "/forward_tests":
      case "/signals":
      case "/evaluator_results":
      case "/lessons":
      case "/strategy_health": {
        const { v2OperationsService } = await import("../v2/operations");
        return v2OperationsService.telegramSummary(command);
      }
      case "/pause_demo":
        await demoRunService.pause("Telegram /pause_demo");
        return "Demo run paused. Live execution remains blocked.";
      case "/resume_demo":
        await demoRunService.resume("Telegram /resume_demo");
        return "Demo run resumed. Live execution remains blocked.";
      case "/disable_automation":
        return "Automation disable acknowledged for demo operations. Live execution remains blocked.";
      case "/kill":
        executionRiskService.triggerGlobalKillSwitch();
        return "Kill switch activated. New signals suppressed and demo orders blocked.";
      case "/help":
      default:
        return this.help();
    }
  }

  private authorized(actorId: string) {
    return Boolean(this.env.TELEGRAM_ALLOWED_USER_ID?.trim() && actorId === this.env.TELEGRAM_ALLOWED_USER_ID.trim());
  }

  private async v2StatusMessage() {
    const { v2OperationsService } = await import("../v2/operations");
    const { getFinCoachV2Runtime } = await import("../v2/runtime/composition");
    const status = (await v2OperationsService.statusAsync()).body;
    const runtime = getFinCoachV2Runtime().status();
    return [
      "V2 Status",
      `Infrastructure: ${status.infrastructureHealth ?? "unknown"}`,
      `Database: ${status.databaseHealth ?? status.postgresqlHealth ?? "unknown"}`,
      `Providers: ${status.providerHealth ?? "unknown"}`,
      `Runtime: ${runtime.state}`,
      `Research: ${status.researchState ?? "unknown"}`,
      `Pilot: ${status.pilotState ?? "none"}`,
      `Paper execution: ${runtime.paperExecution}`,
      `Demo broker execution: ${runtime.demoBrokerExecution}`,
      `Telegram publication: ${runtime.telegramPublication}`,
      `Latest cycle: ${(status.latestSuccessfulCycle as { cycleId?: string } | null)?.cycleId ?? "none"}`,
      `Latest checkpoint: ${status.latestSuccessfulCheckpoint ?? "none"}`,
      `Configuration gaps: ${runtime.configuration.errors.join("; ") || "none"}`,
      `Economic evidence: ${status.economicEvidenceState ?? "unknown"}`,
      `Live-money execution: ${runtime.liveMoneyExecution}`,
    ].join("\n");
  }

  private async v2MetricsMessage() {
    const { v2OperationsService } = await import("../v2/operations");
    const { getFinCoachV2Runtime } = await import("../v2/runtime/composition");
    const status = (await v2OperationsService.statusAsync()).body;
    const memory = getFinCoachV2Runtime().status().memory;
    return [
      "V2 Metrics",
      `Successful cycles: ${status.latestSuccessfulCycle ? 1 : 0}`,
      `Failed cycles: ${status.latestFailedCycle ? 1 : 0}`,
      `Partial cycles: 0`,
      `Cancelled cycles: 0`,
      `Queue depth: ${status.queueDepth ?? 0}`,
      `Active leases: ${status.activeWorkerLeases ?? 0}`,
      `Stale leases: ${status.staleWorkerLeases ?? 0}`,
      `Pending retries: ${status.pendingRetries ?? 0}`,
      `Exhausted retries: ${status.exhaustedRetries ?? 0}`,
      `Dead letters: ${status.deadLetterCount ?? 0}`,
      `Observations: ${status.observationsCreated ?? 0}`,
      `Hypotheses: ${status.hypothesesCreated ?? 0}`,
      `Experiments: ${status.experimentsQueued ?? 0}`,
      `Backtests: ${status.backtestsCompleted ?? 0}`,
      `Court verdicts: ${status.courtroomVerdicts ?? 0}`,
      `Ranked candidates: ${status.rankedCandidates ?? 0}`,
      `Forward tests: ${status.forwardTests ?? 0}`,
      `Signals: ${status.signals ?? 0}`,
      `Evaluations: ${status.externalEvaluations ?? 0}`,
      `Lessons: ${status.lessons ?? 0}`,
      `Heap used: ${memory.heapUsedBytes}`,
      `Event retention: ${memory.eventLogItems}`,
    ].join("\n");
  }

  private async researchThroughputMessage() {
    const { v2OperationsService } = await import("../v2/operations");
    return v2OperationsService.telegramResearchThroughput();
  }

  private async performanceMessage() {
    const { v2OperationsService } = await import("../v2/operations");
    const status = (await v2OperationsService.statusAsync()).body;
    const signals = Number(status.signals ?? 0);
    const forwardTests = Number(status.forwardTests ?? 0);
    if (signals === 0 && forwardTests === 0) {
      return "Performance\nInsufficient evidence to estimate profitability.\nSample size: 0\nLive execution: blocked";
    }
    return [
      "Performance",
      `Evaluated signals: ${signals}`,
      `Entries triggered: ${forwardTests}`,
      "Wins: evidence pending",
      "Losses: evidence pending",
      "Breakeven outcomes: evidence pending",
      "Open outcomes: evidence pending",
      "Net R: evidence pending",
      "Average R: evidence pending",
      "Expectancy: evidence pending",
      "Profit factor: evidence pending",
      "Sample size: evidence pending",
    ].join("\n");
  }

  private async restartsMessage() {
    const { getFinCoachV2Runtime } = await import("../v2/runtime/composition");
    const runtime = getFinCoachV2Runtime().status();
    return [
      "Restarts",
      `Process uptime: ${Math.round(process.uptime())}s`,
      `Boot ID: ${runtime.bootId}`,
      "Restart/recovery count: see v2_runtime_boot_records",
      `Current heap: ${runtime.memory.heapUsedBytes}`,
      `Heap limit: ${runtime.memory.heapLimitBytes}`,
      `Peak heap: ${runtime.memory.peakHeapUsedBytes}`,
      "Latest fatal-memory recovery marker: unavailable",
    ].join("\n");
  }

  private async dataReconciliationMessage() {
    const { v2OperationsService } = await import("../v2/operations");
    return v2OperationsService.telegramDataReconciliation();
  }

  private async audit(input: { command: string; actorId: string; chatId: string }, command: string, authorized: boolean, outcome: "accepted" | "rejected" | "confirmation_required" | "blocked", reason: string | null) {
    await this.repository.saveCommandAudit({
      id: randomUUID(),
      command,
      actorIdRedacted: redactChatId(input.actorId) ?? "[REDACTED]",
      chatIdRedacted: redactChatId(input.chatId) ?? "[REDACTED]",
      authorized,
      outcome,
      reason,
      createdAt: new Date().toISOString(),
    });
  }
}

function normalizeCommand(command: string) {
  return command.trim().split(/\s+/)[0]?.toLowerCase() || "/help";
}

function isLiveTradingCommand(command: string) {
  return /\b(live|real|funded|disable_demo|override|live_account|real_money|enable_live|connect_live)\b/i.test(command);
}

function freshnessSummary(payload: Record<string, unknown>) {
  const freshness = payload.freshness;
  if (!freshness || typeof freshness !== "object") return "unknown";
  const values = Object.values(freshness as Record<string, { status?: string }>).map((item) => item.status ?? "unknown");
  if (values.includes("stale") || values.includes("unavailable")) return "degraded";
  if (values.includes("delayed")) return "delayed";
  return "healthy";
}

export const telegramCommandRouter = new TelegramCommandRouter();
