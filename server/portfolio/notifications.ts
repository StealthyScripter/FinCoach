import { telegramNotificationService, type TelegramNotificationService } from "../telegram/notificationService";

export class PortfolioNotificationService {
  private sent = new Map<string, number>();
  constructor(private readonly telegram: Pick<TelegramNotificationService, "sendOperations"> = telegramNotificationService, private readonly reminderMs = 6 * 60 * 60_000) {}

  async rebalance(input: { strategy: string; nav: number; riskLevel: number; reason: string; changes: string[]; expectedVolatilityBefore?: number | null; expectedVolatilityAfter?: number | null }) {
    return this.send(`rebalance:${input.strategy}:${input.nav.toFixed(2)}`, [
      "📊 Portfolio Rebalanced",
      `Strategy: ${input.strategy}`,
      `NAV: ${usd(input.nav)}`,
      `Risk level: ${input.riskLevel}/10`,
      "",
      "Reason:",
      input.reason,
      "",
      "Major changes:",
      ...(input.changes.length ? input.changes : ["No material allocation change recorded."]),
      "",
      `Expected volatility: ${fmt(input.expectedVolatilityBefore)} → ${fmt(input.expectedVolatilityAfter)}`,
      "",
      "No real broker order submitted.",
      "Virtual portfolio only.",
    ].join("\n"));
  }

  async limitReached(input: { code: string; configKey: string; configured: unknown; observed: unknown; action: string }) {
    return this.send(`limit:${input.code}:${input.configKey}:${input.configured}:${input.observed}`, [
      "⚠️ Portfolio strategy limit reached",
      "",
      `${input.configKey}=${input.configured}`,
      `Current observed=${input.observed}`,
      input.action,
    ].join("\n"));
  }

  async lifecycle(input: { strategy: string; stage: string; reason: string }) {
    return this.send(`lifecycle:${input.strategy}:${input.stage}`, [
      "🏆 Portfolio strategy lifecycle update",
      `Strategy: ${input.strategy}`,
      `Stage: ${input.stage}`,
      `Reason: ${input.reason}`,
      "No real-money promotion performed.",
    ].join("\n"));
  }

  private async send(key: string, text: string) {
    const now = Date.now();
    const previous = this.sent.get(key);
    if (previous && now - previous < this.reminderMs) return { sent: false as const, reason: "deduped" };
    this.sent.set(key, now);
    return this.telegram.sendOperations("health", text, { component: "portfolio", liveExecutionBlocked: true }).catch((error) => ({ sent: false as const, reason: error instanceof Error ? error.message : String(error) }));
  }
}

function usd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function fmt(value: number | null | undefined) {
  return value === null || value === undefined ? "unavailable" : `${value.toFixed(2)}%`;
}

export const portfolioNotificationService = new PortfolioNotificationService();
