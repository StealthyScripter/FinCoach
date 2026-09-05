import { randomUUID } from "crypto";
import { Pool } from "pg";
import { historicalDataImportService, type HistoricalCandle, type HistoricalDataImportService } from "../historicalDataImportService";
import type { Candle } from "../strategy-machine/market-data";
import { normalizeInstrument } from "../strategy-machine/market-data";
import type { ClosedPaperTrade, PaperRuntimePosition } from "./paperStrategyRuntime";
import { eventLogService, type EventLogService } from "../eventLogService";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";

export type TradeForensicsResult = "profit" | "non_profit";
export type TradeForensicsPhase = "before" | "during" | "after";
export type TradeForensicsTruncationReason = "market_close" | "friday_close" | "weekend" | "data_unavailable";

export type TradeForensicsPoint = {
  timestamp: string;
  relativeMs: number;
  marketPrice: number;
  normalizedPrice: number;
  normalizedPercent: number;
  phase: TradeForensicsPhase;
};

export type TradeForensicsReferenceLine = {
  kind: "take_profit" | "stop_loss" | "trailing_stop" | "close";
  price: number;
  normalizedPrice: number;
  label: string;
};

export type TradeForensics = {
  id: string;
  tradeId: string;
  brokerTradeId: string | null;
  symbol: string;
  side: "long" | "short";
  positionSize: number | null;
  enteredAt: string;
  closedAt: string;
  durationMs: number;
  xDomain: { min: number; entry: 0; exit: number; max: number };
  entryMarker: { timestamp: string; relativeMs: 0; normalizedPrice: 0; normalizedPercent: 0; marketPrice: number };
  exitMarker: { timestamp: string; relativeMs: number; normalizedPrice: number; normalizedPercent: number; marketPrice: number };
  chartSections: Array<{ phase: TradeForensicsPhase; startRelativeMs: number; endRelativeMs: number; widthFraction: number }>;
  requestedWindow: { beforeStart: string; entry: string; exit: string; afterEnd: string };
  actualWindow: { beforeStart: string; afterEnd: string; afterTruncated: boolean; truncationReason?: TradeForensicsTruncationReason };
  entryPrice: number;
  closingPrice: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  trailingStopPrice?: number;
  grossPnl?: number;
  fees?: number;
  spreadCost?: number;
  financing?: number;
  netPnl: number;
  netPnlPercent?: number;
  closeReason?: string;
  result: TradeForensicsResult;
  mainLineColor: "green" | "red";
  referenceLines: TradeForensicsReferenceLine[];
  points: TradeForensicsPoint[];
  generatedAt: string;
  source: string;
  authoritativePnlSource: "broker_reconciliation" | "paper_runtime";
  unavailableReason?: string;
};

export type ClosedTradeForensicsInput = {
  tradeId: string;
  brokerTradeId?: string | null;
  symbol: string;
  side: "long" | "short";
  positionSize?: number | null;
  enteredAt: string;
  closedAt: string;
  entryPrice: number;
  closingPrice: number;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  trailingStopPrice?: number | null;
  grossPnl?: number | null;
  fees?: number | null;
  spreadCost?: number | null;
  financing?: number | null;
  netPnl: number;
  netPnlPercent?: number | null;
  closeReason?: string | null;
  source: string;
  authoritativePnlSource: TradeForensics["authoritativePnlSource"];
};

export interface TradeForensicsRepository {
  getByTradeId(tradeId: string): Promise<TradeForensics | null>;
  save(record: TradeForensics): Promise<TradeForensics>;
  list(): Promise<TradeForensics[]>;
  clearForTest?(): void;
}

export class InMemoryTradeForensicsRepository implements TradeForensicsRepository {
  private readonly records = new Map<string, TradeForensics>();

  async getByTradeId(tradeId: string) {
    const record = this.records.get(tradeId);
    return record ? clone(record) : null;
  }

  async save(record: TradeForensics) {
    this.records.set(record.tradeId, clone(record));
    return clone(record);
  }

  async list() {
    return Array.from(this.records.values()).map(clone).sort((left, right) => right.closedAt.localeCompare(left.closedAt));
  }

  clearForTest() {
    this.records.clear();
  }
}

export class PgTradeForensicsRepository implements TradeForensicsRepository {
  private readonly pool: Pool;
  private readonly ownsPool: boolean;

  constructor(databaseUrl = process.env.DATABASE_URL, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString: databaseUrl });
    this.ownsPool = !pool;
  }

  async getByTradeId(tradeId: string) {
    const result = await this.pool.query("SELECT payload FROM trade_forensics WHERE trade_id = $1", [tradeId]);
    return result.rows[0]?.payload ? clone(result.rows[0].payload as TradeForensics) : null;
  }

  async save(record: TradeForensics) {
    await this.pool.query(
      `INSERT INTO trade_forensics (id, trade_id, broker_trade_id, symbol, entered_at, closed_at, generated_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (trade_id) DO UPDATE
         SET broker_trade_id = EXCLUDED.broker_trade_id,
             symbol = EXCLUDED.symbol,
             entered_at = EXCLUDED.entered_at,
             closed_at = EXCLUDED.closed_at,
             generated_at = EXCLUDED.generated_at,
             payload = EXCLUDED.payload`,
      [record.id, record.tradeId, record.brokerTradeId, record.symbol, record.enteredAt, record.closedAt, record.generatedAt, JSON.stringify(record)],
    );
    return clone(record);
  }

  async list() {
    const result = await this.pool.query("SELECT payload FROM trade_forensics ORDER BY closed_at DESC");
    return result.rows.map((row) => clone(row.payload as TradeForensics));
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}

export class TradeForensicsUnavailableError extends Error {
  readonly code: "open_trade" | "invalid_duration" | "missing_historical_data";
  readonly status: 409 | 422;

  constructor(code: TradeForensicsUnavailableError["code"], message: string) {
    super(message);
    this.code = code;
    this.status = code === "open_trade" ? 409 : 422;
  }
}

export class TradeForensicsService {
  constructor(
    private readonly repository: TradeForensicsRepository = createTradeForensicsRepository(),
    private readonly historicalData: HistoricalDataImportService = historicalDataImportService,
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
  ) {}

  async get(tradeId: string) {
    return this.repository.getByTradeId(tradeId);
  }

  async list() {
    return this.repository.list();
  }

  async generateForClosedPaperTrade(trade: ClosedPaperTrade, now = new Date()) {
    return this.generate({
      tradeId: trade.id,
      brokerTradeId: null,
      symbol: trade.symbol,
      side: trade.side === "buy" ? "long" : "short",
      positionSize: trade.units,
      enteredAt: trade.openedAt,
      closedAt: trade.closedAt,
      entryPrice: trade.entryPrice,
      closingPrice: trade.exitPrice,
      takeProfitPrice: trade.takeProfit,
      stopLossPrice: trade.stopLoss,
      trailingStopPrice: trade.trailingStopDistance === null ? null : trade.stopLoss,
      grossPnl: trade.realizedPnL,
      netPnl: trade.realizedPnL,
      netPnlPercent: percentResult(trade.realizedPnL, trade.entryPrice, trade.units),
      closeReason: mapPaperCloseReason(trade.exitReason),
      source: "paper-strategy-runtime",
      authoritativePnlSource: "paper_runtime",
    }, now);
  }

  async generateForAuthoritativeBrokerClose(input: ClosedTradeForensicsInput, now = new Date()) {
    if (input.authoritativePnlSource !== "broker_reconciliation") {
      throw new Error("Broker-close forensics require authoritative broker reconciliation P/L.");
    }
    return this.generate(input, now);
  }

  async generate(input: ClosedTradeForensicsInput, now = new Date()) {
    const existing = await this.repository.getByTradeId(input.tradeId);
    if (existing) return existing;
    const enteredAt = parseDate(input.enteredAt, "enteredAt");
    const closedAt = parseDate(input.closedAt, "closedAt");
    const durationMs = closedAt.getTime() - enteredAt.getTime();
    if (durationMs <= 0) {
      throw new TradeForensicsUnavailableError("invalid_duration", "Closed trade timing is invalid; closedAt must be after enteredAt.");
    }

    const beforeStart = new Date(enteredAt.getTime() - durationMs);
    const afterEnd = new Date(closedAt.getTime() + durationMs);
    const timeframe = selectTimeframe(durationMs);
    const candles = this.historicalData.getCandles(input.symbol, timeframe)
      .filter((candle) => Date.parse(candle.timestamp) >= beforeStart.getTime() && Date.parse(candle.timestamp) <= afterEnd.getTime());
    if (candles.length === 0) {
      throw new TradeForensicsUnavailableError("missing_historical_data", `No historical ${timeframe} candles are available for ${normalizeInstrument(input.symbol)} in the forensic window.`);
    }

    const sorted = candles.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const actualAfterEnd = sorted[sorted.length - 1].timestamp;
    const afterTruncated = Date.parse(actualAfterEnd) < afterEnd.getTime();
    const record: TradeForensics = {
      id: randomUUID(),
      tradeId: input.tradeId,
      brokerTradeId: input.brokerTradeId ?? null,
      symbol: normalizeInstrument(input.symbol),
      side: input.side,
      positionSize: input.positionSize ?? null,
      enteredAt: enteredAt.toISOString(),
      closedAt: closedAt.toISOString(),
      durationMs,
      xDomain: { min: -durationMs, entry: 0, exit: durationMs, max: durationMs * 2 },
      entryMarker: { timestamp: enteredAt.toISOString(), relativeMs: 0, marketPrice: input.entryPrice, normalizedPrice: 0, normalizedPercent: 0 },
      exitMarker: {
        timestamp: closedAt.toISOString(),
        relativeMs: durationMs,
        marketPrice: input.closingPrice,
        normalizedPrice: round(input.closingPrice - input.entryPrice),
        normalizedPercent: round(((input.closingPrice - input.entryPrice) / input.entryPrice) * 100),
      },
      chartSections: [
        { phase: "before", startRelativeMs: -durationMs, endRelativeMs: 0, widthFraction: 1 / 3 },
        { phase: "during", startRelativeMs: 0, endRelativeMs: durationMs, widthFraction: 1 / 3 },
        { phase: "after", startRelativeMs: durationMs, endRelativeMs: durationMs * 2, widthFraction: 1 / 3 },
      ],
      requestedWindow: {
        beforeStart: beforeStart.toISOString(),
        entry: enteredAt.toISOString(),
        exit: closedAt.toISOString(),
        afterEnd: afterEnd.toISOString(),
      },
      actualWindow: {
        beforeStart: sorted[0].timestamp,
        afterEnd: actualAfterEnd,
        afterTruncated,
        ...(afterTruncated ? { truncationReason: classifyTruncation(closedAt, afterEnd, sorted[sorted.length - 1], timeframe) } : {}),
      },
      entryPrice: input.entryPrice,
      closingPrice: input.closingPrice,
      ...(present(input.takeProfitPrice) ? { takeProfitPrice: input.takeProfitPrice } : {}),
      ...(present(input.stopLossPrice) ? { stopLossPrice: input.stopLossPrice } : {}),
      ...(present(input.trailingStopPrice) ? { trailingStopPrice: input.trailingStopPrice } : {}),
      ...(present(input.grossPnl) ? { grossPnl: input.grossPnl } : {}),
      ...(present(input.fees) ? { fees: input.fees } : {}),
      ...(present(input.spreadCost) ? { spreadCost: input.spreadCost } : {}),
      ...(present(input.financing) ? { financing: input.financing } : {}),
      netPnl: input.netPnl,
      ...(present(input.netPnlPercent) ? { netPnlPercent: input.netPnlPercent } : {}),
      ...(input.closeReason ? { closeReason: input.closeReason } : {}),
      result: input.netPnl > 0 ? "profit" : "non_profit",
      mainLineColor: input.netPnl > 0 ? "green" : "red",
      referenceLines: referenceLines(input),
      points: buildPoints(sorted, input.entryPrice, enteredAt, closedAt, durationMs),
      generatedAt: now.toISOString(),
      source: input.source,
      authoritativePnlSource: input.authoritativePnlSource,
    };
    const saved = await this.repository.save(record);
    this.events.append({
      type: "trade.forensics_generated",
      userId: "system",
      sourceService: "trade-forensics",
      correlationId: saved.id,
      payload: { tradeId: saved.tradeId, symbol: saved.symbol, source: saved.source, afterTruncated: saved.actualWindow.afterTruncated },
      createdAt: saved.generatedAt,
    });
    this.audit.append({
      action: "trade.forensics.generate",
      outcome: "created",
      correlationId: saved.id,
      detail: { tradeId: saved.tradeId, symbol: saved.symbol, authoritativePnlSource: saved.authoritativePnlSource },
    });
    return saved;
  }
}

export function openTradeForensicsUnavailable(position: PaperRuntimePosition): never {
  throw new TradeForensicsUnavailableError("open_trade", `Trade ${position.id} is still open; Trade Forensics is available only after close.`);
}

export function relativeToWidthFraction(relativeMs: number, durationMs: number) {
  if (durationMs <= 0) throw new Error("durationMs must be positive");
  return (relativeMs + durationMs) / (durationMs * 3);
}

export function selectTimeframe(durationMs: number): Candle["timeframe"] {
  const minutes = durationMs / 60_000;
  if (minutes <= 180) return "1m";
  if (minutes <= 18 * 60) return "5m";
  if (minutes <= 72 * 60) return "15m";
  if (minutes <= 14 * 24 * 60) return "1h";
  return "4h";
}

function buildPoints(candles: HistoricalCandle[], entryPrice: number, enteredAt: Date, closedAt: Date, durationMs: number): TradeForensicsPoint[] {
  return candles.map((candle) => {
    const timestampMs = Date.parse(candle.timestamp);
    const relativeMs = timestampMs - enteredAt.getTime();
    const marketPrice = candle.close;
    const phase: TradeForensicsPhase = timestampMs < enteredAt.getTime() ? "before" : timestampMs <= closedAt.getTime() ? "during" : "after";
    return {
      timestamp: candle.timestamp,
      relativeMs,
      marketPrice,
      normalizedPrice: round(marketPrice - entryPrice),
      normalizedPercent: round(((marketPrice - entryPrice) / entryPrice) * 100),
      phase,
    };
  }).filter((point) => point.relativeMs >= -durationMs && point.relativeMs <= durationMs * 2);
}

function referenceLines(input: ClosedTradeForensicsInput): TradeForensicsReferenceLine[] {
  return [
    present(input.takeProfitPrice) ? line("take_profit", input.takeProfitPrice, input.entryPrice, "Take Profit") : null,
    present(input.stopLossPrice) ? line("stop_loss", input.stopLossPrice, input.entryPrice, "Stop Loss") : null,
    present(input.trailingStopPrice) ? line("trailing_stop", input.trailingStopPrice, input.entryPrice, "Trailing Stop") : null,
    line("close", input.closingPrice, input.entryPrice, "Closing Price"),
  ].filter((item): item is TradeForensicsReferenceLine => Boolean(item));
}

function line(kind: TradeForensicsReferenceLine["kind"], price: number, entryPrice: number, label: string) {
  return { kind, price, normalizedPrice: round(price - entryPrice), label };
}

function classifyTruncation(closedAt: Date, requestedAfterEnd: Date, lastCandle: HistoricalCandle, timeframe: Candle["timeframe"]): TradeForensicsTruncationReason {
  const last = new Date(lastCandle.timestamp);
  if (crossesWeekend(closedAt, requestedAfterEnd)) return "weekend";
  if (last.getUTCDay() === 5 && last.getUTCHours() >= 21) return "friday_close";
  const expectedGap = timeframeMs(timeframe) * 1.5;
  if (requestedAfterEnd.getTime() - last.getTime() <= expectedGap) return "market_close";
  return "data_unavailable";
}

function crossesWeekend(start: Date, end: Date) {
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 60 * 60_000) {
    const day = new Date(cursor).getUTCDay();
    if (day === 0 || day === 6) return true;
  }
  return false;
}

function timeframeMs(timeframe: Candle["timeframe"]) {
  const minutes = timeframe === "1m" ? 1 : timeframe === "5m" ? 5 : timeframe === "15m" ? 15 : timeframe === "30m" ? 30 : timeframe === "1h" ? 60 : timeframe === "4h" ? 240 : timeframe === "1d" ? 1440 : timeframe === "1w" ? 10080 : 43200;
  return minutes * 60_000;
}

function parseDate(value: string, field: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be a valid ISO timestamp`);
  return date;
}

function present(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function percentResult(pnlValue: number, entryPrice: number, units: number) {
  const notional = Math.abs(entryPrice * units);
  return notional > 0 ? round((pnlValue / notional) * 100) : undefined;
}

function mapPaperCloseReason(reason: ClosedPaperTrade["exitReason"]) {
  return reason === "take_profit" ? "TAKE_PROFIT" : reason === "stop_loss" ? "STOP_LOSS" : reason === "trailing_stop" ? "TRAILING_STOP" : "MANUAL_CLOSE";
}

function round(value: number) {
  return Number(value.toFixed(6));
}

function clone(record: TradeForensics): TradeForensics {
  return structuredClone(record);
}

function createTradeForensicsRepository() {
  return process.env.DATABASE_URL ? new PgTradeForensicsRepository() : new InMemoryTradeForensicsRepository();
}

export const tradeForensicsService = new TradeForensicsService();
