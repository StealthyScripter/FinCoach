import type { LearningLesson, StrategyRevisionProposal } from "./contracts";

export class InMemoryLearningRepository {
  private readonly lessons = new Map<string, LearningLesson>();
  private readonly proposals = new Map<string, StrategyRevisionProposal>();

  constructor(seed: { lessons?: readonly LearningLesson[]; proposals?: readonly StrategyRevisionProposal[] } = {}) {
    for (const lesson of seed.lessons ?? []) this.lessons.set(lesson.lessonId, freezeRecord(lesson));
    for (const proposal of seed.proposals ?? []) this.proposals.set(proposal.proposalId, freezeRecord(proposal));
  }

  saveLesson(lesson: LearningLesson) {
    const existing = this.lessons.get(lesson.lessonId);
    if (existing) return { inserted: false, lesson: existing };
    const frozen = freezeRecord(lesson);
    this.lessons.set(frozen.lessonId, frozen);
    return { inserted: true, lesson: frozen };
  }

  saveProposal(proposal: StrategyRevisionProposal) {
    const existing = this.proposals.get(proposal.proposalId);
    if (existing) return { inserted: false, proposal: existing };
    const frozen = freezeRecord(proposal);
    this.proposals.set(frozen.proposalId, frozen);
    return { inserted: true, proposal: frozen };
  }

  listLessons() {
    return [...this.lessons.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.lessonId.localeCompare(b.lessonId));
  }

  listProposals() {
    return [...this.proposals.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.proposalId.localeCompare(b.proposalId));
  }

  snapshot() {
    return { lessons: this.listLessons(), proposals: this.listProposals() };
  }
}

function freezeRecord<T>(record: T): T {
  if (record && typeof record === "object") {
    Object.freeze(record);
    for (const value of Object.values(record as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Object.isFrozen(value)) freezeRecord(value);
    }
  }
  return record;
}
