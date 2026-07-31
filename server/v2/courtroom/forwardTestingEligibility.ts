import type { CourtVerdict } from "./contracts";

export type ForwardTestVerdictEligibility = {
  eligible: boolean;
  normalizedVerdict: "approve_for_forward_test" | null;
  reason: "approved_for_forward_test" | "historical_replay_approval_compatible" | "court_not_approved_for_forward_test" | "unknown_court_verdict";
};

const knownVerdicts = new Set<CourtVerdict>(["reject", "revise", "watch", "approve_for_replay", "approve_for_forward_test"]);

export function forwardTestVerdictEligibility(verdict: unknown): ForwardTestVerdictEligibility {
  if (verdict === "approve_for_forward_test") return { eligible: true, normalizedVerdict: "approve_for_forward_test", reason: "approved_for_forward_test" };
  if (verdict === "approve_for_replay") return { eligible: true, normalizedVerdict: "approve_for_forward_test", reason: "historical_replay_approval_compatible" };
  if (typeof verdict === "string" && !knownVerdicts.has(verdict as CourtVerdict)) return { eligible: false, normalizedVerdict: null, reason: "unknown_court_verdict" };
  return { eligible: false, normalizedVerdict: null, reason: "court_not_approved_for_forward_test" };
}

export function isForwardTestEligibleVerdict(verdict: unknown) {
  return forwardTestVerdictEligibility(verdict).eligible;
}
