import { paperStrategyRuntime } from "../execution/paperStrategyRuntime";
import { loadTelegramConfig, telegramClient, type TelegramClient } from "./telegramClient";
import { formatKillSwitch } from "./formatter";
import { telegramMetrics } from "./metrics";

export class TelegramNotificationService {
  constructor(private readonly client: TelegramClient = telegramClient, private readonly env: NodeJS.ProcessEnv = process.env) {}

  async sendOperations(kind: "lifecycle" | "health" | "report" | "market_session" | "kill_switch" | "test", text: string, metadata: Record<string, unknown> = {}) {
    const config = loadTelegramConfig(this.env);
    if (!config.notificationsEnabled || !config.chatId) return { sent: false as const, reason: "operations chat not configured" };
    const result = await this.client.sendMessage({ kind, destination: "operations", chatId: config.chatId, text, metadata });
    telegramMetrics.recordDelivery(result.ok, result.delivery.latencyMs, result.delivery.status === "rate_limited");
    return { sent: result.ok, result };
  }

  async sendCommandReply(chatId: string, text: string, metadata: Record<string, unknown> = {}) {
    const config = loadTelegramConfig(this.env);
    if (!config.notificationsEnabled || !config.botToken) return { sent: false as const, reason: "telegram command replies not configured" };
    const result = await this.client.sendMessage({ kind: "command", destination: "operations", chatId, text, metadata });
    telegramMetrics.recordDelivery(result.ok, result.delivery.latencyMs, result.delivery.status === "rate_limited");
    return { sent: result.ok, result };
  }

  async sendKillSwitchAlert(reason: string, scope = "global") {
    return this.sendOperations("kill_switch", formatKillSwitch({
      scope,
      reason,
      openDemoTrades: paperStrategyRuntime.listOpen().length,
      timestamp: new Date().toISOString(),
    }), { bypassDigest: true, liveExecutionBlocked: true });
  }

  async sendTestMessage() {
    return this.sendOperations("test", [
      "FinCoach Telegram Test",
      "TEST ONLY — DO NOT EXECUTE",
      "Environment: DEMO/PAPER/PRACTICE",
      "Live execution: blocked",
    ].join("\n"));
  }
}

export const telegramNotificationService = new TelegramNotificationService();
