import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";
import { marketDataMetrics, type MarketDataMetrics } from "./marketDataMetrics";
import type { PriceTick } from "./priceFeedService";

export type CandleTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type Candle = {
  id: string;
  symbol: string;
  timeframe: CandleTimeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
  startTime: string;
  endTime: string;
  provider: string;
  closed: boolean;
};

const TIMEFRAME_MS: Record<CandleTimeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export class CandleBuilderService {
  private active = new Map<string, Candle>();
  private closed = new Map<string, Candle[]>();
  private listeners = new Set<(candle: Candle) => void>();

  constructor(
    private readonly events: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
    private readonly metrics: MarketDataMetrics = marketDataMetrics,
  ) {}

  ingest(tick: PriceTick, timeframe: CandleTimeframe, volume = 1) {
    const duration = TIMEFRAME_MS[timeframe];
    const timestamp = Date.parse(tick.timestamp);
    const bucketStart = Math.floor(timestamp / duration) * duration;
    const key = `${tick.symbol}:${timeframe}`;
    let candle = this.active.get(key);
    const completed: Candle[] = [];
    if (candle && Date.parse(candle.startTime) !== bucketStart) {
      candle.closed = true;
      candle.endTime = new Date(Date.parse(candle.startTime) + duration).toISOString();
      this.saveClosed(key, candle);
      completed.push({ ...candle });
      this.emitClosed(candle);
      candle = undefined;
    }
    if (!candle) {
      candle = {
        id: randomUUID(),
        symbol: tick.symbol,
        timeframe,
        open: tick.mid,
        high: tick.mid,
        low: tick.mid,
        close: tick.mid,
        volume,
        tickCount: 1,
        startTime: new Date(bucketStart).toISOString(),
        endTime: new Date(bucketStart + duration).toISOString(),
        provider: tick.provider,
        closed: false,
      };
      this.active.set(key, candle);
    } else {
      candle.high = Math.max(candle.high, tick.mid);
      candle.low = Math.min(candle.low, tick.mid);
      candle.close = tick.mid;
      candle.volume += volume;
      candle.tickCount += 1;
    }
    return { active: { ...candle }, completed };
  }

  ingestAll(tick: PriceTick, volume = 1) {
    return (Object.keys(TIMEFRAME_MS) as CandleTimeframe[]).flatMap((timeframe) => this.ingest(tick, timeframe, volume).completed);
  }

  list(symbol: string, timeframe: CandleTimeframe, limit = 100) {
    return [...(this.closed.get(`${symbol}:${timeframe}`) ?? [])].slice(-limit).map((candle) => ({ ...candle }));
  }

  getActive(symbol: string, timeframe: CandleTimeframe) {
    const candle = this.active.get(`${symbol}:${timeframe}`);
    return candle ? { ...candle } : undefined;
  }

  onCandle(listener: (candle: Candle) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private saveClosed(key: string, candle: Candle) {
    const values = this.closed.get(key) ?? [];
    values.push({ ...candle });
    this.closed.set(key, values.slice(-1_000));
  }

  private emitClosed(candle: Candle) {
    this.metrics.recordCandle();
    this.events.append({
      type: "market.candle_closed",
      userId: "system",
      sourceService: "candle-builder",
      correlationId: candle.id,
      payload: { symbol: candle.symbol, timeframe: candle.timeframe, close: candle.close, tickCount: candle.tickCount },
      createdAt: candle.endTime,
    });
    this.audit.append({
      action: "market.candle.closed",
      outcome: "created",
      correlationId: candle.id,
      detail: { symbol: candle.symbol, timeframe: candle.timeframe, close: candle.close },
    });
    this.listeners.forEach((listener) => listener({ ...candle }));
  }
}

export const candleBuilderService = new CandleBuilderService();
