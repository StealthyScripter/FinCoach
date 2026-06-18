import assert from "node:assert/strict";
import { createSeedOverview } from "./storage";
import { PortfolioModelService } from "./portfolioModelService";

const service = new PortfolioModelService();
const seed = createSeedOverview();
const recommendations = service.getRecommendations(seed.portfolio);

assert.equal(recommendations.length, 8);
assert.ok(recommendations.some((item) => item.id === "three_fund"));
assert.ok(recommendations.some((item) => item.id === "dividend_income"));
assert.ok(recommendations.some((item) => item.id === "factor_portfolio"));
assert.ok(recommendations.some((item) => item.id === "risk_parity"));
assert.ok(recommendations.some((item) => item.id === "tactical_allocation"));

const coreSatellite = service.compareModel(seed.portfolio, "core_satellite");
assert.equal(coreSatellite.level, "intermediate");
assert.ok(coreSatellite.targetAllocation.some((item) => item.symbol === "WATCHLIST"));
assert.ok(coreSatellite.riskNotes.some((note) => /Satellite/.test(note)));

const sixtyForty = service.compareModel(seed.portfolio, "sixty_forty");
assert.ok(sixtyForty.turnoverEstimate > 0);
assert.ok(sixtyForty.targetAllocation.every((item) => Number.isFinite(item.estimatedTradeValue)));

const riskParity = service.compareModel(seed.portfolio, "risk_parity");
assert.ok(riskParity.targetAllocation.some((item) => item.symbol === "TIP"));
assert.ok(riskParity.riskNotes.some((note) => /correlation assumptions/.test(note)));

const tactical = service.compareModel(seed.portfolio, "tactical_allocation");
assert.ok(tactical.suitabilityGates.some((gate) => /Backtest review/.test(gate)));
assert.ok(tactical.targetAllocation.some((item) => item.symbol === "TACTICAL"));

console.log("portfolioModelService smoke tests passed");
