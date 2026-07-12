import { createHmac, createHash, randomUUID } from "crypto";
import { executionRiskService } from "../execution/riskControls";
import { marketSessionRulesService } from "../execution/marketSessionRules";
import { demoRunService } from "../demoRunService";
import type { FinCoachSignal, SignalGateResult, SignalQualityGateInput, TelegramSignalLifecycleUpdate, TelegramSignalRecord } from "./contracts";
import { TELEGRAM_SIGNAL_SCHEMA, finCoachSignalSchema } from "./contracts";
import { emitTelegramEvent } from "./events";
import { canonicalJson, formatHumanSignal, formatSignalLifecycle } from "./formatter";
import { telegramMetrics } from "./metrics";
import { telegramRepository, type TelegramRepository } from "./repository";
import { loadTelegramConfig, telegramClient, type TelegramClient } from "./telegramClient";

export class TelegramSignalPublisher {
  constructor(
    private readonly client: TelegramClient = telegramClient,
    private readonly repository: TelegramRepository = telegramRepository,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async evaluateQualityGate(input: SignalQualityGateInput): Promise<SignalGateResult> {
    const config = loadTelegramConfig(this.env);
    const fingerprint = signalFingerprint(input.signal);
    const idempotencyKey = createHash("sha256").update(`telegram:${fingerprint}`).digest("hex");
    const duplicate = await this.repository.findSignalByFingerprint(fingerprint);
    const rejectionReasons = [
      !input.demoRunRunning ? "Demo run is not running." : null,
      !input.demoOnlyPolicyHealthy ? "Demo-only policy is not healthy." : null,
      !input.killSwitchInactive ? "Kill switch is active." : null,
      !input.marketDataFresh ? "Market data is stale." : null,
      !input.providerHealthAcceptable ? "Provider health is not acceptable." : null,
      !input.objectiveRuleSetExists ? "Objective rule set is missing." : null,
      !input.experimentExists ? "Experiment is missing." : null,
      !input.backtestEvidenceExists ? "Backtest evidence is missing." : null,
      !input.validationVerdictPermitsObservation ? "Validation verdict does not permit observation." : null,
      !input.stabilityThresholdPasses ? "Stability threshold failed." : null,
      !input.minimumSampleSizePasses ? "Minimum sample size failed." : null,
      input.signal.confidence < config.minSignalConfidence / 100 ? "Confidence below configured threshold." : null,
      input.signal.evidenceScore < config.minSignalEvidenceScore ? "Evidence score below configured threshold." : null,
      !Number.isFinite(input.signal.entryPrice) || input.signal.entryPrice <= 0 ? "Entry is missing." : null,
      !Number.isFinite(input.signal.stopLoss) || input.signal.stopLoss <= 0 ? "Stop loss is missing." : null,
      !Number.isFinite(input.signal.takeProfit) || input.signal.takeProfit <= 0 ? "Take profit is missing." : null,
      !input.rewardRiskAcceptable ? "Reward/risk is not acceptable." : null,
      !input.signal.invalidation.trim() ? "Invalidation rule is missing." : null,
      !input.eventLineageComplete ? "Event lineage is incomplete." : null,
      duplicate && duplicate.status === "published" ? "Duplicate signal fingerprint suppressed." : null,
      duplicate && !cooldownExpired(duplicate.lastUpdateAt, config.signalCooldownMinutes) ? "Signal cooldown has not expired." : null,
      !input.marketSessionAllowsEntry ? "Market/session constraints block entry." : null,
      !input.majorNewsBlackoutClear ? "Major-news blackout is active." : null,
    ].filter((reason): reason is string => Boolean(reason));
    return { accepted: rejectionReasons.length === 0, rejectionReasons, fingerprint, idempotencyKey };
  }

  async publish(input: SignalQualityGateInput) {
    telegramMetrics.increment("signalsConsidered");
    const config = loadTelegramConfig(this.env);
    const gate = await this.evaluateQualityGate(input);
    const now = new Date().toISOString();
    if (!gate.accepted || !config.signalsEnabled || !config.signalChatId) {
      telegramMetrics.increment("signalsRejected");
      if (gate.rejectionReasons.some((reason) => reason.toLowerCase().includes("duplicate"))) telegramMetrics.increment("duplicatesSuppressed");
      if (gate.rejectionReasons.some((reason) => reason.toLowerCase().includes("stale"))) telegramMetrics.increment("staleSignalsSuppressed");
      if (gate.rejectionReasons.some((reason) => reason.toLowerCase().includes("kill switch"))) telegramMetrics.increment("killSwitchSuppressions");
      const signal = this.buildRejectedSignal(input, gate.fingerprint, gate.idempotencyKey);
      const humanMessage = `Rejected FinCoach signal\nSignal ID: ${signal.signalId}\nSymbol: ${signal.displaySymbol}\nReasons: ${(config.signalChatId ? gate.rejectionReasons : [...gate.rejectionReasons, "TELEGRAM_SIGNAL_CHAT_ID is not configured; fail closed."]).join("; ")}\nLive execution: blocked`;
      const record = await this.repository.saveSignal({
        signalId: signal.signalId,
        schema: TELEGRAM_SIGNAL_SCHEMA,
        fingerprint: gate.fingerprint,
        idempotencyKey: gate.idempotencyKey,
        status: "rejected",
        symbol: signal.symbol,
        payload: signal,
        humanMessage,
        rejectionReasons: config.signalChatId ? gate.rejectionReasons : [...gate.rejectionReasons, "TELEGRAM_SIGNAL_CHAT_ID is not configured; fail closed."],
        publishedAt: null,
        expiresAt: signal.validUntil,
        lastUpdateAt: now,
        metadata: { sourceEventRefs: input.sourceEventRefs ?? [], demoOnly: true },
      });
      emitTelegramEvent("TelegramSignalRejected", { signalId: signal.signalId, rejectionReasons: record.rejectionReasons }, signal.signalId);
      return { published: false as const, record };
    }

    const signal = this.buildSignal(input, gate.fingerprint, gate.idempotencyKey);
    const humanMessage = formatHumanSignal(signal, input.signal.reason, input.signal.invalidation);
    const delivery = await this.client.sendMessage({
      kind: "signal",
      destination: "signals",
      chatId: config.signalChatId,
      text: humanMessage,
      correlationId: signal.signalId,
      metadata: { signalId: signal.signalId, fingerprint: signal.fingerprint, demoOnly: true },
    });
    telegramMetrics.recordDelivery(delivery.ok, delivery.delivery.latencyMs, delivery.delivery.status === "rate_limited");
    const record: TelegramSignalRecord = await this.repository.saveSignal({
      signalId: signal.signalId,
      schema: TELEGRAM_SIGNAL_SCHEMA,
      fingerprint: gate.fingerprint,
      idempotencyKey: gate.idempotencyKey,
      status: "published",
      symbol: signal.symbol,
      payload: signal,
      humanMessage,
      rejectionReasons: [],
      publishedAt: now,
      expiresAt: signal.validUntil,
      lastUpdateAt: now,
      metadata: { deliveryId: delivery.delivery.id, sourceEventRefs: input.sourceEventRefs ?? [], demoOnly: true },
    });
    telegramMetrics.increment("signalsPublished");
    emitTelegramEvent("TelegramSignalPublished", { signalId: signal.signalId, fingerprint: gate.fingerprint }, signal.signalId);
    return { published: true as const, record, delivery };
  }

  async publishTestSignal(now = new Date()) {
    const validUntil = new Date(now.getTime() + 30 * 60_000).toISOString();
    const demo = await demoRunService.status().catch(() => null);
    const risk = executionRiskService.snapshot();
    const session = marketSessionRulesService.evaluate({ assetClass: "forex", accountEquity: 100_000, currentMarginUsed: 0, projectedMarginUsed: 1_000, positionHeldOvernight: false, financingAcknowledged: false, now });
    return this.publish({
      signal: {
        signalId: randomUUID(),
        symbol: "EUR_USD",
        displaySymbol: "EUR/USD",
        side: "buy",
        entryType: "limit",
        entryPrice: 1.0842,
        stopLoss: 1.0818,
        takeProfit: 1.0888,
        riskReward: 1.92,
        timeframe: "1h",
        strategyId: "test-signal-do-not-execute",
        strategyVersion: 1,
        experimentId: "telegram-integration-test",
        confidence: 0.99,
        evidenceScore: 0.99,
        generatedAt: now.toISOString(),
        validUntil,
        reason: "TEST ONLY — DO NOT EXECUTE. Validates Telegram signal transport and schema.",
        invalidation: "TEST ONLY — DO NOT EXECUTE.",
      },
      demoRunRunning: demo?.state === "running",
      demoOnlyPolicyHealthy: true,
      killSwitchInactive: !risk.globalKillSwitch,
      marketDataFresh: true,
      providerHealthAcceptable: true,
      objectiveRuleSetExists: true,
      experimentExists: true,
      backtestEvidenceExists: true,
      validationVerdictPermitsObservation: true,
      stabilityThresholdPasses: true,
      minimumSampleSizePasses: true,
      rewardRiskAcceptable: true,
      eventLineageComplete: true,
      marketSessionAllowsEntry: session.marketHoursOpen,
      majorNewsBlackoutClear: true,
      sourceEventRefs: ["telegram-integration-test"],
    });
  }

  async lifecycleUpdate(input: Omit<TelegramSignalLifecycleUpdate, "id" | "createdAt">) {
    const signal = await this.repository.getSignal(input.signalId);
    if (!signal) throw new Error("Signal not found");
    const update: TelegramSignalLifecycleUpdate = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.repository.saveSignalUpdate(update);
    const updatedSignal = { ...signal, status: input.outcome, lastUpdateAt: update.createdAt };
    await this.repository.updateSignal(updatedSignal);
    telegramMetrics.recordSignalOutcome(input.outcome, input.resultR);
    const config = loadTelegramConfig(this.env);
    if (config.signalChatId) {
      await this.client.sendMessage({
        kind: "signal_update",
        destination: "signals",
        chatId: config.signalChatId,
        text: formatSignalLifecycle(update, signal.payload.displaySymbol),
        correlationId: input.signalId,
        metadata: { signalId: input.signalId, outcome: input.outcome, demoOnly: true },
      });
    }
    emitTelegramEvent("TelegramSignalLifecycleUpdated", { signalId: input.signalId, outcome: input.outcome }, input.signalId);
    return update;
  }

  private buildSignal(input: SignalQualityGateInput, fingerprint: string, idempotencyKey: string): FinCoachSignal {
    const config = loadTelegramConfig(this.env);
    const base: FinCoachSignal = {
      schema: TELEGRAM_SIGNAL_SCHEMA,
      signalId: input.signal.signalId,
      environment: "demo_research",
      symbol: input.signal.symbol,
      displaySymbol: input.signal.displaySymbol,
      side: input.signal.side,
      entryType: input.signal.entryType,
      entryPrice: input.signal.entryPrice,
      stopLoss: input.signal.stopLoss,
      takeProfit: input.signal.takeProfit,
      riskReward: input.signal.riskReward,
      timeframe: input.signal.timeframe,
      strategyId: input.signal.strategyId,
      strategyVersion: input.signal.strategyVersion,
      experimentId: input.signal.experimentId,
      confidence: input.signal.confidence,
      evidenceScore: input.signal.evidenceScore,
      generatedAt: input.signal.generatedAt,
      validUntil: input.signal.validUntil,
      demoOnly: true,
      fingerprint,
      idempotencyKey,
    };
    const signed = config.signalSigningSecret ? {
      ...base,
      signatureAlgorithm: "HMAC-SHA256" as const,
      signature: createHmac("sha256", config.signalSigningSecret).update(canonicalJson(base)).digest("hex"),
    } : base;
    return finCoachSignalSchema.parse(signed);
  }

  private buildRejectedSignal(input: SignalQualityGateInput, fingerprint: string, idempotencyKey: string): FinCoachSignal {
    const fallback = (value: number, replacement = 0.000001) => Number.isFinite(value) && value > 0 ? value : replacement;
    return {
      schema: TELEGRAM_SIGNAL_SCHEMA,
      signalId: input.signal.signalId,
      environment: "demo_research",
      symbol: input.signal.symbol || "UNKNOWN",
      displaySymbol: input.signal.displaySymbol || input.signal.symbol || "UNKNOWN",
      side: input.signal.side,
      entryType: input.signal.entryType,
      entryPrice: fallback(input.signal.entryPrice),
      stopLoss: fallback(input.signal.stopLoss),
      takeProfit: fallback(input.signal.takeProfit),
      riskReward: fallback(input.signal.riskReward),
      timeframe: input.signal.timeframe || "unknown",
      strategyId: input.signal.strategyId || "unknown",
      strategyVersion: Math.max(1, input.signal.strategyVersion || 1),
      experimentId: input.signal.experimentId || "unknown",
      confidence: clamp01(input.signal.confidence),
      evidenceScore: clamp01(input.signal.evidenceScore),
      generatedAt: input.signal.generatedAt,
      validUntil: input.signal.validUntil,
      demoOnly: true,
      fingerprint,
      idempotencyKey,
    };
  }
}

export function signalFingerprint(signal: SignalQualityGateInput["signal"]) {
  return createHash("sha256").update(canonicalJson({
    symbol: signal.symbol,
    side: signal.side,
    entryType: signal.entryType,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    timeframe: signal.timeframe,
    strategyId: signal.strategyId,
    strategyVersion: signal.strategyVersion,
    experimentId: signal.experimentId,
    validUntil: signal.validUntil,
  })).digest("hex");
}

function cooldownExpired(lastUpdateAt: string, cooldownMinutes: number) {
  if (cooldownMinutes <= 0) return true;
  return Date.now() - new Date(lastUpdateAt).getTime() >= cooldownMinutes * 60_000;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export const telegramSignalPublisher = new TelegramSignalPublisher();
