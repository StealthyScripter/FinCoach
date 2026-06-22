import { randomUUID } from "crypto";
import type { MarketPilotOverview, MemoryHealth, MemoryRecord } from "@shared/schema";
import { getStorageMode } from "./storageMode";
import { memoryStore, type MemoryStore } from "./memoryStoreService";

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

export type MemoryRecallItem = MemoryRecord & {
  source: "semantic" | "long_term";
  relevance: number;
  artifactLinks: Array<{
    label: string;
    href: string;
  }>;
};

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

  recall(query: string, limit = 10): MemoryRecallItem[] {
    const normalized = query.toLowerCase();
    return this.records
      .map((record) => ({
        record,
        relevance: scoreRecord(record, normalized),
      }))
      .filter((item) => item.relevance > 0)
      .sort((left, right) => right.relevance - left.relevance)
      .map((item) => ({
        ...item.record,
        source: "semantic" as const,
        relevance: item.relevance,
        artifactLinks: buildArtifactLinks(item.record),
      }))
      .slice(0, limit);
  }

  count() {
    return this.records.length;
  }

  load(records: MemoryRecord[]) {
    for (const record of records) {
      if (!this.records.some((item) => item.id === record.id)) this.records.push(record);
    }
  }

  clearForTest() {
    this.records.length = 0;
  }
}

export class AgentMemoryService {
  readonly shortTerm = new InMemoryMemory();
  readonly longTerm = new InMemoryMemory();
  readonly semantic = new InMemoryMemory();
  private readonly loadedUsers = new Set<string>();

  constructor(private readonly store: MemoryStore = memoryStore) {}

  async hydrateFromOverview(overview: MarketPilotOverview) {
    if (!this.loadedUsers.has(overview.user.id)) {
      await this.loadPersisted(overview.user.id);
      this.loadedUsers.add(overview.user.id);
    }

    if (this.longTerm.count() > 0 && this.semantic.count() > 0) return;

    for (const report of overview.researchReports) {
      const longTermRecord = this.longTerm.store({
        kind: "research_report",
        text: report.summary,
        tags: ["research", report.agent, report.asset ?? "market"],
        metadata: { reportId: report.id, confidence: report.confidence, graphNodeId: `research-${report.id}` },
      });
      await this.store.append({ userId: overview.user.id, scope: "long_term", record: longTermRecord });
      const semanticRecord = this.semantic.store({
        kind: "market_explanation",
        text: `${report.mainCause} ${report.secondaryCauses.join(" ")}`,
        tags: ["explanation", report.asset ?? "market"],
        metadata: { reportId: report.id, verificationStatus: report.verification.status, graphNodeId: `research-${report.id}` },
      });
      await this.store.append({ userId: overview.user.id, scope: "semantic", record: semanticRecord });
    }

    for (const entry of overview.journalEntries) {
      const longTermRecord = this.longTerm.store({
        kind: "trade_journal",
        text: entry.notes,
        tags: ["journal", ...(entry.linkedTicketId ? [entry.linkedTicketId] : [])],
        metadata: { journalEntryId: entry.id, qualityScore: entry.qualityScore, graphNodeId: `journal-${entry.id}` },
      });
      await this.store.append({ userId: overview.user.id, scope: "long_term", record: longTermRecord });
      for (const lesson of entry.lessons) {
        const semanticRecord = this.semantic.store({
          kind: "lesson_learned",
          text: lesson,
          tags: ["lesson", "proficiency"],
          metadata: { journalEntryId: entry.id, graphNodeId: `lesson-${entry.id}` },
        });
        await this.store.append({ userId: overview.user.id, scope: "semantic", record: semanticRecord });
      }
    }
  }

  recall(query: string, limit = 10): MemoryRecallItem[] {
    const semantic = this.semantic.recall(query, limit).map((item) => ({ ...item, source: "semantic" as const }));
    const longTerm = this.longTerm.recall(query, limit).map((item) => ({ ...item, source: "long_term" as const }));
    const combined = [...semantic, ...longTerm]
      .sort((left, right) => right.relevance - left.relevance || right.createdAt.localeCompare(left.createdAt))
      .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
    return combined.slice(0, limit).map((item) => ({
      ...item,
      artifactLinks: buildArtifactLinks(item),
    }));
  }

  health(now = new Date()): MemoryHealth {
    const storageMode = getStorageMode();
    const storeHealth = this.store.health();
    return {
      generatedAt: now.toISOString(),
      shortTerm: {
        provider: "memory",
        records: this.shortTerm.count(),
        status: "healthy",
      },
      longTerm: {
        provider: storageMode === "postgres" ? (storeHealth.status === "healthy" ? "postgres_available" : "postgres_unavailable") : "memory",
        records: this.longTerm.count(),
        status: storageMode === "postgres" && storeHealth.status !== "healthy" ? "degraded" : "healthy",
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
    this.loadedUsers.clear();
  }

  private async loadPersisted(userId: string) {
    const persistedLongTerm = await this.store.list({ userId, scope: "long_term", limit: 1000 });
    const persistedSemantic = await this.store.list({ userId, scope: "semantic", limit: 1000 });
    this.longTerm.load(persistedLongTerm);
    this.semantic.load(persistedSemantic);
  }
}

export const agentMemoryService = new AgentMemoryService();

function scoreRecord(record: MemoryRecord, query: string) {
  const text = `${record.text} ${record.tags.join(" ")}`.toLowerCase();
  return query.split(/\s+/).filter((term) => term.length > 2 && text.includes(term)).length;
}

function buildArtifactLinks(record: MemoryRecord) {
  const metadata = record.metadata as Record<string, unknown>;
  const links: Array<{ label: string; href: string }> = [];

  if (typeof metadata.predictionId === "string") {
    links.push({
      label: "Open matching journal review",
      href: `/journal?predictionId=${encodeURIComponent(metadata.predictionId)}`,
    });
  }

  if (typeof metadata.journalEntryId === "string") {
    links.push({
      label: "Open journal",
      href: "/journal",
    });
  }

  if (typeof metadata.reportId === "string") {
    links.push({
      label: "Open Ask MarketPilot",
      href: "/ask",
    });
  }

  if (typeof metadata.graphNodeId === "string") {
    links.push({
      label: "Open intelligence graph",
      href: `/intelligence?start=${encodeURIComponent(metadata.graphNodeId)}`,
    });
  }

  return links;
}
