import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { AccountSyncService } from "./execution/accountSyncService";
import type {
  BrokerHealth,
  BrokerInstrument,
  DemoBrokerAdapter,
  PricingSnapshot,
  SandboxAccountSummary,
  SandboxOrderPreview,
  SandboxOrderResult,
  SandboxPosition,
  SandboxTrade,
} from "./execution/brokerSandbox";
import { SandboxBrokerError, sandboxFailureReason } from "./execution/brokerFailures";
import { EnvironmentCredentialVault, InMemoryCredentialVault, redactSensitive } from "./execution/credentialVault";
import type { OrderRequest } from "./execution/domain";
import { EventLogService } from "./eventLogService";
import { ExecutionAuditLog, ExecutionRiskService } from "./execution/riskControls";
import { SandboxExecutionMetrics } from "./execution/sandboxMetrics";
import { MetaTraderHttpDemoBridgeAdapter, type MetaTraderBridgeTransport } from "./execution/metaTraderDemoBridge";
import { OandaPracticeAdapter, type BrokerHttpClient } from "./execution/oandaPracticeAdapter";
import { SandboxOrderFlowService } from "./execution/sandboxOrderFlow";
import { ExecutionRiskPrecheckService, type RiskPrecheckContext } from "./execution/riskPrecheck";
import { getSymbolMapping, listSymbolMappings } from "./execution/symbolMapping";
import { selectSandboxExecutionCenterData } from "./execution/sandboxExecutionCenter";

const request: OrderRequest = {
  strategyId: "sandbox-trend",
  instrument: "EUR/USD",
  side: "buy",
  type: "market",
  units: 10_000,
  price: 1.1,
  stopLoss: 1.095,
  takeProfit: 1.11,
  mode: "supervised_live",
  explicitUserConfirmation: true,
  correlationId: "sandbox-flow-test",
};

async function main() {
const oandaCalls: Array<{ url: string; init: Parameters<BrokerHttpClient>[1] }> = [];
const oandaHttp: BrokerHttpClient = async (url, init) => {
  oandaCalls.push({ url, init });
  const now = new Date().toISOString();
  if (url.endsWith("/summary")) return response(200, { account: {
    id: "practice-101",
    currency: "USD",
    balance: "100000",
    NAV: "100100",
    marginUsed: "1000",
    marginAvailable: "99100",
    pendingOrderCount: "1",
    openPositionCount: "1",
    openTradeCount: "1",
  } });
  if (url.endsWith("/instruments")) return response(200, { instruments: [{ name: "EUR_USD" }, { name: "XAU_USD" }] });
  if (url.includes("/pricing?")) return response(200, { prices: [{
    instrument: "EUR_USD",
    time: now,
    tradeable: true,
    bids: [{ price: "1.1000" }],
    asks: [{ price: "1.1002" }],
  }] });
  if (url.endsWith("/orders") && init.method === "POST") return response(201, {
    orderFillTransaction: { id: "tx-1", orderID: "order-1", time: now },
  });
  if (url.endsWith("/orders/order-1")) return response(200, { order: { id: "order-1", state: "FILLED", createTime: now } });
  if (url.endsWith("/pendingOrders")) return response(200, { orders: [{ id: "pending-1", state: "PENDING", createTime: now }] });
  if (url.endsWith("/openPositions")) return response(200, { positions: [{
    instrument: "EUR_USD",
    long: { units: "10000", averagePrice: "1.1", unrealizedPL: "12.5" },
    short: { units: "0" },
  }] });
  if (url.endsWith("/openTrades")) return response(200, { trades: [{
    id: "trade-1",
    instrument: "EUR_USD",
    currentUnits: "10000",
    price: "1.1",
    openTime: now,
    state: "OPEN",
  }] });
  return response(404, { errorMessage: "not found" });
};

assert.throws(
  () => new OandaPracticeAdapter({ token: "token", accountId: "account", environment: "live" }, oandaHttp),
  /OANDA_ENV must be exactly practice/,
);
const oanda = new OandaPracticeAdapter({
  token: "super-secret-token",
  accountId: "practice-101",
  environment: "practice",
  maxPriceAgeMs: 60_000,
}, oandaHttp);
assert.equal((await oanda.health()).status, "healthy");
assert.equal((await oanda.getAccountSummary()).mode, "practice");
assert.deepEqual((await oanda.getInstruments()).map((item) => item.internalSymbol), ["EUR/USD", "XAU/USD"]);
assert.equal((await oanda.getPricingSnapshot("EUR/USD")).providerSymbol, "EUR_USD");
const oandaPreview = await oanda.previewOrder(request);
assert.equal(oandaPreview.productionOrderSubmissionEnabled, false);
assert.equal(oandaPreview.riskSummaryHash.length, 64);
const oandaOrder = await oanda.submitSandboxOrder(oandaPreview);
assert.equal(oandaOrder.status, "filled");
assert.equal((await oanda.getOrderStatus("order-1")).status, "filled");
assert.equal((await oanda.getPendingOrders()).length, 1);
assert.equal((await oanda.getOpenPositions())[0].instrument, "EUR/USD");
assert.equal((await oanda.getTrades())[0].state, "open");
assert.ok(oandaCalls.every((call) => call.init.headers.Authorization === "Bearer super-secret-token"));
assert.equal((await oanda.disconnect()).status, "disconnected");
await assert.rejects(() => oanda.getAccountSummary(), (error: unknown) => error instanceof SandboxBrokerError && error.code === "provider_disconnected");

const bridgeCalls: string[] = [];
const bridge: MetaTraderBridgeTransport = {
  async request(method, path) {
    bridgeCalls.push(`${method} ${path}`);
    const now = new Date().toISOString();
    if (path === "/health") return bridgeResponse({ environment: "demo", connected: true });
    if (path === "/account") return bridgeResponse({
      environment: "demo",
      accountId: "mt-demo",
      balance: 50_000,
      equity: 50_100,
      marginUsed: 100,
      marginAvailable: 50_000,
      currency: "USD",
    });
    if (path === "/symbols") return bridgeResponse({ environment: "demo", symbols: [{ symbol: "EUR/USD", providerSymbol: "EURUSD" }] });
    if (path.startsWith("/pricing/")) return bridgeResponse({ environment: "demo", bid: 1.1, ask: 1.1002, asOf: now });
    if (path === "/orders/preview") return bridgeResponse({
      environment: "demo",
      previewId: "9e72b5a0-4697-4f03-a762-e2cf85865ef6",
      accepted: true,
      estimatedPrice: 1.1002,
      estimatedMargin: 367,
      estimatedSpreadCost: 2,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    if (path === "/orders") return bridgeResponse({ environment: "demo", orderId: "mt-order-1", status: "filled", submittedAt: now });
    if (path === "/orders/mt-order-1") return bridgeResponse({ environment: "demo", orderId: "mt-order-1", status: "filled", submittedAt: now });
    if (path === "/orders?status=pending") return bridgeResponse({ environment: "demo", orders: [] });
    if (path === "/positions") return bridgeResponse({ environment: "demo", positions: [{
      id: "mt-position-1",
      symbol: "EUR/USD",
      providerSymbol: "EURUSD",
      side: "buy",
      units: 0.1,
      entryPrice: 1.1,
      unrealizedPnL: 4,
    }] });
    if (path === "/positions/mt-position-1/close") return bridgeResponse({ environment: "demo", orderId: "close-1", status: "filled" });
    if (path === "/disconnect") return bridgeResponse({ environment: "demo", disconnected: true });
    return { ok: false, status: 404, data: { message: "not found" } };
  },
};
const metaTrader = new MetaTraderHttpDemoBridgeAdapter(bridge);
assert.equal((await metaTrader.health()).environment, "demo");
assert.equal((await metaTrader.getAccountSummary()).accountId, "mt-demo");
assert.equal((await metaTrader.getInstruments())[0].tradeUnits, "lots");
assert.equal((await metaTrader.getPricingSnapshot("EURUSD")).providerSymbol, "EURUSD");
const mtPreview = await metaTrader.previewOrder(request);
assert.equal((await metaTrader.submitSandboxOrder(mtPreview)).status, "filled");
assert.equal((await metaTrader.getOrderStatus("mt-order-1")).status, "filled");
assert.equal((await metaTrader.getOpenPositions()).length, 1);
assert.equal((await metaTrader.closePosition("mt-position-1")).status, "filled");
assert.ok(bridgeCalls.includes("POST /orders"));

const memoryVault = new InMemoryCredentialVault();
await memoryVault.put({
  provider: "oanda",
  accountId: "practice-101",
  tokenReference: "secret-manager:oanda/practice",
  environment: "practice",
  createdAt: new Date().toISOString(),
  lastUsed: null,
  status: "active",
});
assert.equal((await memoryVault.get("oanda"))?.status, "active");
assert.ok((await memoryVault.markUsed("oanda"))?.lastUsed);
const envVault = new EnvironmentCredentialVault({
  OANDA_API_TOKEN: "secret",
  OANDA_ACCOUNT_ID: "practice-202",
  OANDA_ENV: "practice",
});
assert.equal((await envVault.get("oanda"))?.tokenReference, "env:OANDA_API_TOKEN");
const redacted = redactSensitive({
  token: "secret",
  nested: { Authorization: "Bearer secret", safe: "visible" },
}) as Record<string, unknown>;
assert.equal(redacted.token, "[REDACTED]");
assert.deepEqual(redacted.nested, { Authorization: "[REDACTED]", safe: "visible" });
assert.equal(JSON.stringify(redacted).includes("secret"), false);

assert.equal(listSymbolMappings("oanda_practice").length, 7);
for (const symbol of ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD", "WTI", "Brent"]) {
  const mapping = getSymbolMapping(symbol, "oanda_practice");
  assert.ok(mapping.pipSize > 0);
  assert.ok(mapping.tickSize > 0);
  assert.ok(mapping.minSize > 0);
  assert.ok(mapping.maxSize >= mapping.minSize);
  assert.ok(mapping.marginEstimate(10_000) > 0);
  assert.ok(mapping.marketHours.length > 0);
}
assert.throws(() => getSymbolMapping("BTC/USD", "oanda_practice"), /not supported/i);

const fakeAdapter = new FakeDemoAdapter();
const events = new EventLogService();
const audit = new ExecutionAuditLog();
const metrics = new SandboxExecutionMetrics();
const sync = new AccountSyncService(events, audit, metrics);
const synced = await sync.sync(fakeAdapter, "test-user");
assert.equal(synced.balance, 100_000);
assert.equal(synced.openPositions.length, 1);
assert.equal(events.countByType("sandbox.account_synced"), 1);
assert.equal(audit.list()[0].action, "sandbox.account.sync");
assert.equal(metrics.snapshot().accountSyncCount, 1);

const flowRisk = new ExecutionRiskService();
const flowAudit = new ExecutionAuditLog();
const flowEvents = new EventLogService();
const flowMetrics = new SandboxExecutionMetrics();
const flow = new SandboxOrderFlowService(
  new ExecutionRiskPrecheckService(),
  flowRisk,
  flowAudit,
  flowEvents,
  flowMetrics,
);
const flowPreviewId = fakeAdapter.preview.id;
const flowResult = await flow.execute({
  signal: { id: "signal-1", strategyId: request.strategyId, instrument: request.instrument, createdAt: new Date().toISOString() },
  request,
  strategyValidated: true,
  riskContext: healthyRiskContext,
  confirmation: {
    id: randomUUID(),
    accepted: true,
    reasons: [],
    orderPreviewId: flowPreviewId,
    userId: "test-user",
    brokerAccountId: "fake-demo",
    riskSummaryHash: fakeAdapter.preview.riskSummaryHash,
    confirmedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    singleUse: true,
    productionLiveSubmissionAllowed: false,
  },
  adapter: fakeAdapter,
  userId: "test-user",
});
assert.equal(flowResult.status, "completed");
if (flowResult.status === "completed") {
  assert.deepEqual(flowResult.stages.map((stage) => stage.stage), [
    "signal",
    "validation",
    "risk_precheck",
    "order_preview",
    "confirmation",
    "sandbox_submit",
    "order_status",
    "position_monitor",
    "journal_entry",
  ]);
  assert.equal(flowResult.journalEntry.productionOrderSubmissionEnabled, false);
}
assert.equal(flowEvents.countByType("sandbox.order_completed"), 1);
assert.equal(flowMetrics.snapshot().sandboxOrderCount, 1);

const killRisk = new ExecutionRiskService();
killRisk.triggerGlobalKillSwitch();
const killFlow = new SandboxOrderFlowService(
  new ExecutionRiskPrecheckService(),
  killRisk,
  new ExecutionAuditLog(),
  new EventLogService(),
  new SandboxExecutionMetrics(),
);
const killed = await killFlow.execute({
  signal: { id: "signal-2", strategyId: request.strategyId, instrument: request.instrument, createdAt: new Date().toISOString() },
  request,
  strategyValidated: true,
  riskContext: healthyRiskContext,
  confirmation: {
    id: randomUUID(),
    accepted: true,
    reasons: [],
    orderPreviewId: flowPreviewId,
    userId: "test-user",
    brokerAccountId: "fake-demo",
    riskSummaryHash: fakeAdapter.preview.riskSummaryHash,
    confirmedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    singleUse: true,
    productionLiveSubmissionAllowed: false,
  },
  adapter: fakeAdapter,
  userId: "test-user",
});
assert.equal(killed.status, "rejected");
if (killed.status === "rejected") assert.equal(killed.code, "kill_switch_active");

for (const code of [
  "stale_price",
  "order_rejected",
  "insufficient_margin",
  "provider_disconnected",
  "invalid_instrument",
  "rate_limited",
  "token_missing",
  "confirmation_expired",
  "kill_switch_active",
  "demo_environment_required",
] as const) {
  assert.ok(sandboxFailureReason(code).length > 10);
}

const panel = selectSandboxExecutionCenterData({
  health: await fakeAdapter.health(),
  account: await fakeAdapter.getAccountSummary(),
  positions: await fakeAdapter.getOpenPositions(),
  latestOrder: await fakeAdapter.getOrderStatus("fake-order"),
  killSwitchActive: false,
});
assert.deepEqual(Object.keys(panel.primary), [
  "connectionStatus",
  "accountMode",
  "equity",
  "marginAvailable",
  "openSandboxPositions",
  "latestSandboxOrderStatus",
  "emergencyControls",
]);
assert.equal(panel.safety.productionOrderSubmissionEnabled, false);
assert.equal("balance" in panel.primary, false);

console.log("sandbox broker integration tests passed");
}

function response(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function bridgeResponse(data: unknown) {
  return { ok: true, status: 200, data };
}

const healthyRiskContext: RiskPrecheckContext = {
  dataAgeSeconds: 1,
  maxDataAgeSeconds: 30,
  spread: 0.0002,
  maxSpread: 0.001,
  volatilityPct: 2,
  maxVolatilityPct: 8,
  dailyLoss: 0,
  maxDailyLoss: 250,
  openPositions: 0,
  maxOpenPositions: 3,
  symbolExposure: 0,
  requestedExposure: 11_000,
  maxSymbolExposure: 100_000,
  correlatedExposure: 0,
  maxCorrelatedExposure: 200_000,
  newsBlackoutActive: false,
  consecutiveLosses: 0,
  maxConsecutiveLosses: 4,
  strategyEnabled: true,
  killSwitchActive: false,
  accountConnected: true,
  accountLastSyncAgeSeconds: 1,
  maxAccountSyncAgeSeconds: 60,
};

class FakeDemoAdapter implements DemoBrokerAdapter {
  readonly id = "metatrader_demo" as const;
  readonly environment = "demo" as const;
  readonly productionOrderSubmissionEnabled = false as const;
  readonly preview: SandboxOrderPreview = {
    id: "9e72b5a0-4697-4f03-a762-e2cf85865ef6",
    provider: "metatrader_demo",
    environment: "demo",
    providerSymbol: "EURUSD",
    request,
    estimatedPrice: 1.1002,
    estimatedMargin: 367,
    estimatedSpreadCost: 2,
    riskSummaryHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    productionOrderSubmissionEnabled: false,
  };

  async health(): Promise<BrokerHealth> {
    return {
      provider: this.id,
      connected: true,
      environment: "demo",
      status: "healthy",
      reason: null,
      checkedAt: new Date().toISOString(),
      productionOrderSubmissionEnabled: false,
    };
  }

  async getAccountSummary(): Promise<SandboxAccountSummary> {
    return {
      provider: this.id,
      accountId: "fake-demo",
      mode: "demo",
      currency: "USD",
      balance: 100_000,
      equity: 100_100,
      marginUsed: 100,
      marginAvailable: 100_000,
      pendingOrderCount: 0,
      openPositionCount: 1,
      openTradeCount: 1,
    };
  }

  async getInstruments(): Promise<BrokerInstrument[]> {
    const { marginEstimate: _marginEstimate, ...mapping } = getSymbolMapping("EUR/USD", this.id);
    return [mapping];
  }

  async getPricingSnapshot(): Promise<PricingSnapshot> {
    return {
      provider: this.id,
      internalSymbol: "EUR/USD",
      providerSymbol: "EURUSD",
      bid: 1.1,
      ask: 1.1002,
      mid: 1.1001,
      status: "tradeable",
      asOf: new Date().toISOString(),
      stale: false,
    };
  }

  async previewOrder() {
    return this.preview;
  }

  async submitSandboxOrder(): Promise<SandboxOrderResult> {
    return {
      provider: this.id,
      orderId: "fake-order",
      status: "filled",
      reason: null,
      submittedAt: new Date().toISOString(),
      productionOrderSubmissionEnabled: false,
    };
  }

  async getOrderStatus(): Promise<SandboxOrderResult> {
    return this.submitSandboxOrder();
  }

  async getOpenPositions(): Promise<SandboxPosition[]> {
    return [{
      id: "position-1",
      instrument: "EUR/USD",
      providerSymbol: "EURUSD",
      side: "buy",
      units: 10_000,
      entryPrice: 1.1,
      unrealizedPnL: 10,
    }];
  }

  async getPendingOrders(): Promise<SandboxOrderResult[]> {
    return [];
  }

  async getTrades(): Promise<SandboxTrade[]> {
    return [{
      id: "trade-1",
      instrument: "EUR/USD",
      providerSymbol: "EURUSD",
      side: "buy",
      units: 10_000,
      price: 1.1,
      openedAt: new Date().toISOString(),
      state: "open",
    }];
  }

  async disconnect() {
    return {
      provider: this.id,
      connected: false,
      environment: "demo" as const,
      status: "disconnected" as const,
      reason: "Disconnected",
      checkedAt: new Date().toISOString(),
      productionOrderSubmissionEnabled: false as const,
    };
  }
}

await main();
