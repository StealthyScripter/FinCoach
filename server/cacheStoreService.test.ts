import assert from "node:assert/strict";
import { InMemoryCacheStore, RedisCacheStore } from "./cacheStoreService";

const cache = new InMemoryCacheStore();
await cache.set("provider:SPY", { close: 548 }, 60);
assert.deepEqual(await cache.get("provider:SPY"), { close: 548 });

const first = await cache.increment("rate:user-demo", 60_000);
const second = await cache.increment("rate:user-demo", 60_000);
assert.equal(first.count, 1);
assert.equal(second.count, 2);

await cache.delete("provider:SPY");
assert.equal(await cache.get("provider:SPY"), null);
assert.equal(cache.health().provider, "memory");

const redis = new RedisCacheStore();
assert.ok(["disabled", "healthy"].includes(redis.health().status));

console.log("cacheStoreService smoke tests passed");
