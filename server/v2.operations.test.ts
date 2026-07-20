import assert from "node:assert/strict";
import { TelegramCommandRouter } from "./telegram/commandRouter";
import { V2OperationsEventTypes, V2OperationsService, registerV2OperationsRoutes } from "./v2/operations";

const operations = new V2OperationsService();

const status = operations.status({ correlationId: "00000000-0000-4000-8000-000000000024" });
assert.equal(status.body.schemaVersion, "fincoach.v2.operations-status.1");
assert.equal(status.body.liveExecutionBlocked, true);
assert.equal(status.body.killSwitchState, "inactive");
assert.equal(status.events[0].eventType, V2OperationsEventTypes.V2OperationsResponseCreated);

const lessons = operations.list("lessons", { limit: 1, offset: 0, correlationId: status.body.correlationId });
assert.equal(lessons.body.items.length, 0);
assert.equal(lessons.body.availability, "not_configured");
assert.equal(lessons.body.pagination.limit, 1);
assert.equal(lessons.body.schemaVersion, "fincoach.v2.operations-list.1");

const invalid = operations.list("signals", { limit: 500, offset: 0, correlationId: status.body.correlationId });
assert.equal(invalid.status, 400);
assert.equal(invalid.events[0].eventType, V2OperationsEventTypes.V2OperationsRequestRejected);

const report = operations.dailyReport({ reportDate: "2026-01-08", correlationId: status.body.correlationId });
const duplicate = operations.dailyReport({ reportDate: "2026-01-08", correlationId: status.body.correlationId });
assert.equal(report.body.status, "created");
assert.equal(duplicate.body.status, "existing");
assert.equal(report.events[0].eventType, V2OperationsEventTypes.V2DailyReportCreated);
assert.equal(duplicate.body.report.reportId, report.body.report.reportId);
assert.equal(report.body.report.liveExecutionBlocked, true);

const delivered = operations.recordDailyReportDelivery(report.body.report.reportId, { sent: true, correlationId: status.body.correlationId });
const failed = operations.recordDailyReportDelivery(report.body.report.reportId, { sent: false, error: "telegram outage", correlationId: status.body.correlationId });
assert.equal(delivered.events[0].eventType, V2OperationsEventTypes.V2DailyReportDelivered);
assert.equal(failed.events[0].eventType, V2OperationsEventTypes.V2DailyReportDeliveryFailed);

const app = { routes: [] as string[], get(path: string) { this.routes.push(path); } };
registerV2OperationsRoutes(app as never, operations);
assert.deepEqual(app.routes, [
  "/api/v2/status",
  "/api/v2/metrics",
  "/api/v2/runtime/status",
  "/api/v2/observations",
  "/api/v2/hypotheses",
  "/api/v2/experiments",
  "/api/v2/backtests",
  "/api/v2/court-cases",
  "/api/v2/strategies",
  "/api/v2/forward-tests",
  "/api/v2/signals",
  "/api/v2/evaluations",
  "/api/v2/journal",
  "/api/v2/lessons",
  "/api/v2/models",
  "/api/v2/lifecycle",
  "/api/v2/orchestration",
]);

const telegram = new TelegramCommandRouter({ TELEGRAM_ALLOWED_USER_ID: "operator" } as NodeJS.ProcessEnv);
assert.match(await telegram.handle({ command: "/v2_status", actorId: "operator", chatId: "chat" }), /V2 Status/);
assert.match(await telegram.handle({ command: "/lessons", actorId: "operator", chatId: "chat" }), /lessons/);
assert.match(await telegram.handle({ command: "/v2_status", actorId: "intruder", chatId: "chat" }), /unauthorized/);
assert.match(await telegram.handle({ command: "/enable_live", actorId: "operator", chatId: "chat" }), /demo-only/);
assert.equal("rankStrategies" in operations || "placeOrder" in operations || "sendTelegram" in operations, false);

console.log("v2 phase 24 operations tests passed");
