import { randomUUID } from "crypto";
import type { StrategyDefinition } from "./domain";
import { orderRequestSchema, strategyDefinitionSchema, tradingSignalSchema } from "./domain";
import { paperExecutionProvider } from "./providers";
import { executionAuditLog, executionRiskService } from "./riskControls";
import { automationLevelService } from "./automationLevels";
import { signalQualityFilter, type SignalQualityInput } from "./signalQuality";
import { strategyValidationService, type StrategyValidationInput, type StrategyValidationScorecard } from "./strategyValidation";
import { tradeLifecycleService } from "./tradeLifecycle";
import { executionEmergencyState } from "./emergencyControls";

export class PaperAutomationService {
  private strategies = new Map<string, StrategyDefinition>();
  private validations = new Map<string, StrategyValidationScorecard>();
  private journal: Array<Record<string, unknown>> = [];

  registerStrategy(input: StrategyDefinition) {
    const strategy = strategyDefinitionSchema.parse(input);
    this.strategies.set(strategy.id, strategy);
    this.validations.set(strategy.id, strategyValidationService.unvalidated(strategy.id, strategy.allowedInstruments[0]));
    return strategy;
  }

  listStrategies() {
    return Array.from(this.strategies.values());
  }

  validateStrategy(input: StrategyValidationInput) {
    const scorecard = strategyValidationService.evaluate(input);
    if (!this.strategies.has(scorecard.strategyId)) throw new Error("Strategy is not registered");
    this.validations.set(scorecard.strategyId, scorecard);
    return scorecard;
  }

  listStrategyValidations() {
    return Array.from(this.validations.values());
  }

  async processAutonomousSignal(input: unknown, strategyId: string, quality: SignalQualityInput) {
    if (executionEmergencyState.signalsFrozen) {
      return this.reject(randomUUID(), "New signals are frozen by emergency controls");
    }
    if (!automationLevelService.allows("paper_auto_entry")) {
      return this.reject(randomUUID(), `Automation Level ${automationLevelService.snapshot().level} does not allow paper auto-entry`);
    }
    const qualityDecision = signalQualityFilter.evaluate(quality);
    if (qualityDecision.decision !== "accept" && qualityDecision.decision !== "paper_only") {
      return this.reject(randomUUID(), `Signal quality decision: ${qualityDecision.decision}`);
    }
    return this.executeSignal(input, strategyId);
  }

  // This method represents an explicit API/user invocation. Background automation
  // must use processAutonomousSignal so automation-level gates cannot be bypassed.
  async executeSignal(input: unknown, strategyId: string) {
    if (executionEmergencyState.signalsFrozen) {
      return this.reject(randomUUID(), "New signals are frozen by emergency controls");
    }
    const parsedSignal = tradingSignalSchema.safeParse(input);
    const correlationId = randomUUID();
    if (!parsedSignal.success) return this.reject(correlationId, "Signal verification failed");
    const signal = parsedSignal.data;
    const lifecycle = tradeLifecycleService.create({
      strategyId,
      instrument: signal.symbol,
      correlationId,
      metadata: { source: "paper_automation" },
    });
    const strategy = this.strategies.get(strategyId);
    if (!strategy || !strategy.enabled) return this.rejectLifecycle(lifecycle.id, correlationId, "Strategy is missing or disabled");
    if (!strategy.allowedInstruments.includes(signal.symbol)) return this.rejectLifecycle(lifecycle.id, correlationId, "Instrument is not allowed by strategy");
    if (!strategy.stopRule || !signal.stopLoss) return this.rejectLifecycle(lifecycle.id, correlationId, "Every automated strategy requires stop logic");
    if (signal.strategyName !== strategy.name) return this.rejectLifecycle(lifecycle.id, correlationId, "Signal strategy does not match registered strategy");
    if (signal.confidence < 60) return this.rejectLifecycle(lifecycle.id, correlationId, "Signal requires verification review below 60 confidence");
    const today = new Date().toISOString().slice(0, 10);
    const tradesToday = this.journal.filter((entry) => entry.strategyId === strategyId && String(entry.createdAt).startsWith(today)).length;
    if (tradesToday >= strategy.maxTradesPerDay) return this.rejectLifecycle(lifecycle.id, correlationId, "Strategy daily trade limit reached");
    tradeLifecycleService.transition(lifecycle.id, "validated", "Signal and strategy validation passed");

    const units = calculatePaperUnits(100_000, strategy.riskPerTradePct, signal.price, signal.stopLoss);
    const request = orderRequestSchema.parse({
      strategyId,
      instrument: signal.symbol,
      side: signal.direction === "buy" || signal.direction === "long" ? "buy" : "sell",
      type: "market",
      units,
      price: signal.price,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      mode: "paper",
      correlationId,
    });
    const risk = executionRiskService.check(request);
    if (!risk.allowed) return this.rejectLifecycle(lifecycle.id, correlationId, risk.reasons.join("; "));

    tradeLifecycleService.transition(lifecycle.id, "paper_order_created", "Paper order request created");
    const order = await paperExecutionProvider.placeMarketOrder(request);
    if (order.status !== "filled") return this.rejectLifecycle(lifecycle.id, correlationId, order.rejectionReason ?? "Paper fill failed");
    tradeLifecycleService.transition(lifecycle.id, "paper_filled", "Paper provider simulated the fill", { orderId: order.id });
    tradeLifecycleService.transition(lifecycle.id, "active", "Paper position monitoring started", { orderId: order.id });
    const fills = await paperExecutionProvider.getFills();
    const fill = fills.find((item) => item.orderId === order.id);
    const journalEntry = {
      id: randomUUID(),
      correlationId,
      strategyId,
      signal,
      orderId: order.id,
      fillId: fill?.id,
      lifecycleId: lifecycle.id,
      reviewStatus: "prediction review pending",
      createdAt: new Date().toISOString(),
    };
    this.journal.push(journalEntry);
    executionAuditLog.append({
      action: "paper.automation",
      outcome: "created",
      correlationId,
      detail: { strategyId, orderId: order.id, journalEntryId: journalEntry.id },
    });
    return {
      status: "paper strategy created" as const,
      workflow: ["strategy rule validation", "verification", "risk check", "paper order", "simulated fill", "monitoring", "journal entry", "prediction review"],
      order,
      fill,
      journalEntry,
      lifecycle: tradeLifecycleService.get(lifecycle.id),
    };
  }

  getJournal() {
    return [...this.journal].reverse();
  }

  private reject(correlationId: string, reason: string) {
    executionAuditLog.append({ action: "paper.automation", outcome: "rejected", correlationId, detail: { reason } });
    return { status: "signal rejected" as const, reason, correlationId };
  }

  private rejectLifecycle(lifecycleId: string, correlationId: string, reason: string) {
    tradeLifecycleService.transition(lifecycleId, "rejected", reason);
    return this.reject(correlationId, reason);
  }
}

function calculatePaperUnits(equity: number, riskPct: number, entry: number, stop: number) {
  const riskBudget = equity * (riskPct / 100);
  return Math.max(1, Math.floor(riskBudget / Math.abs(entry - stop)));
}

export const paperAutomationService = new PaperAutomationService();
