import assert from "node:assert/strict";
import { brokerReadinessSchema } from "@shared/schema";
import { brokerReadinessService } from "./brokerReadinessService";
import { createSeedOverview } from "./storage";

const now = new Date("2026-06-15T12:00:00.000Z");
const overview = createSeedOverview();
const readiness = brokerReadinessService.evaluate(overview, { now });

for (const item of readiness) {
  brokerReadinessSchema.parse(item);
}

const paper = readiness.find((item) => item.broker === "paper_broker");
assert.ok(paper);
assert.equal(paper.connectionStatus, "paper_ready");
assert.equal(paper.paperOnly, true);
assert.equal(paper.liveExecutionAllowed, false);
assert.equal(paper.requiredActions.length, 0);

const ibkr = readiness.find((item) => item.broker === "interactive_brokers");
assert.ok(ibkr);
assert.equal(ibkr.connectionStatus, "blocked");
assert.equal(ibkr.liveExecutionAllowed, false);
assert.equal(ibkr.paperOnly, true);
assert.equal(ibkr.vault.provider, "not_configured");
assert.equal(ibkr.vault.credentialsStored, false);
assert.equal(ibkr.vault.rotationRequired, true);
assert.equal(ibkr.mfaRequired, true);
assert.equal(ibkr.deviceVerificationRequired, true);
assert.ok(ibkr.requiredActions.includes("Verify MFA for the broker connection."));
assert.ok(ibkr.requiredActions.includes("Verify this device before broker access."));
assert.ok(ibkr.checks.some((check) => check.id === "proficiency_stage" && check.status === "fail"));
assert.ok(ibkr.checks.some((check) => check.id === "read_only_default" && check.status === "pass"));

const unlockedOverview = {
  ...overview,
  user: {
    ...overview.user,
    liveTradingEnabled: true,
  },
  progression: {
    ...overview.progression,
    currentStage: "supervised_live" as const,
    stageLabel: "Supervised Live Assistance Mode",
  },
};
const unlocked = brokerReadinessService.evaluate(unlockedOverview, {
  vaultProvider: "external_vault",
  credentialsStored: true,
  mfaVerified: true,
  deviceVerified: true,
  sessionFresh: true,
  adminUnlock: true,
  userUnlock: true,
  now,
});
const unlockedIbkr = unlocked.find((item) => item.broker === "interactive_brokers");
assert.ok(unlockedIbkr);
assert.equal(unlockedIbkr.connectionStatus, "read_only_ready");
assert.equal(unlockedIbkr.liveExecutionAllowed, true);
assert.equal(unlockedIbkr.requiredActions.length, 0);

console.log("broker readiness service tests passed");
