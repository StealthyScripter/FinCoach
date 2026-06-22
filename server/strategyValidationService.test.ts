import assert from "node:assert/strict";
import { strategyValidationService } from "./execution/strategyValidation";

const scorecard = strategyValidationService.evaluate({
  strategyId: "demo-three-fund",
  instrument: "VTI",
  backtest: {
    netReturnPct: 18,
    sharpe: 1.4,
    profitFactor: 1.8,
    maxDrawdownPct: 12,
    tradeCount: 86,
  },
  walkForward: {
    profitableWindowsPct: 68,
    outOfSampleReturnPct: 7,
    degradationPct: 14,
  },
  monteCarlo: {
    profitableRunsPct: 72,
    medianEndingReturnPct: 9,
    riskOfRuinPct: 8,
  },
  regimePerformance: {
    calm: 12,
    stress: 13,
    recovery: 14,
  },
  symbolPerformance: {
    VTI: 11,
  },
});

assert.equal(scorecard.strategyId, "demo-three-fund");
assert.equal(scorecard.instrument, "VTI");
assert.ok(scorecard.overallScore > 0);
assert.equal(scorecard.overfittingWarning, false);
assert.equal(scorecard.regimeSensitivity, "low");
assert.notEqual(scorecard.verdict, "reject");

console.log("strategyValidationService smoke tests passed");
