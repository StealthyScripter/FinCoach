import assert from "node:assert/strict";
import { AUTOMATION_LEVEL_ACKNOWLEDGEMENT, AutomationLevelService } from "./execution/automationLevels";
import { BrokerConnectionReadinessService } from "./execution/brokerConnectionReadiness";
import { selectExecutionCenterData } from "./execution/executionCenter";
import { commodityPositionSizingEngine, forexPositionSizingEngine } from "./execution/positionSizing";
import { ExecutionRiskPrecheckService } from "./execution/riskPrecheck";
import { signalQualityFilter } from "./execution/signalQuality";
import { StrategyValidationService } from "./execution/strategyValidation";
import { TradeLifecycleService } from "./execution/tradeLifecycle";

const validationService = new StrategyValidationService();
const strongValidation = validationService.evaluate({
  strategyId: "trend-v2",
  instrument: "EUR/USD",
  backtest: { netReturnPct: 24, sharpe: 1.8, profitFactor: 2.1, maxDrawdownPct: 8, tradeCount: 180 },
  walkForward: { profitableWindowsPct: 82, outOfSampleReturnPct: 14, degradationPct: 12 },
  monteCarlo: { profitableRunsPct: 91, medianEndingReturnPct: 18, riskOfRuinPct: 1 },
  regimePerformance: { trend: 18, range: 12, volatile: 8 },
  symbolPerformance: { "EUR/USD": 16 },
});
assert.equal(strongValidation.verdict, "supervised_live_candidate");
assert.equal(strongValidation.liveExecutionAuthorized, false);
assert.equal(strongValidation.overfittingWarning, false);

const rejectedValidation = validationService.unvalidated("new-strategy", "GBP/USD");
assert.equal(rejectedValidation.verdict, "reject");
assert.equal(rejectedValidation.tradeCountSufficiency, 0);

const automation = new AutomationLevelService();
assert.equal(automation.snapshot().level, 0);
assert.equal(automation.allows("signals"), false);
assert.equal(automation.allows("paper_auto_entry"), false);
automation.setLevel(4);
assert.equal(automation.allows("paper_auto_entry"), true);
assert.equal(automation.allows("paper_auto_exit"), true);
assert.equal(automation.allows("sandbox_execution"), true);
assert.equal(automation.allows("supervised_live_preview"), false);
automation.setLevel(5);
assert.equal(automation.snapshot().userConfirmationRequired, true);
assert.equal(automation.snapshot().liveOrderSubmissionAllowed, false);

const gatedAutomation = new AutomationLevelService();
assert.equal(gatedAutomation.requestTransition({
  targetLevel: 1,
  actorId: "operator",
  acknowledgement: "",
  registeredStrategyCount: 0,
  validatedStrategyCount: 0,
  constraintsConfigured: false,
  monitoringEnabled: true,
  killSwitchAvailable: true,
  sandboxReady: false,
  supervisedPermissionActive: false,
  semiAutonomousApproved: false,
  auditExportReady: false,
  semiAutonomousScope: null,
}).changed, false);
assert.equal(gatedAutomation.snapshot().level, 0);
assert.equal(gatedAutomation.requestTransition({
  targetLevel: 1,
  actorId: "operator",
  acknowledgement: AUTOMATION_LEVEL_ACKNOWLEDGEMENT,
  registeredStrategyCount: 0,
  validatedStrategyCount: 0,
  constraintsConfigured: false,
  monitoringEnabled: true,
  killSwitchAvailable: true,
  sandboxReady: false,
  supervisedPermissionActive: false,
  semiAutonomousApproved: false,
  auditExportReady: false,
  semiAutonomousScope: null,
}).changed, true);
assert.equal(gatedAutomation.requestTransition({
  targetLevel: 3,
  actorId: "operator",
  acknowledgement: AUTOMATION_LEVEL_ACKNOWLEDGEMENT,
  registeredStrategyCount: 1,
  validatedStrategyCount: 1,
  constraintsConfigured: true,
  monitoringEnabled: true,
  killSwitchAvailable: true,
  sandboxReady: true,
  supervisedPermissionActive: false,
  semiAutonomousApproved: false,
  auditExportReady: false,
  semiAutonomousScope: null,
}).changed, false);
automation.setLevel(6);
assert.equal(automation.allows("bounded_semi_autonomous_candidate"), true);
assert.equal(automation.snapshot().configuredConstraintsRequired, true);
assert.equal(automation.snapshot().continuousMonitoringRequired, true);
assert.equal(automation.snapshot().liveOrderSubmissionAllowed, false);

const lifecycleService = new TradeLifecycleService();
const lifecycle = lifecycleService.create({ strategyId: "trend-v2", instrument: "EUR/USD", correlationId: "lifecycle-test" });
lifecycleService.transition(lifecycle.id, "validated", "Validation passed");
lifecycleService.transition(lifecycle.id, "paper_order_created", "Paper order created");
lifecycleService.transition(lifecycle.id, "paper_filled", "Paper fill recorded");
lifecycleService.transition(lifecycle.id, "active", "Position active");
lifecycleService.transition(lifecycle.id, "target_triggered", "Target reached");
assert.equal(lifecycleService.get(lifecycle.id)?.predictionReviewRequired, true);
assert.throws(() => lifecycleService.transition(lifecycle.id, "active", "Invalid reopen"), /Invalid trade lifecycle transition/);
lifecycleService.transition(lifecycle.id, "reviewed", "Prediction reviewed");
assert.equal(lifecycleService.journal(lifecycle.id).predictionReviewRequired, false);
assert.equal(lifecycleService.journal(lifecycle.id).timeline.length, 7);

const precheckService = new ExecutionRiskPrecheckService();
const request = {
  strategyId: "trend-v2",
  instrument: "EUR/USD",
  side: "buy" as const,
  type: "market" as const,
  units: 10_000,
  price: 1.1,
  stopLoss: 1.095,
  mode: "paper" as const,
  explicitUserConfirmation: false,
  correlationId: "risk-v2-test",
};
const healthyRiskContext = {
  dataAgeSeconds: 2,
  maxDataAgeSeconds: 60,
  spread: 0.0001,
  maxSpread: 0.0005,
  volatilityPct: 2,
  maxVolatilityPct: 8,
  dailyLoss: 0,
  maxDailyLoss: 250,
  openPositions: 0,
  maxOpenPositions: 3,
  symbolExposure: 0,
  requestedExposure: 11_000,
  maxSymbolExposure: 50_000,
  correlatedExposure: 0,
  maxCorrelatedExposure: 100_000,
  newsBlackoutActive: false,
  consecutiveLosses: 0,
  maxConsecutiveLosses: 4,
  strategyEnabled: true,
  killSwitchActive: false,
  accountConnected: true,
  accountLastSyncAgeSeconds: 2,
  maxAccountSyncAgeSeconds: 60,
};
assert.equal(precheckService.evaluate(request, healthyRiskContext).action, "approve");
assert.equal(precheckService.evaluate(request, { ...healthyRiskContext, volatilityPct: 20 }).action, "reduce_size");
assert.equal(precheckService.evaluate(request, { ...healthyRiskContext, newsBlackoutActive: true }).action, "wait");
assert.equal(precheckService.evaluate(request, { ...healthyRiskContext, correlatedExposure: 95_000 }).action, "manual_review");
assert.equal(precheckService.evaluate(request, { ...healthyRiskContext, killSwitchActive: true }).action, "reject");

for (const symbol of ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD"] as const) {
  const entryPrice = symbol === "USD/JPY" ? 158 : symbol === "XAU/USD" ? 2_350 : symbol === "XAG/USD" ? 30 : 1.25;
  const stopPrice = entryPrice - (symbol === "USD/JPY" ? 0.5 : symbol === "XAU/USD" ? 10 : symbol === "XAG/USD" ? 0.5 : 0.005);
  const sizing = forexPositionSizingEngine.calculate({
    symbol,
    accountBalance: 100_000,
    accountCurrency: "USD",
    riskPerTradePct: 0.5,
    entryPrice,
    stopPrice,
    maxLeverage: 5,
  });
  assert.ok(sizing.pipValuePerStandardLot > 0);
  assert.ok(sizing.finalPositionSize.lots <= sizing.maxSafePositionSize.lots);
  assert.ok(sizing.marginEstimate <= 100_000);
}

for (const symbol of ["XAU/USD", "XAG/USD", "WTI", "Brent"] as const) {
  const entryPrice = symbol === "XAU/USD" ? 2_350 : symbol === "XAG/USD" ? 30 : 78;
  const sizing = commodityPositionSizingEngine.calculate({
    symbol,
    accountBalance: 100_000,
    riskPerTradePct: 0.5,
    entryPrice,
    stopPrice: entryPrice - 2,
    maxLeverage: 5,
    volatilityMultiplier: 0.75,
    maxRiskCap: 400,
  });
  assert.ok(sizing.tickValue > 0);
  assert.ok(sizing.finalPositionSize <= sizing.maxSafePositionSize);
  assert.equal(sizing.riskPerTrade, 400);
}

assert.equal(signalQualityFilter.evaluate({
  sourceReliability: 90,
  strategyValidationScore: 85,
  timeframeQuality: 80,
  trendAlignment: 90,
  volatilityRegime: 75,
  spreadLiquidityCondition: 90,
  recentFalseSignalRate: 10,
  newsRisk: 10,
  riskRewardRatio: 2.5,
}).decision, "accept");
assert.equal(signalQualityFilter.evaluate({
  sourceReliability: 20,
  strategyValidationScore: 85,
  timeframeQuality: 80,
  trendAlignment: 90,
  volatilityRegime: 75,
  spreadLiquidityCondition: 90,
  recentFalseSignalRate: 10,
  newsRisk: 10,
  riskRewardRatio: 2.5,
}).decision, "reject");

const readinessService = new BrokerConnectionReadinessService();
const ready = readinessService.evaluate({
  provider: "demo",
  credentialsConfigured: true,
  credentialsEncrypted: true,
  providerReachable: true,
  accountMode: "paper",
  expectedEnvironment: "paper",
  marginAvailable: 10_000,
  minimumMarginRequired: 1_000,
  permissions: ["market_data", "paper_orders"],
  requiredPermissions: ["market_data", "paper_orders"],
  supportedInstruments: ["EUR/USD"],
  requiredInstruments: ["EUR/USD"],
  rateLimitRemaining: 100,
  minimumRateLimitRemaining: 10,
  lastSyncAt: "2026-06-18T14:00:00.000Z",
  maxSyncAgeSeconds: 60,
  emergencyDisconnectAvailable: true,
}, new Date("2026-06-18T14:00:10.000Z"));
assert.equal(ready.readyForPaper, true);
assert.equal(ready.liveOrderSubmissionAllowed, false);
assert.equal(readinessService.evaluate({
  provider: "live-mismatch",
  credentialsConfigured: true,
  credentialsEncrypted: true,
  providerReachable: true,
  accountMode: "live",
  expectedEnvironment: "paper",
  marginAvailable: 10_000,
  minimumMarginRequired: 1_000,
  permissions: [],
  requiredPermissions: ["orders"],
  supportedInstruments: [],
  requiredInstruments: ["EUR/USD"],
  rateLimitRemaining: 0,
  minimumRateLimitRemaining: 10,
  lastSyncAt: null,
  maxSyncAgeSeconds: 60,
  emergencyDisconnectAvailable: false,
}).readyForSupervisedLivePreview, false);

const projection = selectExecutionCenterData({
  automation: automation.snapshot(),
  killSwitchActive: false,
  latestSignals: Array.from({ length: 8 }, (_, index) => ({ id: `signal-${index}` })),
  positions: [],
  strategyValidations: [strongValidation],
  riskPrecheck: precheckService.evaluate(request, healthyRiskContext),
  auditLog: [],
  brokerReadiness: ready,
});
assert.equal(projection.primary.latestSignals.length, 5);
assert.equal(projection.primary.strategyValidationVerdicts[0].verdict, "supervised_live_candidate");
assert.deepEqual(Object.keys(projection.advanced), ["backtests", "strategyValidation", "brokerReadiness", "auditLog", "circuitBreakers", "liveReadinessDetails"]);
assert.equal(projection.safety.liveOrderPlacementEnabled, false);

console.log("execution v2 tests passed");
