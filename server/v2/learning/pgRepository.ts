import type { Pool, PoolClient } from "pg";
import { PgEvidenceRepository } from "../persistence/evidenceRepository";
import type { LearningLesson, StrategyRevisionProposal } from "./contracts";

type Queryable = Pick<Pool | PoolClient, "query">;

export class PgLearningRepository {
  private readonly lessons: PgEvidenceRepository<LearningLesson>;
  private readonly proposals: PgEvidenceRepository<StrategyRevisionProposal>;
  constructor(db: Queryable) {
    this.lessons = new PgEvidenceRepository(db, {
      tableName: "v2_learning_lessons",
      schemaVersion: "fincoach.v2.learning-lesson.1",
      sourceModule: "learning",
      idOf: record => record.lessonId,
      naturalKeyOf: record => record.lessonId,
      idempotencyKeyOf: record => record.lessonId,
      createdAtOf: record => record.createdAt,
      supersedesIdOf: record => record.supersedesLessonId,
    });
    this.proposals = new PgEvidenceRepository(db, {
      tableName: "v2_learning_revision_proposals",
      schemaVersion: "fincoach.v2.revision-proposal.1",
      sourceModule: "learning",
      idOf: record => record.proposalId,
      naturalKeyOf: record => record.proposalId,
      idempotencyKeyOf: record => record.proposalId,
      createdAtOf: record => record.createdAt,
    });
  }
  saveLesson(lesson: LearningLesson) { return this.lessons.save(lesson).then(result => ({ inserted: result.inserted, lesson: result.record, conflict: result.conflict })); }
  saveProposal(proposal: StrategyRevisionProposal) { return this.proposals.save(proposal).then(result => ({ inserted: result.inserted, proposal: result.record, conflict: result.conflict })); }
  async listLessons(input: { limit?: number; offset?: number } = {}) { return (await this.lessons.list(input)).items; }
  listPage(input: { limit?: number; offset?: number } = {}) { return this.lessons.list(input); }
  async listProposals(input: { limit?: number; offset?: number; strategyId?: string } = {}) { return (await this.proposals.list(input)).items; }
  async snapshot() { return { lessons: await this.listLessons(), proposals: await this.listProposals() }; }
  health() { return this.lessons.health(); }
}
