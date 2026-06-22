import assert from "node:assert/strict";
import { marketSessionRulesService } from "./marketSessionRules";

const equityOpen = marketSessionRulesService.evaluate({
  assetClass: "equity",
  now: new Date("2026-06-17T14:00:00.000Z"),
  accountEquity: 100_000,
  currentMarginUsed: 10_000,
  projectedMarginUsed: 20_000,
  positionHeldOvernight: false,
  financingAcknowledged: true,
});
assert.equal(equityOpen.allowed, true);
assert.equal(equityOpen.marketHoursOpen, true);

const holidayClosed = marketSessionRulesService.evaluate({
  assetClass: "commodity",
  now: new Date("2026-07-04T14:00:00.000Z"),
  accountEquity: 100_000,
  currentMarginUsed: 10_000,
  projectedMarginUsed: 20_000,
  positionHeldOvernight: false,
  financingAcknowledged: true,
});
assert.equal(holidayClosed.allowed, false);
assert.equal(holidayClosed.holiday, true);
assert.ok(holidayClosed.requiredActions.some((item) => /holiday/i.test(item)));

const rolloverBlocked = marketSessionRulesService.evaluate({
  assetClass: "forex",
  now: new Date("2026-06-19T21:30:00.000Z"),
  accountEquity: 100_000,
  currentMarginUsed: 10_000,
  projectedMarginUsed: 20_000,
  positionHeldOvernight: true,
  financingAcknowledged: false,
});
assert.equal(rolloverBlocked.allowed, false);
assert.equal(rolloverBlocked.rolloverWindowActive, true);
assert.equal(rolloverBlocked.financingRequired, true);

const marginAlert = marketSessionRulesService.evaluate({
  assetClass: "forex",
  now: new Date("2026-06-17T14:00:00.000Z"),
  accountEquity: 100_000,
  currentMarginUsed: 70_000,
  projectedMarginUsed: 85_000,
  positionHeldOvernight: false,
  financingAcknowledged: true,
});
assert.equal(marginAlert.allowed, false);
assert.equal(marginAlert.phase, "margin_alert");
assert.ok(marginAlert.requiredActions.some((item) => /reduce size/i.test(item)));

const liquidationAlert = marketSessionRulesService.evaluate({
  assetClass: "forex",
  now: new Date("2026-06-17T14:00:00.000Z"),
  accountEquity: 100_000,
  currentMarginUsed: 90_000,
  projectedMarginUsed: 97_000,
  positionHeldOvernight: false,
  financingAcknowledged: true,
});
assert.equal(liquidationAlert.allowed, false);
assert.equal(liquidationAlert.phase, "liquidation_alert");
assert.ok(liquidationAlert.requiredActions.some((item) => /liquidation/i.test(item)));

console.log("marketSessionRules smoke tests passed");
