import { Pool } from "pg";

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
  listPriceBars(limit?: number): Promise<PriceBar[]>;
  listEconomicObservations(limit?: number): Promise<EconomicObservation[]>;
  listOptionsSnapshots(limit?: number): Promise<OptionsSnapshot[]>;
  listIngestionRuns(limit?: number): Promise<ProviderIngestionRun[]>;
  health(): { provider: "memory" | "timescale"; status: "healthy" | "disabled"; priceBars: number; ingestionRuns: number };
}

export class InMemoryTimeSeriesStore implements TimeSeriesStore {
  protected priceBars: PriceBar[] = [];
  protected economic: EconomicObservation[] = [];
  protected options: OptionsSnapshot[] = [];
  protected runs: ProviderIngestionRun[] = [];

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

  async listPriceBars(limit = 100) {
    return [...this.priceBars].slice(0, limit);
  }

  async listEconomicObservations(limit = 100) {
    return [...this.economic].slice(0, limit);
  }

  async listOptionsSnapshots(limit = 100) {
    return [...this.options].slice(0, limit);
  }

  async listIngestionRuns(limit = 100) {
    return [...this.runs].slice(0, limit);
  }

  health(): ReturnType<TimeSeriesStore["health"]> {
    return { provider: "memory" as const, status: "healthy" as const, priceBars: this.priceBars.length, ingestionRuns: this.runs.length };
  }
}

export class PgTimeSeriesStore implements TimeSeriesStore {
  private readonly fallback = new InMemoryTimeSeriesStore();
  private readonly configured: boolean;
  private readonly pool: Pool | null;

  constructor(private readonly databaseUrl = process.env.DATABASE_URL) {
    this.configured = Boolean(databaseUrl);
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  }

  async writePriceBars(bars: PriceBar[]) {
    if (!this.pool) return this.fallback.writePriceBars(bars);
    await this.fallback.writePriceBars(bars);
    for (const bar of bars) {
      await this.pool.query(
        `INSERT INTO time_series_price_bars (symbol, timestamp, open, high, low, close, volume)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [bar.symbol, bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume],
      );
    }
    return bars.length;
  }

  async queryPriceBars(symbol: string, from: string, to: string) {
    if (!this.pool) return this.fallback.queryPriceBars(symbol, from, to);
    const response = await this.pool.query(
      `SELECT symbol, timestamp, open, high, low, close, volume
       FROM time_series_price_bars
       WHERE symbol = $1 AND timestamp >= $2::timestamp AND timestamp <= $3::timestamp
       ORDER BY timestamp DESC`,
      [symbol, from, to],
    );
    return response.rows.map((row) => ({
      symbol: String(row.symbol),
      timestamp: new Date(row.timestamp).toISOString(),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }));
  }

  async writeEconomicObservations(items: EconomicObservation[]) {
    if (!this.pool) return this.fallback.writeEconomicObservations(items);
    await this.fallback.writeEconomicObservations(items);
    for (const item of items) {
      await this.pool.query(
        `INSERT INTO time_series_economic_observations (series_id, timestamp, value, source)
         VALUES ($1, $2, $3, $4)`,
        [item.seriesId, item.timestamp, item.value, item.source],
      );
    }
    return items.length;
  }

  async writeOptionsSnapshots(items: OptionsSnapshot[]) {
    if (!this.pool) return this.fallback.writeOptionsSnapshots(items);
    await this.fallback.writeOptionsSnapshots(items);
    for (const item of items) {
      await this.pool.query(
        `INSERT INTO time_series_options_snapshots (underlying, timestamp, implied_volatility_pct, open_interest)
         VALUES ($1, $2, $3, $4)`,
        [item.underlying, item.timestamp, item.impliedVolatilityPct, item.openInterest],
      );
    }
    return items.length;
  }

  async recordIngestionRun(run: ProviderIngestionRun) {
    if (!this.pool) return this.fallback.recordIngestionRun(run);
    await this.fallback.recordIngestionRun(run);
    await this.pool.query(
      `INSERT INTO time_series_ingestion_runs
       (id, provider_id, status, started_at, completed_at, records, freshness_newest_timestamp, freshness_oldest_timestamp, errors)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         provider_id = EXCLUDED.provider_id,
         status = EXCLUDED.status,
         started_at = EXCLUDED.started_at,
         completed_at = EXCLUDED.completed_at,
         records = EXCLUDED.records,
         freshness_newest_timestamp = EXCLUDED.freshness_newest_timestamp,
         freshness_oldest_timestamp = EXCLUDED.freshness_oldest_timestamp,
         errors = EXCLUDED.errors`,
      [
        run.id,
        run.providerId,
        run.status,
        run.startedAt,
        run.completedAt,
        run.records,
        run.freshness.newestTimestamp,
        run.freshness.oldestTimestamp,
        JSON.stringify(run.errors),
      ],
    );
    return run;
  }

  async listPriceBars(limit = 100) {
    if (!this.pool) return this.fallback.listPriceBars(limit);
    const response = await this.pool.query(
      `SELECT symbol, timestamp, open, high, low, close, volume
       FROM time_series_price_bars
       ORDER BY timestamp DESC
       LIMIT $1`,
      [limit],
    );
    return response.rows.map((row) => ({
      symbol: String(row.symbol),
      timestamp: new Date(row.timestamp).toISOString(),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
    }));
  }

  async listEconomicObservations(limit = 100) {
    if (!this.pool) return this.fallback.listEconomicObservations(limit);
    const response = await this.pool.query(
      `SELECT series_id, timestamp, value, source
       FROM time_series_economic_observations
       ORDER BY timestamp DESC
       LIMIT $1`,
      [limit],
    );
    return response.rows.map((row) => ({
      seriesId: String(row.series_id),
      timestamp: new Date(row.timestamp).toISOString(),
      value: Number(row.value),
      source: String(row.source),
    }));
  }

  async listOptionsSnapshots(limit = 100) {
    if (!this.pool) return this.fallback.listOptionsSnapshots(limit);
    const response = await this.pool.query(
      `SELECT underlying, timestamp, implied_volatility_pct, open_interest
       FROM time_series_options_snapshots
       ORDER BY timestamp DESC
       LIMIT $1`,
      [limit],
    );
    return response.rows.map((row) => ({
      underlying: String(row.underlying),
      timestamp: new Date(row.timestamp).toISOString(),
      impliedVolatilityPct: Number(row.implied_volatility_pct),
      openInterest: Number(row.open_interest),
    }));
  }

  async listIngestionRuns(limit = 100) {
    if (!this.pool) return this.fallback.listIngestionRuns(limit);
    const response = await this.pool.query(
      `SELECT id, provider_id, status, started_at, completed_at, records, freshness_newest_timestamp, freshness_oldest_timestamp, errors
       FROM time_series_ingestion_runs
       ORDER BY completed_at DESC
       LIMIT $1`,
      [limit],
    );
    return response.rows.map((row) => ({
      id: String(row.id),
      providerId: String(row.provider_id),
      status: row.status as ProviderIngestionRun["status"],
      startedAt: new Date(row.started_at).toISOString(),
      completedAt: new Date(row.completed_at).toISOString(),
      records: Number(row.records),
      freshness: {
        newestTimestamp: row.freshness_newest_timestamp ? new Date(row.freshness_newest_timestamp).toISOString() : null,
        oldestTimestamp: row.freshness_oldest_timestamp ? new Date(row.freshness_oldest_timestamp).toISOString() : null,
      },
      errors: Array.isArray(row.errors)
        ? row.errors.map((entry: unknown) => String(entry))
        : JSON.parse(String(row.errors ?? "[]")),
    }));
  }

  async close() {
    await this.pool?.end();
  }

  health(): ReturnType<TimeSeriesStore["health"]> {
    return {
      provider: "timescale" as const,
      status: this.configured ? "healthy" as const : "disabled" as const,
      priceBars: this.fallback.health().priceBars,
      ingestionRuns: this.fallback.health().ingestionRuns,
    };
  }
}

export class TimescaleReadyStore extends PgTimeSeriesStore {
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
