import assert from "node:assert/strict";
import { publicProviderAdapters } from "./publicProviderAdapters";

const providers = Object.values(publicProviderAdapters);
assert.equal(providers.length, 4);
assert.ok(providers.every((provider) => provider.health().capabilities.length > 0));

const bar = await publicProviderAdapters.market.getDailyBar("SPY");
assert.equal(bar.symbol, "SPY");
assert.ok(bar.close > 0);

const observation = await publicProviderAdapters.fred.getObservation("DGS10");
assert.equal(observation.seriesId, "DGS10");

const filing = await publicProviderAdapters.sec.getLatestFiling("AAPL");
assert.equal(filing.symbol, "AAPL");

const event = await publicProviderAdapters.calendar.getNextEvent();
assert.equal(event.impact, "high");

console.log("publicProviderAdapters smoke tests passed");
