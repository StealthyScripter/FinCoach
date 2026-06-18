import assert from "node:assert/strict";
import { createSeedOverview } from "./storage";
import { SimulationService } from "./simulationService";

const seed = createSeedOverview();
const service = new SimulationService();
const rateShock = service.runScenario(seed.portfolio, seed.riskRules, "2022_rate_shock");

assert.equal(rateShock.scenario, "2022_rate_shock");
assert.ok(rateShock.estimatedDrawdownPct < 0);
assert.equal(rateShock.largestRiskContributor, "VTI");
assert.ok(rateShock.notes.some((note) => /Stocks and bonds/.test(note)));

const covidShock = service.runScenario(seed.portfolio, seed.riskRules, "2020_covid_crash");
assert.ok(covidShock.estimatedRecoveryMonths < rateShock.estimatedRecoveryMonths);

console.log("simulationService smoke tests passed");
