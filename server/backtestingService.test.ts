import assert from "node:assert/strict";
import { backtestRequestSchema, backtestResultSchema } from "@shared/schema";
import { BacktestingService } from "./backtestingService";

const service = new BacktestingService();
const request = backtestRequestSchema.parse({
  strategyName: "Three-fund portfolio",
  startYear: 2008,
  endYear: 2026,
  initialCapital: 25000,
  monthlyContribution: 500,
  rebalanceFrequency: "annual",
  allocation: [
    { symbol: "VTI", targetPct: 55 },
    { symbol: "VXUS", targetPct: 25 },
    { symbol: "BND", targetPct: 20 },
  ],
});
const result = service.run(request);

backtestResultSchema.parse(result);
assert.equal(result.strategyName, request.strategyName);
assert.equal(result.annualResults.length, 19);
assert.ok(result.finalValue > result.totalContributions);
assert.ok(result.volatilityPct > 0);
assert.equal(result.worstYear.year, 2008);
assert.ok(result.riskBreaches.length > 0);
assert.ok(result.notes.some((note) => /not live market data/.test(note)));

const concentrated = service.run(backtestRequestSchema.parse({
  strategyName: "High equity satellite",
  startYear: 2021,
  endYear: 2024,
  initialCapital: 10000,
  monthlyContribution: 0,
  rebalanceFrequency: "quarterly",
  allocation: [
    { symbol: "QQQ", targetPct: 90 },
    { symbol: "SGOV", targetPct: 10 },
  ],
}));

assert.ok(concentrated.riskBreaches.some((item) => /Equity-like allocation/.test(item)));
assert.ok(concentrated.riskBreaches.some((item) => /does not include the 2008/.test(item)));
assert.ok(concentrated.riskBreaches.some((item) => /shorter than five years/.test(item)));

console.log("backtestingService smoke tests passed");
