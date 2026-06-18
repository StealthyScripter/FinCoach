export type PriceBar = {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type EconomicObservation = {
  seriesId: string;
  timestamp: string;
  value: number;
  source: string;
};

export type OptionsSnapshot = {
  underlying: string;
  timestamp: string;
  impliedVolatilityPct: number;
  openInterest: number;
};

export type ProviderIngestionRun = {
  id: string;
  providerId: string;
  status: "success" | "partial" | "failed" | "dry_run";
  startedAt: string;
  completedAt: string;
  records: number;
  freshness: { newestTimestamp: string | null; oldestTimestamp: string | null };
  errors: string[];
};

export interface TimeSeriesStore {
  writePriceBars(bars: PriceBar[]): Promise<number>;
  queryPriceBars(symbol: string, from: string, to: string): Promise<PriceBar[]>;
  writeEconomicObservations(items: EconomicObservation[]): Promise<number>;
  writeOptionsSnapshots(items: OptionsSnapshot[]): Promise<number>;
  recordIngestionRun(run: ProviderIngestionRun): Promise<ProviderIngestionRun>;
  health(): { provider: "memory" | "timescale"; status: "healthy" | "disabled"; priceBars: number; ingestionRuns: number };
}

export class InMemoryTimeSeriesStore implements TimeSeriesStore {
  private priceBars: PriceBar[] = [];
  private economic: EconomicObservation[] = [];
  private options: OptionsSnapshot[] = [];
  private runs: ProviderIngestionRun[] = [];

  async writePriceBars(bars: PriceBar[]) {
    this.priceBars.push(...bars);
    return bars.length;
  }

  async queryPriceBars(symbol: string, from: string, to: string) {
    return this.priceBars.filter((bar) => bar.symbol === symbol && bar.timestamp >= from && bar.timestamp <= to);
  }

  async writeEconomicObservations(items: EconomicObservation[]) {
    this.economic.push(...items);
    return items.length;
  }

  async writeOptionsSnapshots(items: OptionsSnapshot[]) {
    this.options.push(...items);
    return items.length;
  }

  async recordIngestionRun(run: ProviderIngestionRun) {
    this.runs.unshift(run);
    return run;
  }

  health(): ReturnType<TimeSeriesStore["health"]> {
    return { provider: "memory" as const, status: "healthy" as const, priceBars: this.priceBars.length, ingestionRuns: this.runs.length };
  }
}

export class TimescaleReadyStore extends InMemoryTimeSeriesStore {
  override health(): ReturnType<TimeSeriesStore["health"]> {
    const base = super.health();
    return {
      provider: "timescale" as const,
      status: process.env.DATABASE_URL && process.env.MARKETPILOT_TIMESCALE === "enabled" ? "healthy" as const : "disabled" as const,
      priceBars: base.priceBars,
      ingestionRuns: base.ingestionRuns,
    };
  }
}

export const timeSeriesStore: TimeSeriesStore = process.env.MARKETPILOT_TIMESCALE === "enabled" ? new TimescaleReadyStore() : new InMemoryTimeSeriesStore();
