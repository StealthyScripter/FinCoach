import { marketSessionsService } from "../marketSessionsService";
import type { AggregateTradableWindow } from "../marketSessionsService";
import type { WeeklyResearchWindowState } from "../v2/runtime/weeklyResearchWindow";
import { formatInTimezone, weeklyTransitionId } from "../v2/runtime/weeklyResearchWindow";
import { telegramNotificationService, type TelegramNotificationService } from "./notificationService";
import { telegramRepository, type TelegramRepository } from "./repository";

export class WeeklyMarketNotificationService {
  private lastState: Record<string, unknown> | null = null;

  constructor(
    private readonly repository: TelegramRepository = telegramRepository,
    private readonly notifications: TelegramNotificationService = telegramNotificationService,
  ) {}

  async sendOpen(input: { boundaryAt: string; window: WeeklyResearchWindowState; aggregate?: AggregateTradableWindow }) {
    const idempotencyKey = weeklyTransitionId("open", input.boundaryAt);
    return this.send("open", idempotencyKey, input.boundaryAt, this.openMessage(input.window, input.aggregate), input.window);
  }

  async sendClose(input: { boundaryAt: string; window: WeeklyResearchWindowState; aggregate?: AggregateTradableWindow }) {
    const idempotencyKey = weeklyTransitionId("close", input.boundaryAt);
    return this.send("close", idempotencyKey, input.boundaryAt, this.closeMessage(input.window, input.aggregate, input.boundaryAt), input.window);
  }

  snapshot() {
    return this.lastState;
  }

  private async send(kind: "open" | "close", idempotencyKey: string, boundaryAt: string, text: string, window: WeeklyResearchWindowState) {
    const now = new Date().toISOString();
    const claim = await this.repository.claimWeeklySessionNotification({
      idempotencyKey,
      transitionType: kind,
      boundaryAt,
      status: "claimed",
      deliveryId: null,
      attemptCount: 0,
      lastError: null,
      metadata: { timezone: window.timezone, liveExecutionBlocked: true },
      createdAt: now,
      updatedAt: now,
    });
    if (!claim.claimed) {
      this.lastState = { idempotencyKey, transitionType: kind, status: claim.record.status, deliveryId: claim.record.deliveryId, skipped: true };
      return this.lastState;
    }
    const delivery = await this.notifications.sendOperations("market_session", text, { idempotencyKey, transitionType: kind, boundaryAt, liveExecutionBlocked: true });
    const deliveryId = delivery.sent && "result" in delivery ? delivery.result.delivery.id : null;
    const status = delivery.sent ? "delivered" : "failed";
    const error = delivery.sent ? null : ("reason" in delivery ? delivery.reason : "telegram_delivery_failed");
    const completed = await this.repository.completeWeeklySessionNotification(idempotencyKey, {
      status,
      deliveryId,
      lastError: error,
      metadata: { sent: delivery.sent },
    });
    this.lastState = { idempotencyKey, transitionType: kind, status, deliveryId, record: completed };
    return this.lastState;
  }

  private openMessage(window: WeeklyResearchWindowState, aggregate?: AggregateTradableWindow) {
    const exchanges = marketSessionsService.exchangeSessions([], new Date(window.currentWindowOpenedAt ?? window.now));
    const openCount = aggregate?.openExchanges.length ?? exchanges.filter((exchange) => exchange.status === "open").length;
    const trackedSymbols = new Set((aggregate?.openInstrumentSessions ?? []).map((session) => session.symbol).concat(exchanges.flatMap((exchange) => exchange.symbols)));
    return [
      "🟢 Weekly Market Session Open",
      "",
      "The weekly trading and research window is now open.",
      `Opened: ${formatInTimezone(window.currentWindowOpenedAt ?? window.now, window.timezone)} ${window.timezone}`,
      "Research scheduler: active",
      `Open exchanges: ${openCount}`,
      `Tracked symbols: ${trackedSymbols.size}`,
      "Live execution: blocked",
    ].join("\n");
  }

  private closeMessage(window: WeeklyResearchWindowState, aggregate: AggregateTradableWindow | undefined, boundaryAt: string) {
    const justBeforeClose = marketSessionsService.aggregateTradableWindow(new Date(Date.parse(boundaryAt) - 1000));
    const finalClosed = justBeforeClose.openInstrumentSessions
      .filter((session) => session.closesAt === boundaryAt)
      .map((session) => session.displaySymbol)
      .sort()
      .join(", ") || aggregate?.openInstrumentSessions.at(-1)?.displaySymbol || "configured aggregate market window";
    return [
      "🔴 Weekly Tradable Market Window Closed",
      "",
      "All configured tradable markets are now closed.",
      `Final market/instrument closed: ${finalClosed}`,
      `Closed: ${formatInTimezone(boundaryAt, window.timezone)} ${window.timezone}`,
      "Research scheduler: suspended",
      `Next configured tradable opening: ${formatInTimezone(aggregate?.nextTradableOpenAt ?? window.nextWindowOpensAt, window.timezone)} ${window.timezone}`,
      "Live execution: blocked",
    ].join("\n");
  }
}

export const weeklyMarketNotificationService = new WeeklyMarketNotificationService();
