export const HypothesisV2EventTypes = {
  HypothesisCreated: "HypothesisCreated",
  HypothesisRejected: "HypothesisRejected",
  HypothesisInsufficientEvidence: "HypothesisInsufficientEvidence",
  HypothesisDuplicateDetected: "HypothesisDuplicateDetected",
  HypothesisSuperseded: "HypothesisSuperseded",
  HypothesisReadyForRuleCompilation: "HypothesisReadyForRuleCompilation",
  HypothesisCandidateEvaluated: "hypothesis_candidate_evaluated",
  HypothesisCreatedStructured: "hypothesis_created",
  HypothesisInsufficientIndependentOccurrences: "hypothesis_insufficient_independent_occurrences",
  HypothesisRejectedDuplicateEvidence: "hypothesis_rejected_duplicate_evidence",
  HypothesisRejectedIncompleteLineage: "hypothesis_rejected_incomplete_lineage",
  HypothesisRejectedExpiredEvidence: "hypothesis_rejected_expired_evidence",
} as const;
