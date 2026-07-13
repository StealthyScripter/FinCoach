import type { MarketDataImportResult, MarketDataRepositoryContract, NormalizedCandle, V2Timeframe } from "./contracts";

export class InMemoryMarketDataRepository implements MarketDataRepositoryContract {
  private readonly candles = new Map<string, NormalizedCandle>();
  private readonly imports = new Map<string, MarketDataImportResult>();
  private readonly checkpoints = new Map<string, string | null>();

  async importCandles(_importId: string, candles: NormalizedCandle[]) {
    let inserted = 0;
    let duplicates = 0;
    for (const candle of candles) {
      const id = candleKey(candle);
      if (this.candles.has(id)) {
        duplicates += 1;
        continue;
      }
      this.candles.set(id, { ...candle });
      inserted += 1;
    }
    return { inserted, duplicates };
  }

  async hasImport(idempotencyKey: string) {
    return this.imports.has(idempotencyKey);
  }

  async recordImport(idempotencyKey: string, result: MarketDataImportResult) {
    this.imports.set(idempotencyKey, {
      ...result,
      lineage: [...result.lineage],
      events: [...result.events],
    });
  }

  async saveCheckpoint(key: string, cursor: string | null) {
    this.checkpoints.set(key, cursor);
  }

  async readCheckpoint(key: string) {
    return this.checkpoints.get(key) ?? null;
  }

  async latestCandle(symbol: string, timeframe: V2Timeframe) {
    const values = Array.from(this.candles.values())
      .filter((candle) => candle.symbol === symbol && candle.timeframe === timeframe)
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    return values[0] ? { ...values[0] } : null;
  }

  listCandles() {
    return Array.from(this.candles.values()).map((candle) => ({ ...candle }));
  }
}

function candleKey(candle: NormalizedCandle) {
  return `${candle.symbol}:${candle.timeframe}:${candle.timestamp}`;
}
