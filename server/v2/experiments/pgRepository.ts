import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { ResearchExperiment } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgExperimentRepository {
  private readonly evidence: PgEvidenceRepository<ResearchExperiment & { lineageEventIds: string[] }>;

  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_research_experiments",
      schemaVersion: "fincoach.v2.experiment.1",
      sourceModule: "experiments",
      idOf: record => record.experimentId,
      naturalKeyOf: record => record.fingerprint,
      idempotencyKeyOf: record => record.fingerprint,
      createdAtOf: record => record.createdAt,
    });
  }

  async save(experiment: ResearchExperiment) {
    const saved = await this.evidence.save({ ...experiment, lineageEventIds: [experiment.hypothesisId, experiment.strategyId] });
    return { inserted: saved.inserted, experiment: saved.record, existing: saved.inserted ? null : saved.record };
  }

  update(experiment: ResearchExperiment) {
    return this.save(experiment);
  }

  get(id: string) { return this.evidence.get(id); }
  async list(input: { limit?: number; offset?: number; status?: string; strategyId?: string } = {}) { return (await this.evidence.list(input)).items; }
  listPage(input: { limit?: number; offset?: number; status?: string; strategyId?: string } = {}) { return this.evidence.list(input); }
  health() { return this.evidence.health(); }
}
