import type { Candle, MarketSnapshot } from "./contracts";

export class MarketDataRepository {
  private readonly snapshots: MarketSnapshot[] = [];
  private readonly candles: Candle[] = [];

  saveSnapshot(snapshot: MarketSnapshot) {
    this.snapshots.push({ ...snapshot });
    return snapshot;
  }

  saveCandles(candles: Candle[]) {
    this.candles.push(...candles.map((candle) => ({ ...candle })));
    return candles;
  }

  latestSnapshot(instrument: string) {
    return [...this.snapshots].reverse().find((snapshot) => snapshot.instrument === instrument) ?? null;
  }

  candleSeries(instrument: string, timeframe: Candle["timeframe"]) {
    return this.candles.filter((candle) => candle.instrument === instrument && candle.timeframe === timeframe);
  }
}
