import assert from "node:assert/strict";
import { InMemoryTransactionalReliabilityRepository } from "./execution/transactionalReliabilityRepository";

const repository = new InMemoryTransactionalReliabilityRepository();
const acquired = await repository.reserveSubmission("key-1", "fingerprint-1", "reservation-a");
assert.equal(acquired.status, "acquired");
const duplicate = await repository.reserveSubmission("key-1", "fingerprint-1", "reservation-b");
assert.equal(duplicate.status, "in_doubt");
await repository.resolveSubmission("key-1", "record_not_submitted", "operator");
const retry = await repository.reserveSubmission("key-1", "fingerprint-1", "reservation-c");
assert.equal(retry.status, "acquired");
await repository.completeSubmission("key-1", "reservation-c", {
  provider: "metatrader_demo",
  orderId: "order-1",
  status: "filled",
  reason: null,
  submittedAt: new Date().toISOString(),
  productionOrderSubmissionEnabled: false,
});
const replay = await repository.reserveSubmission("key-1", "fingerprint-1", "reservation-d");
assert.equal(replay.status, "replay");
if (replay.status === "replay") assert.equal(replay.result.orderId, "order-1");
assert.equal((await repository.reserveSubmission("key-1", "other-fingerprint", "reservation-e")).status, "conflict");

const now = new Date("2026-06-20T12:00:00.000Z");
await repository.acquireLease("strategy-1", "worker-a", 1_000, now);
await assert.rejects(
  () => repository.acquireLease("strategy-1", "worker-b", 1_000, now),
  /another runtime/,
);
await repository.renewLease("strategy-1", "worker-a", 2_000, new Date("2026-06-20T12:00:00.500Z"));
await repository.releaseLease("strategy-1", "worker-a");
assert.equal((await repository.acquireLease("strategy-1", "worker-b", 1_000, now)).leaseId.length > 0, true);
assert.equal(repository.health().transactional, false);

console.log("transactionalReliabilityRepository smoke tests passed");
