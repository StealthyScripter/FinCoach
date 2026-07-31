import type { ForwardTestRecord, ForwardTestStatus } from "../forward-testing/contracts";

export type SignalEligibilityResult = {
  eligible: boolean;
  reason: "eligible_monitoring_forward_test" | "eligible_completed_forward_test" | "forward_test_status_ineligible" | "unknown_forward_test_status" | "demo_verification_failed" | "stale_market_snapshot" | "missing_lineage" | "forward_test_expired" | "forward_test_superseded";
};

const knownForwardTestStatuses = new Set<ForwardTestStatus>(["blocked", "monitoring", "completed", "failed", "cancelled"]);

export function evaluateSignalEligibility(forwardTest: ForwardTestRecord, context: { now?: Date } = {}): SignalEligibilityResult {
  const optionalState = forwardTest as ForwardTestRecord & { expiresAt?: string | null; supersedesId?: string | null };
  if (optionalState.supersedesId) return { eligible: false, reason: "forward_test_superseded" };
  if (optionalState.expiresAt && Date.parse(optionalState.expiresAt) <= (context.now ?? new Date()).getTime()) return { eligible: false, reason: "forward_test_expired" };
  if (!knownForwardTestStatuses.has(forwardTest.status)) return { eligible: false, reason: "unknown_forward_test_status" };
  if (forwardTest.status !== "monitoring" && forwardTest.status !== "completed") return { eligible: false, reason: "forward_test_status_ineligible" };
  if (!forwardTest.demoVerification.demoOnly || forwardTest.demoVerification.accountMode !== forwardTest.demoVerification.environment) return { eligible: false, reason: "demo_verification_failed" };
  if (!forwardTest.snapshot.fresh) return { eligible: false, reason: "stale_market_snapshot" };
  if (!forwardTest.lineageEventIds.length || !forwardTest.snapshot.lineageEventIds.length) return { eligible: false, reason: "missing_lineage" };
  return { eligible: true, reason: forwardTest.status === "completed" ? "eligible_completed_forward_test" : "eligible_monitoring_forward_test" };
}
