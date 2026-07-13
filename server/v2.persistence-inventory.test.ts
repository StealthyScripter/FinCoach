import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  durableBeforeExtendedPilot,
  persistenceInventory,
  persistenceRequirementSchema,
} from "./v2/governance/persistenceInventory";

assert.ok(persistenceInventory.length >= 20, "inventory should cover V2 operational and evidence repositories");

for (const item of persistenceInventory) {
  persistenceRequirementSchema.parse(item);
  assert.ok(item.ownerModule, `${item.recordType} must declare owner`);
  assert.ok(item.naturalKey.length > 0, `${item.recordType} must declare natural key`);
  assert.ok(item.idempotencyKey.length > 0, `${item.recordType} must declare idempotency key`);
  assert.ok(item.schemaVersion.length > 0, `${item.recordType} must declare schema version`);
}

const required = durableBeforeExtendedPilot();
assert.deepEqual(
  required.map(item => item.recordType).sort(),
  [
    "consumer_acknowledgement",
    "daily_report",
    "daily_report_delivery",
    "dead_letter",
    "orchestration_checkpoint",
    "orchestration_cycle",
    "pilot_lifecycle",
    "pilot_scorecard",
    "retry_state",
    "worker_lease",
  ],
);
assert.equal(required.every(item => item.postgresMilestone === "B"), true);

const duplicateOwnership = new Map<string, string>();
for (const item of persistenceInventory) {
  const existing = duplicateOwnership.get(item.recordType);
  assert.equal(existing, undefined, `${item.recordType} has duplicate ownership: ${existing} and ${item.ownerModule}`);
  duplicateOwnership.set(item.recordType, item.ownerModule);
}

const v2Files = filesUnder(join(process.cwd(), "server/v2")).filter(file => file.endsWith(".ts"));
for (const file of v2Files) {
  const source = readFileSync(file, "utf8");
  const relative = file.slice(process.cwd().length + 1);
  assert.equal(/\b(sql|db)\s*`|SELECT\s+.+\s+FROM\s+v2_/i.test(source), false, `${relative} must not use direct V2 SQL outside repositories`);
  if (!relative.endsWith("/index.ts")) {
    assert.equal(/from "\.\.\/[^"]+\/repository"/.test(source), false, `${relative} must not import peer concrete repositories`);
  }
}

console.log("v2 production readiness persistence inventory tests passed");

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}
