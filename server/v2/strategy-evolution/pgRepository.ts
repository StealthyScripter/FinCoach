import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { EvolvedStrategyRevisionProposal } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgStrategyEvolutionRepository {
  private readonly evidence: PgEvidenceRepository<EvolvedStrategyRevisionProposal>;
  constructor(db: Queryable) {
    this.evidence = new PgEvidenceRepository(db, {
      tableName: "v2_strategy_revision_proposals",
      schemaVersion: "fincoach.v2.strategy-revision.1",
      sourceModule: "strategy-evolution",
      idOf: record => record.proposalId,
      naturalKeyOf: record => record.proposalId,
      idempotencyKeyOf: record => record.proposalId,
      createdAtOf: record => record.createdAt,
    });
  }
  save(proposal: EvolvedStrategyRevisionProposal) { return this.evidence.save(proposal).then(result => ({ inserted: result.inserted, proposal: result.record, conflict: result.conflict })); }
  async list(input: { limit?: number; offset?: number } = {}) { return (await this.evidence.list(input)).items; }
  snapshot() { return this.list(); }
  health() { return this.evidence.health(); }
}
