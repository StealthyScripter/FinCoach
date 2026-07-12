import { randomUUID } from "crypto";
import { demoRunService } from "../demoRunService";
import { executionRiskService } from "../execution/riskControls";
import { demoOnlyPolicyService } from "../execution/demoOnlyPolicy";
import { redactChatId } from "./formatter";
import { telegramMetrics } from "./metrics";
import { telegramReportingService, type TelegramReportingService } from "./reportingService";
import { telegramRepository, type TelegramRepository } from "./repository";
import { buildHealthMessage } from "./health";

const READ_ONLY_COMMANDS = new Set([
  "/status",
  "/health",
  "/demo_status",
  "/pipeline_status",
  "/providers",
  "/open_trades",
  "/exposure",
  "/today",
  "/week",
  "/strategies",
  "/kill_status",
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
      "/open_trades /exposure /today /week /strategies /kill_status",
      "Confirmation required: /pause_demo /resume_demo /disable_automation /kill",
      "Live trading commands are blocked.",
    ].join("\n");
  }

  private async execute(command: string) {
    switch (command) {
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
        return [`Research Pipeline`, `Health: ${status.health.status}`, `Cycles: ${status.health.cyclesRun}`, `Promoted: ${status.counts.promoted}`, `Rejected: ${status.counts.rejected}`].join("\n");
      }
      case "/providers": {
        const { providerRegistryService } = await import("../providerRegistryService");
        const providers = providerRegistryService.getSnapshot().providers;
        return providers.length ? providers.map((provider) => `${provider.id}: ${provider.status}`).join("\n") : "No providers registered.";
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

export const telegramCommandRouter = new TelegramCommandRouter();
