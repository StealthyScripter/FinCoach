import assert from "node:assert/strict";
import type { ProficiencyScore } from "@shared/schema";
import { OptionsSimulationService } from "./optionsSimulationService";

const service = new OptionsSimulationService();
const now = "2026-06-15T12:00:00.000Z";
const proficiencyScores: ProficiencyScore[] = [
  {
    id: "prof-options",
    category: "options",
    label: "Options",
    score: 65,
    unlocks: [],
    evidence: [],
    updatedAt: now,
  },
];

const longCall = service.simulate(
  {
    underlying: "SPY",
    underlyingPrice: 500,
    daysToExpiration: 30,
    impliedVolatilityPct: 22,
    legs: [{ action: "buy", type: "call", strike: 505, premium: 6, contracts: 1 }],
  },
  proficiencyScores,
);

assert.equal(longCall.strategyName, "Long call");
assert.equal(longCall.netDebit, 600);
assert.equal(longCall.maxLoss, 600);
assert.equal(longCall.maxProfit, null);
assert.equal(longCall.proficiencyGate.unlocked, false);
assert.ok(longCall.breakevens.some((price) => price >= 510 && price <= 512));

const spread = service.simulate(
  {
    underlying: "SPY",
    underlyingPrice: 500,
    daysToExpiration: 45,
    impliedVolatilityPct: 19,
    legs: [
      { action: "buy", type: "call", strike: 500, premium: 8, contracts: 1 },
      { action: "sell", type: "call", strike: 515, premium: 3, contracts: 1 },
    ],
  },
  [{ ...proficiencyScores[0], score: 88 }],
);

assert.equal(spread.strategyName, "Call spread");
assert.equal(spread.netDebit, 500);
assert.equal(spread.maxLoss, 500);
assert.equal(spread.maxProfit, 1000);
assert.equal(spread.proficiencyGate.requiredScore, 85);
assert.equal(spread.proficiencyGate.unlocked, true);
assert.match(spread.assignmentRisk, /Short call/);

const nakedShortCall = service.simulate(
  {
    underlying: "SPY",
    underlyingPrice: 500,
    daysToExpiration: 20,
    impliedVolatilityPct: 24,
    legs: [{ action: "sell", type: "call", strike: 510, premium: 4, contracts: 1 }],
  },
  [{ ...proficiencyScores[0], score: 95 }],
);

assert.equal(nakedShortCall.maxLoss, null);
assert.match(nakedShortCall.riskRewardSummary, /undefined upside loss risk/);

console.log("optionsSimulationService smoke tests passed");
