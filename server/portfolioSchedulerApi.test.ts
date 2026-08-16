import assert from "node:assert/strict";
import { PortfolioScheduler } from "./portfolio/scheduler";
import type { PortfolioConfig } from "./portfolio/config";

const config: PortfolioConfig = {
  enabled: true,
  researchEnabled: true,
  autostart: true,
  liveExecutionEnabled: false,
  startingCapital: 100_000,
  maxActiveStrategies: 20,
  marketDataProvider: "none",
  alphaVantageApiKey: null,
  providerTimeoutMs: 1_000,
  providerCacheTtlMs: 1_000,
  quoteFreshnessMaxMinutes: 1440,
  fixtureAllowedInProduction: false,
  providerCallBudget: 10,
  rebalanceThresholdPct: 5,
};

let runs = 0;
const service = {
  async summaries() {
    runs += 1;
    return [];
  },
  async health() {
    return {} as never;
  },
};

const scheduler = new PortfolioScheduler(service, config, 60_000);
const first = scheduler.start();
assert.equal(first.started, true);
const second = scheduler.start();
assert.equal(second.started, false);
assert.equal(second.reason, "portfolio_scheduler_already_started");
await scheduler.stop("test");
await scheduler.runOnce("manual");
assert.ok(runs >= 1);
assert.equal(scheduler.status().lastError, null);

const disabled = new PortfolioScheduler(service, { ...config, enabled: false }, 60_000);
const disabledStart = disabled.start();
assert.equal(disabledStart.started, false);
assert.equal(disabledStart.reason, "portfolio_scheduler_disabled");

const failing = new PortfolioScheduler({
  async summaries() {
    throw new Error("provider down");
  },
  async health() {
    return {} as never;
  },
}, config, 60_000);
const failed = await failing.runOnce("manual");
assert.equal(failed.ok, false);
assert.equal(failing.status().lastError, "provider down");
