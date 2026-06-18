import assert from "node:assert/strict";
import { InMemoryVectorStore, QdrantVectorStore } from "./vectorStoreService";

const store = new InMemoryVectorStore();
await store.upsert({ id: "doc-1", text: "SPY risk rates dollar", vector: [1, 0, 0], metadata: { kind: "research_report" } });
await store.upsert({ id: "doc-2", text: "Gold inflation hedge", vector: [0, 1, 0], metadata: { kind: "market_explanation" } });

const results = await store.search([1, 0, 0], 1);
assert.equal(results.length, 1);
assert.equal(results[0].id, "doc-1");
assert.equal(store.health().status, "healthy");

const qdrant = new QdrantVectorStore();
assert.ok(["disabled", "healthy"].includes(qdrant.health().status));

console.log("vectorStoreService smoke tests passed");
