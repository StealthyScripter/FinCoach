import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { TradingViewSignal } from "./domain";
import { normalizeSymbol, tradingViewSignalSchema } from "./domain";
import { executionAuditLog } from "./riskControls";

export type WebhookResult = {
  status: "signal accepted" | "signal rejected" | "paper strategy created" | "risk review required";
  accepted: boolean;
  reason?: string;
  signal?: Omit<TradingViewSignal, "signature">;
  correlationId: string;
};

export class TradingViewWebhookSignalProvider {
  private replayKeys = new Map<string, number>();

  constructor(
    private readonly secret = process.env.TRADINGVIEW_WEBHOOK_SECRET ?? "",
    private readonly maxAgeMs = 5 * 60_000,
    private readonly now = () => Date.now(),
  ) {}

  receive(payload: unknown): WebhookResult {
    const parsed = tradingViewSignalSchema.safeParse(payload);
    const correlationId = randomUUID();

    if (!parsed.success) {
      return this.reject(correlationId, "Payload validation failed");
    }
    if (!this.secret) {
      return this.reject(correlationId, "TradingView webhook secret is not configured");
    }

    const { signature, ...signal } = parsed.data;
    const timestamp = Date.parse(signal.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(this.now() - timestamp) > this.maxAgeMs) {
      return this.reject(correlationId, "Signal timestamp is outside the replay-protection window");
    }

    const replayKey = signal.nonce ?? `${signal.strategyName}:${signal.symbol}:${signal.timestamp}`;
    this.removeExpiredReplayKeys();
    if (this.replayKeys.has(replayKey)) {
      return this.reject(correlationId, "Duplicate signal rejected by replay protection");
    }

    const expected = signTradingViewSignal(signal, this.secret);
    if (!safeEqual(signature, expected)) {
      return this.reject(correlationId, "Invalid webhook signature");
    }

    const instrument = normalizeSymbol(signal.symbol);
    if (!instrument) {
      return this.reject(correlationId, "Unsupported forex or commodity instrument");
    }
    this.replayKeys.set(replayKey, this.now() + this.maxAgeMs);

    const stopDistance = Math.abs(signal.price - signal.stopLoss);
    const rewardDistance = signal.takeProfit ? Math.abs(signal.takeProfit - signal.price) : 0;
    const status = signal.confidence < 60 || !signal.takeProfit || rewardDistance < stopDistance
      ? "risk review required"
      : "signal accepted";
    executionAuditLog.append({
      action: "tradingview.signal",
      outcome: status === "signal accepted" ? "accepted" : "blocked",
      correlationId,
      detail: { instrument: instrument.symbol, strategyName: signal.strategyName, status },
    });
    return { status, accepted: true, signal: { ...signal, symbol: instrument.symbol }, correlationId };
  }

  private reject(correlationId: string, reason: string): WebhookResult {
    executionAuditLog.append({
      action: "tradingview.signal",
      outcome: "rejected",
      correlationId,
      detail: { reason },
    });
    return { status: "signal rejected", accepted: false, reason, correlationId };
  }

  private removeExpiredReplayKeys() {
    for (const [key, expiresAt] of Array.from(this.replayKeys.entries())) {
      if (expiresAt <= this.now()) this.replayKeys.delete(key);
    }
  }
}

export function signTradingViewSignal(signal: Omit<TradingViewSignal, "signature">, secret: string) {
  return createHmac("sha256", secret).update(stableJson(signal)).digest("hex");
}

function safeEqual(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function stableJson(value: Record<string, unknown>) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

export const tradingViewWebhookProvider = new TradingViewWebhookSignalProvider();
