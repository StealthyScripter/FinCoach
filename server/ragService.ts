import { randomUUID } from "crypto";
import type { MarketPilotOverview, MemoryRecord } from "@shared/schema";
import { aiProvider } from "./aiProviderService";
import { eventLogService } from "./eventLogService";
import { knowledgeGraphService } from "./knowledgeGraphService";
import { agentMemoryService, type MemoryRecallItem } from "./memoryService";
import { vectorStore } from "./vectorStoreService";
import { storage } from "./storage";

export type RAGDocument = { id: string; kind: MemoryRecord["kind"] | "economic_event" | "filing_placeholder" | "earnings_placeholder"; text: string; metadata: Record<string, unknown>; timestamp: string };
export type RAGChunk = RAGDocument & { chunkId: string };
export type RetrievedContext = {
  query: string;
  chunks: Array<RAGChunk & { score: number }>;
  citations: Array<{ id: string; label: string; timestamp: string; source: string }>;
  similarMemory: MemoryRecallItem[];
  confidence: number;
  sourceFreshness: "fresh" | "stale" | "mixed";
  contradictionHints: string[];
};

export interface DocumentIngestor { ingest(overview: MarketPilotOverview): RAGDocument[] }
export interface Chunker { chunk(document: RAGDocument): RAGChunk[] }
export interface EmbeddingStore { index(chunks: RAGChunk[]): Promise<void> }
export interface RetrievalService { retrieve(query: string, limit?: number): Promise<RetrievedContext> }
export interface CitationBuilder { build(chunks: RAGChunk[]): RetrievedContext["citations"] }
export interface RAGContextBuilder { build(overview: MarketPilotOverview, query: string): Promise<RetrievedContext> }

export class DemoDocumentIngestor implements DocumentIngestor {
  ingest(overview: MarketPilotOverview): RAGDocument[] {
    return [
      ...overview.researchReports.map((report) => ({
        id: report.id,
        kind: "research_report" as const,
        text: `${report.title}. ${report.summary} ${report.mainCause}`,
        metadata: { confidence: report.confidence, verificationStatus: report.verification.status },
        timestamp: report.generatedAt,
      })),
      ...overview.journalEntries.map((entry) => ({
        id: entry.id,
        kind: "trade_journal" as const,
        text: `${entry.title}. ${entry.notes} ${entry.lessons.join(" ")}`,
        metadata: { qualityScore: entry.qualityScore },
        timestamp: entry.createdAt,
      })),
      ...overview.riskRules.map((rule) => ({
        id: rule.id,
        kind: "economic_event" as const,
        text: `${rule.label}. ${rule.description}`,
        metadata: { status: rule.status },
        timestamp: new Date().toISOString(),
      })),
    ];
  }
}

export class SimpleChunker implements Chunker {
  chunk(document: RAGDocument): RAGChunk[] {
    const sentences = document.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    return sentences.length > 0
      ? sentences.map((text, index) => ({ ...document, text, chunkId: `${document.id}-${index}` }))
      : [{ ...document, chunkId: `${document.id}-0` }];
  }
}

export class VectorEmbeddingStore implements EmbeddingStore {
  async index(chunks: RAGChunk[]) {
    for (const chunk of chunks) {
      await vectorStore.upsert({
        id: chunk.chunkId,
        text: chunk.text,
        vector: await aiProvider.embed(chunk.text),
        metadata: chunk.metadata,
      });
    }
  }
}

export class DemoRetrievalService implements RetrievalService {
  async retrieve(query: string, limit = 5): Promise<RetrievedContext> {
    const results = await vectorStore.search(await aiProvider.embed(query), limit);
    const chunks = results.map((result) => ({
      id: String(result.metadata.id ?? result.id),
      kind: String(result.metadata.kind ?? "research_report") as RAGChunk["kind"],
      text: result.text,
      metadata: result.metadata,
      timestamp: String(result.metadata.timestamp ?? new Date().toISOString()),
      chunkId: result.id,
      score: result.score,
    }));
    return {
      query,
      chunks,
      citations: new DemoCitationBuilder().build(chunks),
      similarMemory: [],
      confidence: chunks.length ? Math.round(chunks.reduce((sum, item) => sum + Math.max(0, item.score), 0) / chunks.length * 100) : 0,
      sourceFreshness: "mixed",
      contradictionHints: chunks.some((chunk) => /contradict|risk|not live/i.test(chunk.text)) ? ["Retrieved context contains caution or contradiction language."] : [],
    };
  }
}

export class DemoCitationBuilder implements CitationBuilder {
  build(chunks: RAGChunk[]) {
    return chunks.map((chunk) => ({
      id: chunk.chunkId,
      label: chunk.text.slice(0, 80),
      timestamp: chunk.timestamp,
      source: chunk.kind,
    }));
  }
}

export class DemoRAGContextBuilder implements RAGContextBuilder {
  constructor(
    private readonly ingestor = new DemoDocumentIngestor(),
    private readonly chunker = new SimpleChunker(),
    private readonly store = new VectorEmbeddingStore(),
    private readonly retrieval = new DemoRetrievalService(),
  ) {}

  async build(overview: MarketPilotOverview, query: string): Promise<RetrievedContext> {
    await agentMemoryService.hydrateFromOverview(overview);
    const similarMemory = agentMemoryService.recall(query, 6);
    const graph = knowledgeGraphService.build(overview);
    const graphDocs: RAGDocument[] = graph.nodes.slice(0, 8).map((node) => ({
      id: `kg-${node.id}`,
      kind: "market_explanation",
      text: `${node.type}: ${node.label}`,
      metadata: { id: node.id, kind: node.type, timestamp: node.timestamp },
      timestamp: node.timestamp,
    }));
    const memoryDocs: RAGDocument[] = similarMemory.map((memory) => ({
      id: `memory-${memory.id}`,
      kind: memory.kind,
      text: memory.text,
      metadata: {
        ...memory.metadata,
        source: memory.source,
        relevance: memory.relevance,
        artifactLinks: memory.artifactLinks,
        memoryId: memory.id,
      },
      timestamp: memory.createdAt,
    }));
    const sourceDocuments = [...this.ingestor.ingest(overview), ...graphDocs, ...memoryDocs];
    const chunks = sourceDocuments.flatMap((document) =>
      this.chunker.chunk({ ...document, id: document.id || randomUUID() }),
    );
    await this.store.index(chunks.map((chunk) => ({
      ...chunk,
      metadata: { ...chunk.metadata, id: chunk.id, kind: chunk.kind, timestamp: chunk.timestamp },
    })));
    const context = await this.retrieval.retrieve(query);
    await storage.saveRagDocuments(sourceDocuments.map((document) => ({
      id: document.id,
      userId: overview.user.id,
      runId: `rag-${hashQuery(query)}`,
      kind: document.kind,
      text: document.text,
      metadata: document.metadata,
      timestamp: document.timestamp,
      chunkIds: chunks.filter((chunk) => chunk.id === document.id).map((chunk) => chunk.chunkId),
      createdAt: new Date().toISOString(),
    })));
    await storage.saveRagRun({
      id: `rag-${hashQuery(query)}`,
      userId: overview.user.id,
      query,
      chunkCount: context.chunks.length,
      confidence: context.confidence,
      sourceFreshness: context.sourceFreshness,
      citationIds: context.citations.map((citation) => citation.id),
      chunkIds: context.chunks.map((chunk) => chunk.chunkId),
      createdAt: new Date().toISOString(),
    });
    eventLogService.append({
      type: "rag.context_built",
      userId: overview.user.id,
      sourceService: "rag-service",
      correlationId: `rag-${randomUUID()}`,
      payload: {
        query,
        chunkCount: context.chunks.length,
        confidence: context.confidence,
        sourceFreshness: context.sourceFreshness,
        citationIds: context.citations.map((citation) => citation.id),
        chunkIds: context.chunks.map((chunk) => chunk.chunkId),
      },
    });
    return {
      ...context,
      similarMemory,
      sourceFreshness: determineSourceFreshness([...context.chunks, ...memoryDocs.map((document) => ({
        ...document,
        chunkId: document.id,
        score: 1,
      }))]),
      contradictionHints: [
        ...context.contradictionHints,
        ...similarMemory.filter((item) => /contradict|risk|mistake|loss|wrong/i.test(item.text)).map((item) => `Memory reminder: ${item.text.slice(0, 120)}`),
      ].slice(0, 5),
    };
  }
}

export const ragContextBuilder = new DemoRAGContextBuilder();

function hashQuery(query: string) {
  return query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "query";
}

function determineSourceFreshness(chunks: Array<{ timestamp: string }>) {
  if (chunks.length === 0) return "mixed" as const;
  const timestamps = chunks.map((chunk) => Date.parse(chunk.timestamp)).filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return "mixed" as const;
  const newestAgeDays = (Date.now() - Math.max(...timestamps)) / (1000 * 60 * 60 * 24);
  const oldestAgeDays = (Date.now() - Math.min(...timestamps)) / (1000 * 60 * 60 * 24);
  if (newestAgeDays <= 30 && oldestAgeDays <= 120) return "fresh" as const;
  if (oldestAgeDays > 365) return "stale" as const;
  return "mixed" as const;
}
