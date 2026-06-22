import assert from "node:assert/strict";
import type { MetricsSnapshot } from "@shared/schema";
import { renderPrometheusMetrics } from "./metricsService";

const snapshot: MetricsSnapshot = {
  generatedAt: "2026-01-15T14:00:00.000Z",
  uptimeSeconds: 123,
  storageMode: "memory",
  requestCount: 7,
  rateLimitCount: 2,
  supervisorWorkflowCount: 4,
  verificationPassCount: 9,
  verificationFailCount: 3,
  riskApprovalCount: 5,
  riskRejectionCount: 1,
  paperTradeCount: 8,
  evaluationBenchmarkCount: 6,
  averageVerificationScore: 88,
  averageHallucinationRiskScore: 12,
  eventLogCount: 42,
};

const exposition = renderPrometheusMetrics(snapshot);

assert.ok(exposition.endsWith("\n"));
assert.ok(exposition.includes('# TYPE marketpilot_storage_mode_info gauge'));
assert.ok(exposition.includes('marketpilot_storage_mode_info{mode="memory"} 1'));
assert.ok(exposition.includes("marketpilot_request_count_total 7"));
assert.ok(exposition.includes("marketpilot_rate_limit_count_total 2"));
assert.ok(exposition.includes("marketpilot_average_verification_score 88"));
assert.ok(exposition.includes("marketpilot_event_log_count_total 42"));

console.log("metricsService prometheus export tests passed");
