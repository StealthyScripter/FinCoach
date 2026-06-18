import assert from "node:assert/strict";
import { liveAssistancePolicySchema } from "@shared/schema";
import { brokerReadinessService } from "./brokerReadinessService";
import { createSeedOverview } from "./storage";
import { liveAssistancePolicyService } from "./liveAssistancePolicyService";

const now = new Date("2026-06-15T12:00:00.000Z");
const overview = createSeedOverview();
const policy = liveAssistancePolicyService.evaluate({
  overview,
  brokerReadiness: brokerReadinessService.evaluate(overview, { now }),
  now,
});

liveAssistancePolicySchema.parse(policy);
assert.equal(policy.status, "blocked");
assert.equal(policy.canRequestLivePreview, false);
assert.equal(policy.canPlaceLiveOrder, false);
assert.equal(policy.currentStage, "foundation");
assert.equal(policy.riskOfficerVeto, true);
assert.ok(policy.requiredActions.includes("Reach Supervised Live Assistance Mode before any live broker workflow."));
assert.ok(policy.requiredActions.includes("Enable the supervised-live feature flag after compliance approval."));
assert.ok(policy.requiredActions.includes("Acknowledge MarketPilot risk, AI, and responsibility disclosures."));
assert.ok(policy.prohibitedCapabilities.includes("Autonomous live order placement"));
assert.ok(policy.complianceNotices.some((notice) => notice.includes("AI explanations")));

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
    blockedBy: [],
  },
  complianceProfile: {
    ...overview.complianceProfile,
    disclosuresAccepted: true,
    acceptedAt: now.toISOString(),
    userConfirmation: "I understand MarketPilot disclosures.",
  },
};
const readyBroker = brokerReadinessService.evaluate(unlockedOverview, {
  vaultProvider: "external_vault",
  credentialsStored: true,
  mfaVerified: true,
  deviceVerified: true,
  sessionFresh: true,
  adminUnlock: true,
  userUnlock: true,
  now,
});
const readOnlyPolicy = liveAssistancePolicyService.evaluate({
  overview: unlockedOverview,
  brokerReadiness: readyBroker,
  now,
});

assert.equal(readOnlyPolicy.status, "eligible_read_only");
assert.equal(readOnlyPolicy.canRequestLivePreview, true);
assert.equal(readOnlyPolicy.canPlaceLiveOrder, false);
assert.equal(readOnlyPolicy.riskOfficerVeto, true);

console.log("live assistance policy service tests passed");
