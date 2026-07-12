import { createHash } from "crypto";
import type { FinCoachSignal, TelegramEnvironmentConfig, TelegramSignalLifecycleUpdate } from "./contracts";

const SENSITIVE_KEYS = /(token|secret|password|database|api[_-]?key|account[_-]?id|credential|authorization)/i;

export function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function protectTelegramMessageLength(text: string, maxLength = 3900) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 32)}\n[message truncated safely]`;
}

export function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export function redactTelegramSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTelegramSecrets);
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && looksSensitive(value)) return "[REDACTED]";
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redactTelegramSecrets(item),
    ]),
  );
}

export function redactChatId(chatId: string | number | null | undefined) {
  if (chatId === null || chatId === undefined || chatId === "") return null;
  const raw = String(chatId);
  if (raw.length <= 4) return "[REDACTED]";
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
}

export function formatStartup(input: { environment: string; version: string; startedAt: string }) {
  return [
    "🟢 FinCoach Started",
    `Environment: ${input.environment}`,
    "Mode: demo_observation",
    "Storage: PostgreSQL",
    "Demo-only policy: enforced",
    "Live execution: blocked",
    `Version: ${input.version}`,
    `Started: ${input.startedAt}`,
  ].join("\n");
}

export function formatGracefulStop(input: { reason: string; uptime: string; stoppedAt: string }) {
  return [
    "🟡 FinCoach Stopped",
    `Reason: ${input.reason}`,
    `Uptime: ${input.uptime}`,
    `Stopped: ${input.stoppedAt}`,
  ].join("\n");
}

export function formatRecovery(input: { previousHeartbeat: string; recoveryTime: string; downtime: string; currentHealth: string }) {
  return [
    "🔴 FinCoach Recovered After Unexpected Stop",
    `Previous heartbeat: ${input.previousHeartbeat}`,
    `Recovery time: ${input.recoveryTime}`,
    `Downtime estimate: ${input.downtime}`,
    `Current health: ${input.currentHealth}`,
    "Live execution: blocked",
  ].join("\n");
}

export function formatKillSwitch(input: { scope: string; reason: string; openDemoTrades: number; timestamp: string }) {
  return [
    "🚨 KILL SWITCH ACTIVATED",
    `Scope: ${input.scope}`,
    `Reason: ${input.reason}`,
    `Open demo trades: ${input.openDemoTrades}`,
    "New signals: suppressed",
    "New demo orders: blocked",
    `Timestamp: ${input.timestamp}`,
  ].join("\n");
}

export function formatMarketSession(input: { opened: boolean; market: string; session: string; time: string; instruments: string[]; dataStatus: string }) {
  return [
    input.opened ? "🔔 MARKET OPEN" : "🔕 MARKET CLOSED",
    `Market: ${input.market}`,
    `Session: ${input.session}`,
    `Time: ${input.time}`,
    `Tracked instruments: ${input.instruments.join(", ") || "none"}`,
    `Data status: ${input.dataStatus}`,
  ].join("\n");
}

export function formatHumanSignal(signal: FinCoachSignal, reason: string, invalidation: string) {
  return [
    "📈 FINCOACH SIGNAL",
    "Version: 1",
    "Environment: DEMO_RESEARCH",
    `Signal ID: ${signal.signalId}`,
    `Symbol: ${signal.displaySymbol}`,
    `Side: ${signal.side.toUpperCase()}`,
    `Entry Type: ${signal.entryType.toUpperCase()}`,
    `Entry: ${signal.entryPrice}`,
    `Stop Loss: ${signal.stopLoss}`,
    `Take Profit: ${signal.takeProfit}`,
    `Risk/Reward: ${signal.riskReward}`,
    `Timeframe: ${signal.timeframe.toUpperCase()}`,
    `Strategy: ${signal.strategyId}`,
    `Strategy Version: ${signal.strategyVersion}`,
    `Confidence: ${Math.round(signal.confidence * 100)}%`,
    `Evidence Score: ${signal.evidenceScore}`,
    `Valid Until: ${signal.validUntil}`,
    `Reason: ${reason}`,
    `Invalidation: ${invalidation}`,
    `Generated At: ${signal.generatedAt}`,
    "",
    "```json",
    canonicalJson(signal),
    "```",
  ].join("\n");
}

export function formatSignalLifecycle(update: TelegramSignalLifecycleUpdate, displaySymbol: string) {
  const heading = update.outcome === "invalidated" ? "❌ SIGNAL INVALIDATED" : "✅ SIGNAL RESULT";
  return [
    heading,
    `Signal ID: ${update.signalId}`,
    `Symbol: ${displaySymbol}`,
    `Outcome: ${update.outcome.toUpperCase()}`,
    update.resultR === null ? null : `Result: ${update.resultR >= 0 ? "+" : ""}${update.resultR}R`,
    update.demoPnl === null ? null : `Demo P/L: ${update.demoPnl >= 0 ? "+" : ""}${update.demoPnl}`,
    update.lesson ? `Lesson: ${update.lesson}` : null,
    update.outcome === "invalidated" ? "No demo trade opened." : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(stable(value));
}

export function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

export function redactedConfig(config: TelegramEnvironmentConfig) {
  return {
    botTokenConfigured: Boolean(config.botToken),
    allowedUserId: redactChatId(config.allowedUserId),
    chatId: redactChatId(config.chatId),
    signalChatId: redactChatId(config.signalChatId),
    webhookSecretConfigured: Boolean(config.webhookSecret),
    webhookUrlConfigured: Boolean(config.webhookUrl),
    notificationsEnabled: config.notificationsEnabled,
    signalsEnabled: config.signalsEnabled,
    dailySummaryHourUtc: config.dailySummaryHourUtc,
    weeklySummaryDay: config.weeklySummaryDay,
    weeklySummaryHourUtc: config.weeklySummaryHourUtc,
    marketSessionAlerts: config.marketSessionAlerts,
    minSignalConfidence: config.minSignalConfidence,
    minSignalEvidenceScore: config.minSignalEvidenceScore,
    signalCooldownMinutes: config.signalCooldownMinutes,
    signalSigningSecretConfigured: Boolean(config.signalSigningSecret),
  };
}

function looksSensitive(value: string) {
  return value.length > 24 && /[A-Za-z0-9_\-:.]{24,}/.test(value);
}
