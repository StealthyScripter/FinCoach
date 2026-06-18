import { randomUUID } from "crypto";
import type { MarketPilotOverview, MemoryHealth, MemoryRecord } from "@shared/schema";
import { getStorageMode } from "./storageMode";

export interface ShortTermMemory {
  store(record: Omit<MemoryRecord, "id" | "createdAt">): MemoryRecord;
  recent(limit?: number): MemoryRecord[];
}

export interface LongTermMemory {
  store(record: Omit<MemoryRecord, "id" | "createdAt">): MemoryRecord;
  findByTag(tag: string, limit?: number): MemoryRecord[];
}

export interface SemanticMemory {
  store(record: Omit<MemoryRecord, "id" | "createdAt">): MemoryRecord;
  searchSimilar(query: string, limit?: number): MemoryRecord[];
}

class InMemoryMemory implements ShortTermMemory, LongTermMemory, SemanticMemory {
  private readonly records: MemoryRecord[] = [];

  store(record: Omit<MemoryRecord, "id" | "createdAt">): MemoryRecord {
    const saved = {
      ...record,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.records.unshift(saved);
    return saved;
  }

  recent(limit = 10): MemoryRecord[] {
    return this.records.slice(0, limit);
  }

  findByTag(tag: string, limit = 10): MemoryRecord[] {
    return this.records.filter((record) => record.tags.includes(tag)).slice(0, limit);
  }

  searchSimilar(query: string, limit = 10): MemoryRecord[] {
    const normalized = query.toLowerCase();
    return this.records
      .map((record) => ({
        record,
        score: scoreRecord(record, normalized),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((item) => item.record)
      .slice(0, limit);
  }

  count() {
    return this.records.length;
  }

  clearForTest() {
    this.records.length = 0;
  }
}

export class AgentMemoryService {
  readonly shortTerm = new InMemoryMemory();
  readonly longTerm = new InMemoryMemory();
  readonly semantic = new InMemoryMemory();

  hydrateFromOverview(overview: MarketPilotOverview) {
    if (this.longTerm.count() > 0) return;

    for (const report of overview.researchReports) {
      this.longTerm.store({
        kind: "research_report",
        text: report.summary,
        tags: ["research", report.agent, report.asset ?? "market"],
        metadata: { reportId: report.id, confidence: report.confidence },
      });
      this.semantic.store({
        kind: "market_explanation",
        text: `${report.mainCause} ${report.secondaryCauses.join(" ")}`,
        tags: ["explanation", report.asset ?? "market"],
        metadata: { reportId: report.id, verificationStatus: report.verification.status },
      });
    }

    for (const entry of overview.journalEntries) {
      this.longTerm.store({
        kind: "trade_journal",
        text: entry.notes,
        tags: ["journal", ...(entry.linkedTicketId ? [entry.linkedTicketId] : [])],
        metadata: { journalEntryId: entry.id, qualityScore: entry.qualityScore },
      });
      for (const lesson of entry.lessons) {
        this.semantic.store({
          kind: "lesson_learned",
          text: lesson,
          tags: ["lesson", "proficiency"],
          metadata: { journalEntryId: entry.id },
        });
      }
    }
  }

  health(now = new Date()): MemoryHealth {
    const storageMode = getStorageMode();
    return {
      generatedAt: now.toISOString(),
      shortTerm: {
        provider: "memory",
        records: this.shortTerm.count(),
        status: "healthy",
      },
      longTerm: {
        provider: storageMode === "postgres" ? "postgres_available" : "memory",
        records: this.longTerm.count(),
        status: "healthy",
      },
      semantic: {
        provider: "memory",
        records: this.semantic.count(),
        status: "healthy",
      },
    };
  }

  clearForTest() {
    this.shortTerm.clearForTest();
    this.longTerm.clearForTest();
    this.semantic.clearForTest();
  }
}

export const agentMemoryService = new AgentMemoryService();

function scoreRecord(record: MemoryRecord, query: string) {
  const text = `${record.text} ${record.tags.join(" ")}`.toLowerCase();
  return query.split(/\s+/).filter((term) => term.length > 2 && text.includes(term)).length;
}
