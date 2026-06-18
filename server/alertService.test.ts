import assert from "node:assert/strict";
import { alertSchema } from "@shared/schema";
import { AlertService } from "./alertService";
import { EventCalendarService } from "./eventCalendarService";
import { createSeedOverview } from "./storage";

const now = new Date("2026-06-15T12:00:00.000Z");
const overview = createSeedOverview();
const eventService = new EventCalendarService();
const alerts = new AlertService().evaluateAlerts({
  overview,
  events: eventService.getUpcomingEvents(now),
  now,
});

assert.ok(alerts.length >= 4);
for (const alert of alerts) {
  assert.doesNotThrow(() => alertSchema.parse(alert));
  assert.equal(alert.status, "active");
  assert.ok(alert.requiredActions.length > 0);
}

const eventAlert = alerts.find((alert) => alert.category === "event_risk");
assert.equal(eventAlert?.severity, "critical");
assert.ok(eventAlert?.relatedAssets.includes("VTI"));

const riskAlert = alerts.find((alert) => alert.id === "alert-risk-blocked-tickets");
assert.equal(riskAlert?.severity, "critical");
assert.match(riskAlert?.message ?? "", /risk-rejected/);

const optionsAlert = alerts.find((alert) => alert.id === "alert-options-gate");
assert.equal(optionsAlert?.category, "proficiency_gate");
assert.equal(optionsAlert?.severity, "warning");

const concentrationAlert = alerts.find((alert) => alert.category === "portfolio_drift");
assert.match(concentrationAlert?.message ?? "", /42\.0%/);

console.log("alertService smoke tests passed");
