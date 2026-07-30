import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { MarketObservation } from "./contracts";
import { completeObservationIdentity } from "./evidence";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgObservationRepository {
  private readonly evidence: PgEvidenceRepository<MarketObservation & { lineageEventIds: string[] }>;

  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_market_observations",
      schemaVersion: "fincoach.v2.observation.1",
      sourceModule: "observations",
      idOf: record => record.observationId,
      naturalKeyOf: record => completeObservationIdentity(record).naturalKey ?? record.observationId,
      idempotencyKeyOf: record => completeObservationIdentity(record).idempotencyKey ?? record.observationId,
      createdAtOf: record => record.observedAt,
      supersedesIdOf: record => record.supersedesId ?? null,
      extraColumnsOf: record => ({
        symbol: record.symbol,
        timeframe: record.timeframe,
        observation_type: record.observationType,
        detector_id: record.detectorId,
        detector_version: record.detectorVersion,
        strategy_family: record.strategyFamily ?? null,
        lifecycle: record.lifecycle,
        observed_at: record.observedAt,
        candle_start: record.candleStart ?? null,
        candle_end: record.candleEnd ?? null,
        lookback_start: record.lookbackStart ?? null,
        lookback_end: record.lookbackEnd ?? null,
        market_data_source: record.marketDataSource ?? null,
        source_data_hash: record.sourceDataHash ?? null,
        confidence: record.confidence,
        quality_score: record.qualityScore,
        expires_at: record.expiresAt,
      }),
    });
  }

  save(observation: MarketObservation) {
    return this.evidence.save({ ...completeObservationIdentity(observation), lineageEventIds: observation.upstreamEventIds });
  }

  get(id: string) { return this.evidence.get(id); }
  async list(input: { limit?: number; offset?: number; symbol?: string; status?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; symbol?: string; status?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }

  async eligibleForHypothesis(input: { symbol: string; timeframe: string; detectorId: string; observationType: string; strategyFamily?: string; lookbackHours: number; minimumQualityScore: number; now: Date; limit: number }): Promise<MarketObservation[]> {
    const since = new Date(input.now.getTime() - input.lookbackHours * 60 * 60_000).toISOString();
    const result = await (this.evidence as unknown as { db: Queryable }).db.query(
      `SELECT *
       FROM v2_market_observations
       WHERE symbol = $1
         AND timeframe = $2
         AND detector_id = $3
         AND observation_type = $4
         AND ($5::text IS NULL OR strategy_family = $5)
         AND lifecycle = 'active'
         AND expires_at > $6
         AND quality_score >= $7
         AND candle_end IS NOT NULL
         AND source_data_hash IS NOT NULL
         AND created_at >= $8
         AND supersedes_id IS NULL
       ORDER BY candle_end DESC, created_at DESC
       LIMIT $9`,
      [input.symbol, input.timeframe, input.detectorId, input.observationType, input.strategyFamily ?? null, input.now.toISOString(), input.minimumQualityScore, since, input.limit],
    );
    return result.rows.map((row: { payload: MarketObservation }) => row.payload);
  }
}
