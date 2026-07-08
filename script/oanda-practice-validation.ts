import { randomUUID } from "crypto";
import { Client } from "pg";
import { BacktestService } from "../server/strategy-machine/backtesting";
import { DemoExecutionService } from "../server/strategy-machine/demo-execution";
import { ExperimentManagerService } from "../server/strategy-machine/experiment-manager";
import { ForwardTestService } from "../server/strategy-machine/forward-testing";
import { HypothesisService } from "../server/strategy-machine/hypothesis";
import { TradeJournalService } from "../server/strategy-machine/journal";
import { MarketDataService, type Candle } from "../server/strategy-machine/market-data";
import { PatternDiscoveryService } from "../server/strategy-machine/pattern-discovery";
import { RuleBuilderService, type RuleSet } from "../server/strategy-machine/rule-builder";
import { TelemetryService } from "../server/strategy-machine/telemetry";
import { ValidationService } from "../server/strategy-machine/validation";
import { createEvent, toEventReference, type EventEnvelope } from "../server/strategy-machine/core";
import { createOandaPracticeAdapterFromEnv } from "../server/execution/oandaPracticeAdapter";
import { DemoOnlyPolicyService } from "../server/execution/demoOnlyPolicy";
import { executionAuditLog, executionRiskService } from "../server/execution/riskControls";
import { strategyEvidenceStore } from "../server/execution/strategyEvidenceStore";
import { eventLogService } from "../server/eventLogService";
import { ToolConnectorRegistryService } from "../server/toolConnectorRegistryService";
import type { OrderRequest } from "../server/execution/domain";

const supportedSymbols = ["EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "XAG/USD"];
const baseUrl = "https://api-fxpractice.oanda.com/v3";

type ValidationReport = {
  oandaPracticeHealth: Record<string, unknown>;
  accountModeVerification: Record<string, unknown>;
  instrumentsFound: string[];
  selectedSymbol: string | null;
  pricingSnapshot: Record<string, unknown> | null;
  practiceTrade: {
    placed: boolean;
    reason: string;
    orderId: string | null;
    tradeId: string | null;
    closeStatus: string | null;
  };
  records: Record<string, unknown>;
  safetyBlocks: string[];
};

async function main() {
  const env = process.env;
  const tokenConfigured = Boolean(env.OANDA_API_TOKEN?.trim());
  const accountIdConfigured = Boolean(env.OANDA_ACCOUNT_ID?.trim());
  const envMode = env.OANDA_ENV?.trim().toLowerCase() ?? "";
  const externalTradeAllowed = env.OANDA_VALIDATION_ALLOW_EXTERNAL_TRADE?.trim().toLowerCase() === "true";
  const safetyBlocks: string[] = [];

  if (envMode !== "practice") safetyBlocks.push("OANDA_ENV is not practice.");
  if (!accountIdConfigured) safetyBlocks.push("OANDA_ACCOUNT_ID is not configured.");
  if (!tokenConfigured) safetyBlocks.push("OANDA_API_TOKEN is not configured.");
  if (safetyBlocks.length > 0) {
    printReport({
      oandaPracticeHealth: { status: "blocked" },
      accountModeVerification: { envMode, accountIdConfigured, tokenConfigured, verified: false },
      instrumentsFound: [],
      selectedSymbol: null,
      pricingSnapshot: null,
      practiceTrade: { placed: false, reason: safetyBlocks.join(" "), orderId: null, tradeId: null, closeStatus: null },
      records: {},
      safetyBlocks,
    });
    process.exit(1);
  }

  const adapter = createOandaPracticeAdapterFromEnv(env);
  const policy = new DemoOnlyPolicyService(env);
  const registry = new ToolConnectorRegistryService(env);
  const connector = registry.snapshot().connectors.find((item) => item.id === "oanda_practice");
  const health = await adapter.health();
  const account = await adapter.getAccountSummary();
  const policyResult = policy.check({
    provider: "oanda_practice",
    accountMode: account.mode,
    verificationSource: "oanda_practice.getAccountSummary",
    attemptedAction: "oanda.practice.validation",
    metadata: { productionOrderSubmissionEnabled: adapter.productionOrderSubmissionEnabled },
  });

  if (!policyResult.allowed) safetyBlocks.push(policyResult.reason);
  if (account.mode !== "practice") safetyBlocks.push(`Account mode is ${account.mode}, expected practice.`);
  if (adapter.productionOrderSubmissionEnabled !== false) safetyBlocks.push("Adapter production submission flag is not false.");
  if (connector?.executionAllowed !== true) safetyBlocks.push(`Connector execution is not allowed: ${connector?.executionBlockedReason ?? "unknown"}`);

  const instruments = await adapter.getInstruments();
  const instrumentsFound = instruments
    .map((item) => item.displayName)
    .filter((symbol) => supportedSymbols.includes(symbol));
  const selectedSymbol = instrumentsFound.includes("EUR/USD") ? "EUR/USD" : instrumentsFound[0] ?? null;
  if (!selectedSymbol) safetyBlocks.push("No required supported OANDA practice instrument was found.");
  if (safetyBlocks.length > 0 || !selectedSymbol) {
    printReport({
      oandaPracticeHealth: redactHealth(health),
      accountModeVerification: verification(account, envMode, accountIdConfigured, tokenConfigured, policyResult.allowed),
      instrumentsFound,
      selectedSymbol,
      pricingSnapshot: null,
      practiceTrade: { placed: false, reason: safetyBlocks.join(" "), orderId: null, tradeId: null, closeStatus: null },
      records: { connectorHealth: connector?.health ?? null },
      safetyBlocks,
    });
    process.exit(1);
  }

  const price = await adapter.getPricingSnapshot(selectedSymbol);
  const marketData = new MarketDataService();
  const snapshotEvent = marketData.createSnapshot({
    instrument: selectedSymbol,
    bid: price.bid,
    ask: price.ask,
    provider: "oanda_practice",
    observedAt: new Date(price.asOf),
  });
  const spreadEvent = marketData.detectSpread(snapshotEvent);
  const sessionEvent = marketData.detectSession(selectedSymbol, new Date(price.asOf));
  const economicEvent = marketData.attachEconomicContext(selectedSymbol, new Date(price.asOf), [toEventReference(snapshotEvent)]);
  const candles = await loadCandles(env.OANDA_ACCOUNT_ID!, env.OANDA_API_TOKEN!, price.providerSymbol);

  const events: EventEnvelope[] = [snapshotEvent, spreadEvent, sessionEvent, economicEvent];
  let backtestEvent: EventEnvelope | null = null;
  let validationEvent: EventEnvelope | null = null;
  let ruleSet: RuleSet | null = null;

  let patternEvents: EventEnvelope[] = [];
  if (candles.length > 0) {
    const candleEvent = marketData.createCandleSeries(candles, [toEventReference(snapshotEvent)]);
    events.push(candleEvent);
    patternEvents = new PatternDiscoveryService().detect({
      instrument: price.internalSymbol.replace("/", "_"),
      timeframe: "1m",
      candles,
      sourceEventRefs: [toEventReference(candleEvent)],
    });
    events.push(...patternEvents);
    const hypothesisEvent = new HypothesisService().fromPatterns(patternEvents);
    events.push(hypothesisEvent);
    const ruleEvent = new RuleBuilderService().createFromHypothesis(hypothesisEvent);
    events.push(ruleEvent);
    if (ruleEvent.type === "RuleSetCreated") {
      ruleSet = ruleEvent.payload as unknown as RuleSet;
      const experimentEvent = new ExperimentManagerService().create({
        name: `${selectedSymbol} OANDA practice validation`,
        refs: {
          observationRefs: [toEventReference(snapshotEvent), toEventReference(candleEvent)],
          patternRefs: patternEvents.filter((event) => event.type === "PatternDetected").map(toEventReference),
          hypothesisRefs: [toEventReference(hypothesisEvent)],
          ruleSetRefs: [toEventReference(ruleEvent)],
        },
      });
      events.push(experimentEvent);
      backtestEvent = new BacktestService().run({
        experimentId: String(experimentEvent.payload.experimentId),
        ruleSet,
        candles,
        spread: price.ask - price.bid,
        slippage: 0,
        commissionPerTrade: 0,
        riskPerTrade: 0.0001,
        sourceEventRefs: [toEventReference(ruleEvent)],
      });
      events.push(backtestEvent);
      validationEvent = new ValidationService().validate(backtestEvent);
      events.push(validationEvent);
    }
  }

  const strategyId = `oanda-practice-validation-${price.providerSymbol}`;
  strategyEvidenceStore.recordSymbolSuitability(strategyId, {
    symbol: selectedSymbol,
    verdict: price.status === "tradeable" && !price.stale ? "acceptable" : "watch",
    source: "oanda-practice-validation",
    summary: `${selectedSymbol} was observed through OANDA practice pricing with ${price.status} status.`,
    metadata: {
      provider: price.provider,
      providerSymbol: price.providerSymbol,
      stale: price.stale,
      spread: Number((price.ask - price.bid).toFixed(6)),
      eventIds: events.map((event) => event.id),
    },
  });

  const previewRefs = validationEvent ? [toEventReference(validationEvent)] : [toEventReference(snapshotEvent)];
  const forwardTestService = new ForwardTestService(undefined, policy);
  const forwardTestEvent = forwardTestService.start({
    experimentId: strategyId,
    provider: "oanda_practice",
    accountMode: "practice",
    mode: "practice",
    allowedInstruments: [price.internalSymbol.replace("/", "_")],
    riskLimitPct: 0.01,
    refs: previewRefs,
  });
  events.push(forwardTestEvent);

  const request = buildMinimalOrderRequest(strategyId, selectedSymbol, price.mid);
  const preview = await adapter.previewOrder(request);
  const demoDecision = new DemoExecutionService(undefined, policy).decide({
    provider: "oanda_practice",
    accountMode: "practice",
    verificationSource: "oanda_practice.getAccountSummary",
    attemptedAction: "oanda.practice.submit",
    confirmationReceived: true,
    killSwitchActive: executionRiskService.snapshot().globalKillSwitch,
    sourceEventRefs: [toEventReference(forwardTestEvent)],
  });
  events.push(demoDecision);

  const beforeTrades = await adapter.getTrades();
  const tradeResult = await maybeSubmitAndClose({
    adapter,
    accountId: env.OANDA_ACCOUNT_ID!,
    token: env.OANDA_API_TOKEN!,
    providerSymbol: price.providerSymbol,
    preview,
    allowed: externalTradeAllowed && demoDecision.type === "DemoExecutionAllowed" && !price.stale && price.status === "tradeable",
    skipReason: externalTradeAllowed ? null : "External OANDA practice submit skipped; durable dry-run validation requested.",
    safetyBlocks,
  });

  const journalService = new TradeJournalService();
  const tradeRefEvent = createEvent({
    type: tradeResult.placed ? "OandaPracticeTradeSubmitted" : "OandaPracticeTradeSkipped",
    module: "demo-execution",
    payload: {
      provider: "oanda_practice",
      orderId: tradeResult.orderId,
      tradeId: tradeResult.tradeId,
      placed: tradeResult.placed,
      reason: tradeResult.reason,
      closeStatus: tradeResult.closeStatus,
      beforeTradeCount: beforeTrades.length,
    },
    sourceEventRefs: [toEventReference(demoDecision), toEventReference(snapshotEvent)],
  });
  events.push(tradeRefEvent);

  const journalEvent = journalService.create({
    experimentId: strategyId,
    tradeId: tradeResult.tradeId ?? tradeResult.orderId ?? "external-trade-skipped",
    instrument: selectedSymbol,
    ruleVersion: ruleSet?.version ?? 0,
    entryReason: tradeResult.placed
      ? "Minimal OANDA practice validation order after demo-only policy and practice account verification."
      : `External OANDA practice trade skipped: ${tradeResult.reason}`,
    stopLoss: request.stopLoss,
    takeProfit: request.takeProfit ?? 0,
    positionSize: request.units,
    outcome: tradeResult.placed ? tradeResult.closeStatus === "closed" ? "flat" : "open" : "flat",
    beforeEntrySnapshotRefs: [toEventReference(snapshotEvent)],
    afterExitSnapshotRefs: [],
    multiTimeframeSnapshotRefs: events.filter((event) => event.type === "CandleSeriesCreated").map(toEventReference),
    screenshotRefs: [{ type: "placeholder", uri: "oanda-practice-validation://no-screenshot", capturedAt: new Date().toISOString(), redacted: true }],
    sourceEventRefs: [toEventReference(tradeRefEvent)],
  });
  events.push(journalEvent);

  eventLogService.append({
    type: "sandbox.order_completed",
    userId: "system",
    sourceService: "oanda-practice-validation",
    correlationId: request.correlationId,
    payload: {
      provider: "oanda_practice",
      placed: tradeResult.placed,
      orderId: redactId(tradeResult.orderId),
      tradeId: redactId(tradeResult.tradeId),
      demoOnly: true,
      productionOrderSubmissionEnabled: false,
    },
  });
  executionAuditLog.append({
    action: tradeResult.placed ? "oanda.practice.validation.submit" : "oanda.practice.validation.skip_submit",
    outcome: tradeResult.placed ? "filled" : "blocked",
    correlationId: request.correlationId,
    detail: {
      provider: "oanda_practice",
      accountMode: account.mode,
      orderId: redactId(tradeResult.orderId),
      tradeId: redactId(tradeResult.tradeId),
      reason: tradeResult.reason,
      productionOrderSubmissionEnabled: false,
    },
  });

  const telemetryEvent = new TelemetryService().snapshot(events);
  events.push(telemetryEvent);

  persistStrategyMachineEvents(events, request.correlationId);
  eventLogService.append({
    type: "paper.order_previewed",
    userId: "system",
    sourceService: "oanda-practice-validation",
    correlationId: request.correlationId,
    payload: {
      provider: "oanda_practice",
      previewId: preview.id,
      riskSummaryHashPresent: Boolean(preview.riskSummaryHash),
      instrument: selectedSymbol,
      units: request.units,
      externalTradeAllowed,
      demoOnly: true,
      productionOrderSubmissionEnabled: false,
    },
  });
  eventLogService.append({
    type: "journal.entry_created",
    userId: "system",
    sourceService: "oanda-practice-validation",
    correlationId: request.correlationId,
    payload: {
      journalId: journalEvent.payload.journalId,
      tradeId: journalEvent.payload.tradeId,
      instrument: selectedSymbol,
      ruleVersion: journalEvent.payload.ruleVersion,
      demoOnly: true,
    },
  });
  eventLogService.append({
    type: "analytics.snapshot_recorded",
    userId: "system",
    sourceService: "oanda-practice-validation",
    correlationId: request.correlationId,
    payload: {
      category: "telemetry",
      telemetryEventId: telemetryEvent.id,
      strategyEventCount: events.length,
      demoExecutionSafetyBlocks: telemetryEvent.payload.demoExecutionSafetyBlocks,
      demoOnly: true,
    },
  });

  await strategyEvidenceStore.flushPersistence();
  await eventLogService.flushPersistence();
  await executionAuditLog.flushPersistence();
  const durableRecords = await verifyDurableRecords({
    databaseUrl: env.DATABASE_URL,
    correlationId: request.correlationId,
    strategyId,
    journalId: String(journalEvent.payload.journalId),
    previewId: preview.id,
    telemetryEventId: telemetryEvent.id,
  });

  printReport({
    oandaPracticeHealth: redactHealth(health),
    accountModeVerification: verification(account, envMode, accountIdConfigured, tokenConfigured, policyResult.allowed),
    instrumentsFound,
    selectedSymbol,
    pricingSnapshot: {
      provider: price.provider,
      internalSymbol: price.internalSymbol,
      providerSymbol: price.providerSymbol,
      bid: price.bid,
      ask: price.ask,
      mid: price.mid,
      status: price.status,
      stale: price.stale,
      asOf: price.asOf,
    },
    practiceTrade: tradeResult,
    records: {
      eventCount: events.length,
      eventTypes: events.map((event) => event.type),
      journalId: journalEvent.payload.journalId,
      evidenceStrategyId: strategyId,
      auditAction: tradeResult.placed ? "oanda.practice.validation.submit" : "oanda.practice.validation.skip_submit",
      telemetryEventId: telemetryEvent.id,
      previewId: preview.id,
      riskSummaryHashPresent: Boolean(preview.riskSummaryHash),
      durableRecords,
    },
    safetyBlocks,
  });
  process.exit(0);
}

function buildMinimalOrderRequest(strategyId: string, symbol: string, mid: number): OrderRequest {
  const stopDistance = symbol.includes("JPY") ? 0.05 : 0.0005;
  return {
    strategyId,
    instrument: symbol,
    side: "buy",
    type: "market",
    units: 1,
    price: mid,
    stopLoss: Number((mid - stopDistance).toFixed(symbol.includes("JPY") ? 3 : 5)),
    takeProfit: Number((mid + stopDistance).toFixed(symbol.includes("JPY") ? 3 : 5)),
    mode: "paper",
    explicitUserConfirmation: false,
    correlationId: randomUUID(),
  };
}

async function loadCandles(accountId: string, token: string, providerSymbol: string): Promise<Candle[]> {
  const response = await oandaFetch(token, `/instruments/${encodeURIComponent(providerSymbol)}/candles?price=M&granularity=M1&count=40`);
  if (!response.ok) return [];
  const payload = await response.json() as { candles?: Array<Record<string, unknown>> };
  return (payload.candles ?? [])
    .filter((candle) => candle.complete !== false)
    .map((candle) => {
      const mid = candle.mid as Record<string, unknown>;
      return {
        instrument: providerSymbol,
        timeframe: "1m" as const,
        timestamp: String(candle.time),
        open: Number(mid.o),
        high: Number(mid.h),
        low: Number(mid.l),
        close: Number(mid.c),
        volume: Number(candle.volume ?? 0),
      };
    })
    .filter((candle) => Number.isFinite(candle.open + candle.high + candle.low + candle.close));
}

async function maybeSubmitAndClose(input: {
  adapter: ReturnType<typeof createOandaPracticeAdapterFromEnv>;
  accountId: string;
  token: string;
  providerSymbol: string;
  preview: Awaited<ReturnType<ReturnType<typeof createOandaPracticeAdapterFromEnv>["previewOrder"]>>;
  allowed: boolean;
  skipReason: string | null;
  safetyBlocks: string[];
}): Promise<ValidationReport["practiceTrade"]> {
  if (input.skipReason) {
    return { placed: false, reason: input.skipReason, orderId: null, tradeId: null, closeStatus: null };
  }
  if (!input.allowed) {
    return { placed: false, reason: "Demo-only decision, pricing, or tradeability gate did not allow submission.", orderId: null, tradeId: null, closeStatus: null };
  }
  if (input.preview.request.units !== 1) {
    return { placed: false, reason: "Minimal unit gate failed; expected exactly 1 unit.", orderId: null, tradeId: null, closeStatus: null };
  }
  if (input.safetyBlocks.length > 0) {
    return { placed: false, reason: input.safetyBlocks.join(" "), orderId: null, tradeId: null, closeStatus: null };
  }
  const before = await input.adapter.getTrades();
  const order = await input.adapter.submitSandboxOrder(input.preview);
  if (order.status === "rejected") {
    return { placed: false, reason: order.reason ?? "OANDA practice rejected the order.", orderId: redactId(order.orderId), tradeId: null, closeStatus: null };
  }
  const after = await input.adapter.getTrades();
  const beforeIds = new Set(before.map((trade) => trade.id));
  const opened = after.find((trade) => !beforeIds.has(trade.id) && trade.providerSymbol === input.providerSymbol && trade.units <= 1);
  if (!opened) {
    return { placed: true, reason: "Practice order submitted, but no new open trade was found for immediate close.", orderId: redactId(order.orderId), tradeId: null, closeStatus: "not_found" };
  }
  const close = await closeTrade(input.accountId, input.token, opened.id);
  return {
    placed: true,
    reason: "One-unit OANDA practice validation trade submitted and close requested.",
    orderId: redactId(order.orderId),
    tradeId: redactId(opened.id),
    closeStatus: close.ok ? "closed" : `close_failed_${close.status}`,
  };
}

async function closeTrade(accountId: string, token: string, tradeId: string) {
  return oandaFetch(token, `/accounts/${encodeURIComponent(accountId)}/trades/${encodeURIComponent(tradeId)}/close`, {
    method: "PUT",
    body: JSON.stringify({ units: "ALL" }),
  });
}

async function oandaFetch(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "MarketPilot-OandaPracticeValidation/1.0",
      ...(init.headers ?? {}),
    },
  });
}

function verification(account: { mode: string; accountId: string }, envMode: string, accountIdConfigured: boolean, tokenConfigured: boolean, policyAllowed: boolean) {
  return {
    envMode,
    accountIdConfigured,
    tokenConfigured,
    accountMode: account.mode,
    accountIdRedacted: redactId(account.accountId),
    verifiedPractice: envMode === "practice" && account.mode === "practice" && policyAllowed,
  };
}

function redactHealth(health: Record<string, unknown>) {
  return {
    provider: health.provider,
    connected: health.connected,
    environment: health.environment,
    status: health.status,
    reason: health.reason,
    productionOrderSubmissionEnabled: health.productionOrderSubmissionEnabled,
  };
}

function redactId(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 6) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function persistStrategyMachineEvents(events: EventEnvelope[], correlationId: string) {
  for (const event of events) {
    eventLogService.append({
      type: event.type === "MarketSnapshotCreated"
        ? "price.tick_received"
        : event.type === "CandleSeriesCreated"
          ? "market.candle_closed"
          : "analytics.snapshot_recorded",
      userId: "system",
      sourceService: "strategy-machine",
      correlationId,
      payload: {
        strategyMachineEventId: event.id,
        strategyMachineEventType: event.type,
        module: event.module,
        occurredAt: event.occurredAt,
        payload: event.payload,
        sourceEventRefs: event.sourceEventRefs,
        demoOnly: true,
      },
    });
  }
}

async function verifyDurableRecords(input: {
  databaseUrl: string | undefined;
  correlationId: string;
  strategyId: string;
  journalId: string;
  previewId: string;
  telemetryEventId: string;
}) {
  if (!input.databaseUrl) {
    return { configured: false };
  }
  const client = new Client({ connectionString: input.databaseUrl });
  await client.connect();
  try {
    const [
      marketSnapshot,
      strategyEvents,
      preview,
      journal,
      evidence,
      telemetry,
      auditLog,
      eventLog,
    ] = await Promise.all([
      client.query(
        `SELECT count(*)::int AS count FROM marketpilot_events
         WHERE correlation_id = $1 AND type = 'price.tick_received'`,
        [input.correlationId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM marketpilot_events
         WHERE correlation_id = $1 AND source_service = 'strategy-machine'`,
        [input.correlationId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM marketpilot_events
         WHERE correlation_id = $1 AND type = 'paper.order_previewed' AND payload->>'previewId' = $2`,
        [input.correlationId, input.previewId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM marketpilot_events
         WHERE correlation_id = $1 AND type = 'journal.entry_created' AND payload->>'journalId' = $2`,
        [input.correlationId, input.journalId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM strategy_evidence_records
         WHERE strategy_id = $1 AND kind = 'symbol_suitability'`,
        [input.strategyId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM marketpilot_events
         WHERE correlation_id = $1 AND payload->>'telemetryEventId' = $2`,
        [input.correlationId, input.telemetryEventId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM execution_audit_entries
         WHERE correlation_id = $1`,
        [input.correlationId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM marketpilot_events
         WHERE correlation_id = $1`,
        [input.correlationId],
      ),
    ]);
    const counts = {
      marketSnapshot: Number(marketSnapshot.rows[0]?.count ?? 0),
      strategyMachineEvents: Number(strategyEvents.rows[0]?.count ?? 0),
      orderPreview: Number(preview.rows[0]?.count ?? 0),
      journalEntry: Number(journal.rows[0]?.count ?? 0),
      strategyEvidence: Number(evidence.rows[0]?.count ?? 0),
      telemetryEvent: Number(telemetry.rows[0]?.count ?? 0),
      auditLog: Number(auditLog.rows[0]?.count ?? 0),
      eventLog: Number(eventLog.rows[0]?.count ?? 0),
    };
    return {
      configured: true,
      verified: Object.values(counts).every((count) => count > 0),
      counts,
    };
  } finally {
    await client.end();
  }
}

function printReport(report: ValidationReport) {
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  console.error(JSON.stringify({
    status: "failed",
    name: error instanceof Error ? error.name : typeof error,
    code: typeof record.code === "string" ? record.code : null,
    statusCode: typeof record.status === "number" ? record.status : null,
    message: error instanceof Error && error.message ? error.message : "OANDA practice validation failed",
    stackTop: error instanceof Error ? error.stack?.split("\n").slice(0, 3).join("\n") : null,
  }, null, 2));
  process.exit(1);
});
