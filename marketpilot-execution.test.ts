import assert from "node:assert/strict";
import {
  DemoExecutionProvider,
  MetaTraderExecutionProvider,
  OandaExecutionProvider,
  PaperExecutionProvider,
  RobinhoodCryptoExecutionProvider,
} from "./server/execution/providers";
import { INSTRUMENTS, normalizeSymbol, strategyDefinitionSchema } from "./server/execution/domain";
import { marketBacktestingService } from "./server/execution/marketBacktesting";
import { signTradingViewSignal, TradingViewWebhookSignalProvider } from "./server/execution/tradingViewWebhook";
import { PaperAutomationService } from "./server/execution/paperAutomation";
import { DEFAULT_AUTONOMY_POLICY, ExecutionRiskService, summarizePositions } from "./server/execution/riskControls";
import { evaluateLiveReadiness } from "./server/execution/liveReadiness";

async function main() {
const now = Date.parse("2026-06-18T14:00:00.000Z");

assert.equal(INSTRUMENTS.length, 7);
assert.equal(normalizeSymbol("EUR_USD")?.symbol, "EUR/USD");
assert.equal(normalizeSymbol("TVC:USOIL")?.symbol, "WTI");

for (const provider of [
  new DemoExecutionProvider(),
  new PaperExecutionProvider(),
  new OandaExecutionProvider(),
  new MetaTraderExecutionProvider(),
  new RobinhoodCryptoExecutionProvider(),
]) {
  assert.equal(typeof provider.getAccount, "function");
  assert.equal(typeof provider.placeMarketOrder, "function");
  assert.equal(typeof provider.placeLimitOrder, "function");
  assert.equal(typeof provider.placeStopOrder, "function");
  assert.equal(typeof provider.getPositions, "function");
  assert.equal(typeof provider.getFills, "function");
}

const signal = {
  symbol: "EUR/USD",
  direction: "buy" as const,
  strategyName: "London breakout",
  timeframe: "15m",
  price: 1.1,
  stopLoss: 1.095,
  takeProfit: 1.11,
  confidence: 78,
  timestamp: new Date(now).toISOString(),
  nonce: "nonce-12345678",
};
const signed = { ...signal, signature: signTradingViewSignal(signal, "test-secret") };
const webhook = new TradingViewWebhookSignalProvider("test-secret", 300_000, () => now);
assert.equal(webhook.receive(signed).status, "signal accepted");
assert.equal(webhook.receive(signed).status, "signal rejected");
assert.equal(new TradingViewWebhookSignalProvider("wrong", 300_000, () => now).receive(signed).accepted, false);

const series = Array.from({ length: 24 }, (_, index) => {
  const open = 1.08 + index * 0.001;
  return {
    timestamp: new Date(now + index * 3_600_000).toISOString(),
    open,
    high: open + 0.004,
    low: open - 0.003,
    close: open + (index % 3 === 0 ? -0.001 : 0.002),
    volume: 1_000 + index,
  };
});
for (const instrument of ["EUR/USD", "XAU/USD"]) {
  const result = marketBacktestingService.run({
    strategyName: "fixture trend",
    instrument,
    initialCapital: 100_000,
    riskPerTradePct: 0.5,
    leverage: 5,
    spread: 0.0001,
    slippage: 0.00002,
    commissionPerTrade: 1,
    stopLossPips: 20,
    takeProfitPips: 40,
    trailingStopPips: 10,
    walkForwardRatio: 0.7,
    monteCarloRuns: 50,
    series: instrument === "XAU/USD" ? series.map((bar) => ({
      ...bar,
      open: bar.open * 2_000,
      high: bar.high * 2_000,
      low: bar.low * 2_000,
      close: bar.close * 2_000,
    })) : series,
  });
  assert.equal(result.instrument, instrument);
  assert.ok(result.tradeCount > 0);
  assert.equal(typeof result.maxDrawdownPct, "number");
  assert.equal(typeof result.riskOfRuinPct, "number");
}

const strategy = strategyDefinitionSchema.parse({
  id: "london-breakout",
  name: "London breakout",
  type: "breakout",
  entryRule: "Buy above the session range high after confirmation",
  exitRule: "Exit at target or session close",
  stopRule: "Hard stop below the session range low",
  riskPerTradePct: 0.5,
  maxTradesPerDay: 2,
  allowedInstruments: ["EUR/USD"],
  allowedSession: "London",
  invalidationRule: "Range breakout closes back inside range",
  enabled: true,
});
assert.ok(strategy.stopRule.length > 0);

const paperAutomation = new PaperAutomationService();
paperAutomation.registerStrategy(strategy);
const paperResult = await paperAutomation.executeSignal(signal, strategy.id);
assert.equal(paperResult.status, "paper strategy created");

const readiness = evaluateLiveReadiness({
  brokerConnected: true,
  accountSynced: true,
  credentialsEncrypted: true,
  mfaAcknowledged: true,
  proficiencyGatesPassed: true,
  liveRiskLimitsConfigured: true,
  dailyLossLimitConfigured: true,
  maxTradeSizeConfigured: true,
  killSwitchEnabled: true,
  complianceDisclosureAcknowledged: true,
});
assert.equal(readiness.readyForOrderPreview, true);
assert.equal(readiness.liveOrderSubmissionAllowed, false);
assert.equal(readiness.explicitUserConfirmationRequired, true);
assert.equal(DEFAULT_AUTONOMY_POLICY.enabled, false);

const risk = new ExecutionRiskService();
risk.triggerGlobalKillSwitch();
assert.equal(risk.check({
  strategyId: "test",
  instrument: "EUR/USD",
  side: "buy",
  type: "market",
  units: 1,
  price: 1.1,
  stopLoss: 1,
  mode: "paper",
  explicitUserConfirmation: false,
  correlationId: "test",
}).allowed, false);

const summary = summarizePositions([{
  id: "position-1",
  instrument: "EUR/USD",
  side: "buy",
  units: 1_000,
  entryPrice: 1.1,
  currentPrice: 1.101,
  stopLoss: 1.095,
  takeProfit: 1.11,
  unrealizedPnL: 1,
  realizedPnL: 0,
  marginUsed: 36.7,
  stopLossStatus: "active",
  takeProfitStatus: "active",
  staleData: false,
  openedAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
}]);
assert.equal(summary.openPositions, 1);
assert.equal(summary.unrealizedPnL, 1);

console.log("marketpilot execution foundation tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
