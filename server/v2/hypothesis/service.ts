import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { HypothesisGenerationInput, ResearchHypothesis } from "./contracts";
import { hypothesisFingerprint } from "./deduplication";
import { dataMiningRisk, validateHypothesisInput } from "./evidencePolicy";
import { HypothesisV2EventTypes } from "./events";
import { InMemoryHypothesisRepository } from "./repository";

export class HypothesisV2Service {
  constructor(private readonly repository = new InMemoryHypothesisRepository()) {}
  generate(input: HypothesisGenerationInput): { hypothesis: ResearchHypothesis | null; events: DomainEvent[] } {
    try {
      validateHypothesisInput(input);
    } catch (error) {
      const type = String(error instanceof Error ? error.message : error).includes("insufficient") ? HypothesisV2EventTypes.HypothesisInsufficientEvidence : HypothesisV2EventTypes.HypothesisRejected;
      return { hypothesis: null, events: [createDomainEvent({ eventType: type, sourceModule: "hypothesis", correlationId: input.correlationId, causationId: input.causationId, payload: { reason: error instanceof Error ? error.message : "unknown" } })] };
    }
    const fingerprint = hypothesisFingerprint(input);
    const hypothesis: ResearchHypothesis = {
      ...input,
      hypothesisId: createHash("sha256").update(fingerprint).digest("hex").slice(0, 32),
      schemaVersion: "fincoach.v2.hypothesis.1",
      confidence: Number(Math.min(1, Math.max(0, input.evidenceEventIds.length / Math.max(1, input.minimumSampleSize))).toFixed(4)),
      dataMiningRisk: dataMiningRisk(input.conditions.length),
      status: "ready_for_rules",
      createdAt: input.createdAt ?? new Date().toISOString(),
      fingerprint,
    };
    const saved = this.repository.save(hypothesis);
    if (!saved.inserted && saved.existing) return { hypothesis: saved.existing, events: [createDomainEvent({ eventType: HypothesisV2EventTypes.HypothesisDuplicateDetected, sourceModule: "hypothesis", correlationId: input.correlationId, causationId: input.causationId, payload: { hypothesisId: saved.existing.hypothesisId } })] };
    return { hypothesis, events: [
      createDomainEvent({ eventType: HypothesisV2EventTypes.HypothesisCreated, sourceModule: "hypothesis", correlationId: input.correlationId, causationId: input.causationId, payload: { hypothesisId: hypothesis.hypothesisId, fingerprint } }),
      createDomainEvent({ eventType: HypothesisV2EventTypes.HypothesisReadyForRuleCompilation, sourceModule: "hypothesis", correlationId: input.correlationId, causationId: input.causationId, payload: { hypothesisId: hypothesis.hypothesisId } }),
    ] };
  }
  list() { return this.repository.list(); }
  get(id: string) { return this.repository.get(id); }
}
export const hypothesisV2Service = new HypothesisV2Service();
