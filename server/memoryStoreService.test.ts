import assert from "node:assert/strict";
import { AgentMemoryService } from "./memoryService";
import { InMemoryMemoryStore } from "./memoryStoreService";
import { createSeedOverview } from "./storage";

const previousUrl = process.env.DATABASE_URL;
const previousMode = process.env.MARKETPILOT_STORAGE;
delete process.env.DATABASE_URL;
process.env.MARKETPILOT_STORAGE = "memory";

const store = new InMemoryMemoryStore();
const overview = createSeedOverview();

const first = new AgentMemoryService(store);
await first.hydrateFromOverview(overview);

assert.ok(store.health().scopes.long_term > 0);
assert.ok(store.health().scopes.semantic > 0);

const second = new AgentMemoryService(store);
await second.hydrateFromOverview(overview);

assert.ok(second.longTerm.recent(10).length > 0);
assert.ok(second.semantic.searchSimilar("rate shock review").length > 0);
assert.equal(second.health().longTerm.provider, "memory");

if (previousUrl === undefined) {
  delete process.env.DATABASE_URL;
} else {
  process.env.DATABASE_URL = previousUrl;
}

if (previousMode === undefined) {
  delete process.env.MARKETPILOT_STORAGE;
} else {
  process.env.MARKETPILOT_STORAGE = previousMode;
}

console.log("memoryStoreService smoke tests passed");
