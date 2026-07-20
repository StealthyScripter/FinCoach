import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { MarketObservation } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgObservationRepository {
  private readonly evidence: PgEvidenceRepository<MarketObservation & { lineageEventIds: string[] }>;

  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_market_observations",
      schemaVersion: "fincoach.v2.observation.1",
      sourceModule: "observations",
      idOf: record => record.observationId,
      naturalKeyOf: record => record.observationId,
      idempotencyKeyOf: record => record.observationId,
      createdAtOf: record => record.observedAt,
    });
  }

  save(observation: MarketObservation) {
    return this.evidence.save({ ...observation, lineageEventIds: observation.upstreamEventIds });
  }

  get(id: string) { return this.evidence.get(id); }
  async list(input: { limit?: number; offset?: number; symbol?: string; status?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; symbol?: string; status?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
