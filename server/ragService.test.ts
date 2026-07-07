import assert from "node:assert/strict";
import { eventLogService } from "./eventLogService";
import { createSeedOverview } from "./storage";
import { storage } from "./storage";
import { DemoCitationBuilder, DemoDocumentIngestor, DemoRAGContextBuilder, SimpleChunker } from "./ragService";
import { bootstrapTestDatabase } from "./testDatabase";

await bootstrapTestDatabase();

const overview = createSeedOverview();
const documents = new DemoDocumentIngestor().ingest(overview);
assert.ok(documents.length > 0);
assert.ok(documents.some((document) => document.kind === "research_report"));

const chunks = new SimpleChunker().chunk(documents[0]);
assert.ok(chunks.length > 0);
assert.ok(chunks[0].chunkId.startsWith(documents[0].id));

const citations = new DemoCitationBuilder().build(chunks);
assert.equal(citations.length, chunks.length);

const context = await new DemoRAGContextBuilder().build(overview, "risk verification SPY");
assert.equal(context.query, "risk verification SPY");
assert.ok(context.chunks.length > 0);
assert.ok(context.citations.length > 0);
assert.ok(context.similarMemory.length > 0);
assert.ok(context.confidence >= 0);
assert.notEqual(context.sourceFreshness, "stale");
assert.ok(eventLogService.list(10).some((event) => event.type === "rag.context_built"));
assert.ok((await storage.getRagRuns()).some((run) => run.query === "risk verification SPY"));
assert.ok((await storage.getRagDocuments()).length > 0);

console.log("ragService smoke tests passed");
