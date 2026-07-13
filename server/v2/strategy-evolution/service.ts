import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { EvolvedStrategyRevisionProposal, StrategyEvolutionErrorCode, StrategyEvolutionHealth, StrategyEvolutionRequest } from "./contracts";
import { StrategyEvolutionV2EventTypes } from "./events";
import { InMemoryStrategyEvolutionRepository } from "./repository";

type EvolutionResult = { proposal: EvolvedStrategyRevisionProposal | null; events: DomainEvent[] };

export class StrategyEvolutionV2Service {
  private readonly repository: InMemoryStrategyEvolutionRepository;

  constructor(repositoryOrSeed: InMemoryStrategyEvolutionRepository | readonly EvolvedStrategyRevisionProposal[] = new InMemoryStrategyEvolutionRepository()) {
    this.repository = repositoryOrSeed instanceof InMemoryStrategyEvolutionRepository ? repositoryOrSeed : new InMemoryStrategyEvolutionRepository(repositoryOrSeed);
  }

  propose(request: StrategyEvolutionRequest): EvolutionResult {
    const rejected = validate(request);
    if (rejected) return { proposal: null, events: [createDomainEvent({ eventType: StrategyEvolutionV2EventTypes.StrategyRevisionRejected, sourceModule: "strategy-evolution", correlationId: request.correlationId, causationId: request.causationId, payload: { reason: rejected, proposalId: request.proposalId } })] };
    const parent = request.parent!;
    const childHash = createHash("sha256").update(JSON.stringify({ parent: parent.strategyId, version: parent.strategyVersion, mutations: request.mutations, rules: request.ruleChanges })).digest("hex").slice(0, 8);
    const proposal: EvolvedStrategyRevisionProposal = {
      proposalId: request.proposalId,
      schemaVersion: "fincoach.v2.strategy-revision.1",
      parentStrategyId: parent.strategyId,
      parentStrategyVersion: parent.strategyVersion,
      childStrategyId: `${parent.strategyId}-child-${childHash}`,
      mutations: request.mutations,
      ruleChanges: request.ruleChanges,
      status: "proposed",
      evidenceIds: [...request.evidenceIds],
      createdAt: request.createdAt,
      lineageEventIds: [...new Set([...parent.lineageEventIds, ...request.evidenceIds])],
      correlationId: request.correlationId,
      causationId: request.causationId,
    };
    const saved = this.repository.save(proposal);
    return { proposal: saved.proposal, events: [createDomainEvent({ eventType: saved.inserted ? StrategyEvolutionV2EventTypes.StrategyRevisionProposed : StrategyEvolutionV2EventTypes.StrategyRevisionDuplicateSuppressed, sourceModule: "strategy-evolution", correlationId: request.correlationId, causationId: request.causationId, payload: { proposalId: saved.proposal.proposalId, childStrategyId: saved.proposal.childStrategyId } })] };
  }

  repositorySnapshot() {
    return this.repository.snapshot();
  }

  health(checkedAt = new Date().toISOString()): StrategyEvolutionHealth {
    return { module: "strategy-evolution", status: "healthy", schemaVersion: "fincoach.v2.strategy-revision.1", checkedAt, proposalCount: this.repository.list().length };
  }
}

function validate(request: StrategyEvolutionRequest): StrategyEvolutionErrorCode | null {
  if (!request.parent) return "missing_parent";
  if (!request.evidenceIds.length) return "missing_evidence";
  if (!request.mutations.length && !request.ruleChanges.length) return "missing_mutation";
  if (!request.parent.lineageEventIds.length) return "missing_lineage";
  for (const change of request.ruleChanges) if (!request.parent.approvedRuleChanges.includes(change)) return "unauthorized_rule_change";
  for (const mutation of request.mutations) {
    if (request.parent.parameters[mutation.parameter] !== mutation.from) return "invalid_parent_value";
    const bound = request.parent.allowedBounds[mutation.parameter];
    if (typeof mutation.to === "number" && bound && (mutation.to < bound.min || mutation.to > bound.max)) return "mutation_out_of_bounds";
  }
  return null;
}

export const strategyEvolutionV2Service = new StrategyEvolutionV2Service();
