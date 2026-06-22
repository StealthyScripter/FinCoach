import assert from "node:assert/strict";
import { eventLogService } from "./eventLogService";
import { executionAuditLog } from "./execution/riskControls";
import { otelTraceService } from "./otelTraceService";

eventLogService.clearForTest();
executionAuditLog.clearForTest();

eventLogService.append({
  type: "risk.check_completed",
  userId: "trace-user",
  sourceService: "risk-service",
  correlationId: "trace-otel",
  payload: { approved: true },
  createdAt: "2026-01-15T14:00:00.000Z",
});
executionAuditLog.append({
  action: "risk.check",
  outcome: "accepted",
  correlationId: "trace-otel",
  detail: { approved: true },
});

const exportReport = await otelTraceService.build("trace-otel");

assert.equal(exportReport.correlationId, "trace-otel");
assert.equal(exportReport.spanCount, 2);
assert.equal(exportReport.traceId.length, 32);
assert.ok(exportReport.spans.every((span) => span.traceId === exportReport.traceId));
assert.ok(exportReport.spans.every((span) => span.status === "ok"));
assert.equal(exportReport.spans[0].parentSpanId, null);
assert.ok(exportReport.spans[1].parentSpanId);

console.log("otelTraceService smoke tests passed");
