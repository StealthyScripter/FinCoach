import type { TelegramNormalizedCommand, TelegramNormalizedUpdate } from "./contracts";
import { telegramMetrics } from "./metrics";
import type { TelegramCommandRouter } from "./commandRouter";
import type { TelegramNotificationService } from "./notificationService";

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
      return { processed: false as const, reason: "not_command" };
    }

    const router = await this.getRouter();
    const routerReply = await router.handle({
      command: [command.command, ...command.args].join(" "),
      actorId: command.actorId,
      chatId: command.chatId,
    });
    const reply = normalizeReply(routerReply);
    if (!reply) {
      telegramMetrics.increment("updatesProcessed");
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
    return { processed: true as const, replied: delivery.sent };
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
