import assert from "node:assert/strict";
import { DemoOnlyPolicyError, DemoOnlyPolicyService } from "./execution/demoOnlyPolicy";
import { ToolConnectorRegistryService } from "./toolConnectorRegistryService";
import { signTradingViewSignal, TradingViewWebhookSignalProvider } from "./execution/tradingViewWebhook";
import { executionAuditLog } from "./execution/riskControls";

const now = new Date("2026-01-15T14:00:00.000Z");

const policy = new DemoOnlyPolicyService({ MARKETPILOT_DEMO_ONLY: "true" });
assert.equal(policy.check({
  provider: "paper_provider",
  accountMode: "paper",
  verificationSource: "paperExecutionProvider.metadata",
  attemptedAction: "paper.order",
  now,
}).allowed, true);
assert.equal(policy.check({
  provider: "oanda_sandbox",
  accountMode: "sandbox",
  verificationSource: "oanda_sandbox.syncAccount",
  attemptedAction: "sandbox.submit",
  now,
}).allowed, true);
assert.equal(policy.check({
  provider: "unknown_provider",
  accountMode: "unknown",
  verificationSource: "unverified",
  attemptedAction: "broker.submit",
  now,
}).blocked, true);
assert.equal(policy.check({
  provider: "oanda_practice",
  accountMode: "live",
  verificationSource: "oanda.accountSummary",
  attemptedAction: "broker.submit",
  now,
}).blocked, true);
assert.equal(policy.check({
  provider: "generic_rest_broker",
  accountMode: "sandbox",
  verificationSource: "generic.metadata",
  attemptedAction: "broker.submit",
  now,
}).blocked, true);
assert.throws(() => policy.assertAllowed({
  provider: "metatrader_demo",
  accountMode: "live",
  verificationSource: "metatrader.accountSummary",
  attemptedAction: "metatrader.bridge.submit",
  actor: "test",
  source: "demo-only-policy-test",
  now,
}), DemoOnlyPolicyError);

assert.equal(new DemoOnlyPolicyService({ MARKETPILOT_DEMO_ONLY: "false" }).validateEnvironment().safe, false);
assert.deepEqual(new DemoOnlyPolicyService({ OANDA_ENV: "practice" }).validateEnvironment().violations, []);
assert.ok(new DemoOnlyPolicyService({ OANDA_ENV: "live" }).validateEnvironment().violations.some((item) => item.includes("OANDA_ENV=live")));
assert.ok(new DemoOnlyPolicyService({ METATRADER_ENV: "live" }).validateEnvironment().violations.some((item) => item.includes("METATRADER_ENV=live")));
assert.ok(new DemoOnlyPolicyService({ BROKER_ENV: "production" }).validateEnvironment().violations.some((item) => item.includes("BROKER_ENV=production")));
assert.ok(new DemoOnlyPolicyService({ EXECUTION_MODE: "live" }).validateEnvironment().violations.some((item) => item.includes("EXECUTION_MODE=live")));
assert.ok(new DemoOnlyPolicyService({ MARKETPILOT_ALLOW_LIVE_EXECUTION: "true" }).validateEnvironment().violations.some((item) => item.includes("MARKETPILOT_ALLOW_LIVE_EXECUTION=true")));

const registry = new ToolConnectorRegistryService({
  MARKETPILOT_DEMO_ONLY: "true",
  OANDA_API_TOKEN: "token",
  OANDA_ACCOUNT_ID: "account",
  OANDA_ENV: "practice",
  METATRADER_DEMO_BRIDGE_URL: "https://bridge.example",
  TRADINGVIEW_WEBHOOK_SECRET: "secret",
});
const snapshot = registry.snapshot(now);
const oanda = snapshot.connectors.find((connector) => connector.id === "oanda_practice");
const generic = snapshot.connectors.find((connector) => connector.id === "generic_rest_broker");
assert.equal(oanda?.accountMode, "practice");
assert.equal(oanda?.demoVerificationStatus, "verified");
assert.equal(oanda?.executionAllowed, true);
assert.equal(oanda?.liveCapabilityDisabledReason, "Live capability disabled by MarketPilot demo-only policy.");
assert.equal(generic?.demoVerificationStatus, "unverified");
assert.equal(generic?.executionAllowed, false);

const secret = "tradingview-secret";
const signal = {
  strategyName: "Demo Strategy",
  symbol: "EUR_USD",
  direction: "buy" as const,
  timeframe: "1m",
  price: 1.1,
  stopLoss: 1.09,
  takeProfit: 1.12,
  confidence: 80,
  timestamp: now.toISOString(),
  nonce: "demo-only-policy-tv-1",
};
const provider = new TradingViewWebhookSignalProvider(secret, 5 * 60_000, () => now.getTime());
const result = provider.receive({ ...signal, signature: signTradingViewSignal(signal, secret) });
assert.equal(result.accepted, true);
const tradingViewAudit = executionAuditLog.list().find((entry) => entry.correlationId === result.correlationId);
assert.equal((tradingViewAudit?.detail as Record<string, unknown>)?.executionAllowed, false);

console.log("demoOnlyPolicy tests passed");
