import type { TelegramNormalizedCommand, TelegramNormalizedUpdate } from "./contracts";
import { telegramMetrics } from "./metrics";
import type { TelegramCommandRouter } from "./commandRouter";
import type { TelegramNotificationService } from "./notificationService";
import { structuredLogger } from "../structuredLogger";

type RouterReply = string | { success?: boolean; reply?: string };

export class TelegramTransport {
  constructor(
    private readonly router?: Pick<TelegramCommandRouter, "handle">,
    private readonly notifications?: Pick<TelegramNotificationService, "sendCommandReply">,
  ) {}

  async handle(update: TelegramNormalizedUpdate) {
    const command = this.toCommand(update);
    if (!command) {
      telegramMetrics.increment("updatesIgnored");
      structuredLogger.telegram({ level: "info", event: "telegram_update_ignored", message: "Telegram update ignored", updateId: update.updateId, reason: "not_command" });
      return { processed: false as const, reason: "not_command" };
    }

    const startedAt = Date.now();
    structuredLogger.telegram({ level: "info", event: "telegram_command_received", message: "Telegram command received", updateId: update.updateId, command: command.command, messageId: command.messageId });
    try {
      const router = await this.getRouter();
      const routerReply = await router.handle({
        command: [command.command, ...command.args].join(" "),
        actorId: command.actorId,
        chatId: command.chatId,
      });
      const reply = normalizeReply(routerReply);
      if (!reply) {
        telegramMetrics.increment("updatesProcessed");
        structuredLogger.telegram({ level: "info", event: "telegram_command_processed", message: "Telegram command processed without reply", updateId: update.updateId, command: command.command, durationMs: Date.now() - startedAt });
        return { processed: true as const, replied: false as const };
      }

      const notifications = await this.getNotifications();
      const delivery = await notifications.sendCommandReply(command.chatId, reply, {
        source: command.source,
        command: command.command,
        messageId: command.messageId,
        receivedAt: command.receivedAt,
      });
      if (delivery.sent) telegramMetrics.increment("repliesSent");
      else telegramMetrics.increment("replyFailures");
      telegramMetrics.increment("updatesProcessed");
      structuredLogger.telegram({ level: delivery.sent ? "info" : "warn", event: "telegram_command_reply_completed", message: delivery.sent ? "Telegram command reply sent" : "Telegram command reply failed", updateId: update.updateId, command: command.command, durationMs: Date.now() - startedAt, delivery });
      return { processed: true as const, replied: delivery.sent };
    } catch (error) {
      telegramMetrics.increment("updatesFailed");
      structuredLogger.telegram({ level: "error", event: "telegram_command_failed", message: "Telegram command processing failed", updateId: update.updateId, command: command.command, durationMs: Date.now() - startedAt, error });
      throw error;
    }
  }

  toCommand(update: TelegramNormalizedUpdate): TelegramNormalizedCommand | null {
    const parts = update.text.trim().split(/\s+/).filter(Boolean);
    const command = parts[0]?.split("@")[0]?.toLowerCase();
    if (!command?.startsWith("/")) return null;
    return {
      source: "telegram",
      command,
      args: parts.slice(1),
      actorId: update.actorId,
      chatId: update.chatId,
      messageId: update.messageId,
      receivedAt: update.receivedAt,
    };
  }

  private async getRouter() {
    if (this.router) return this.router;
    return (await import("./commandRouter")).telegramCommandRouter;
  }

  private async getNotifications() {
    if (this.notifications) return this.notifications;
    return (await import("./notificationService")).telegramNotificationService;
  }
}

function normalizeReply(reply: RouterReply) {
  if (typeof reply === "string") return reply;
  return typeof reply.reply === "string" ? reply.reply : "";
}

export const telegramTransport = new TelegramTransport();
