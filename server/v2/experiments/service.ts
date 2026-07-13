import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { ExperimentInput, ResearchExperiment } from "./contracts";
import { ExperimentsV2EventTypes } from "./events";
import { experimentFingerprint } from "./fingerprint";
import { InMemoryExperimentRepository } from "./repository";

export class ExperimentsV2Service {
  constructor(private readonly repo = new InMemoryExperimentRepository()) {}
  create(input: ExperimentInput): { experiment: ResearchExperiment; events: DomainEvent[] } {
    validate(input);
    const fingerprint = experimentFingerprint(input);
    const experiment: ResearchExperiment = { ...input, experimentId: createHash("sha256").update(fingerprint).digest("hex").slice(0,32), schemaVersion: "fincoach.v2.experiment.1", status: "queued", attempt: 0, fingerprint, createdAt: input.createdAt ?? new Date().toISOString() };
    const saved = this.repo.save(experiment);
    if (!saved.inserted && saved.existing) return { experiment: saved.existing, events: [createDomainEvent({ eventType: ExperimentsV2EventTypes.ExperimentDuplicateSuppressed, sourceModule: "experiments", correlationId: input.correlationId, causationId: input.causationId, payload: { experimentId: saved.existing.experimentId } })] };
    return { experiment, events: [createDomainEvent({ eventType: ExperimentsV2EventTypes.ExperimentCreated, sourceModule: "experiments", correlationId: input.correlationId, causationId: input.causationId, payload: { experimentId: experiment.experimentId } }), createDomainEvent({ eventType: ExperimentsV2EventTypes.ExperimentQueued, sourceModule: "experiments", correlationId: input.correlationId, causationId: input.causationId, payload: { experimentId: experiment.experimentId } })] };
  }
  lease(workerId: string, now = new Date(), ttlMs = 60_000) {
    const exp = this.repo.list().find((e) => e.status === "queued" || (e.status === "leased" && e.leaseExpiresAt && Date.parse(e.leaseExpiresAt) <= now.getTime()));
    if (!exp) return null;
    const leased: ResearchExperiment = { ...exp, status: "leased", leaseOwner: workerId, leaseExpiresAt: new Date(now.getTime()+ttlMs).toISOString(), attempt: exp.attempt + 1 };
    this.repo.update(leased); return leased;
  }
  cancel(id: string) { const exp = this.require(id); const cancelled = { ...exp, status: "cancelled" as const }; this.repo.update(cancelled); return cancelled; }
  list() { return this.repo.list(); }
  get(id: string) { return this.repo.get(id); }
  private require(id: string) { const exp = this.repo.get(id); if (!exp) throw new Error("experiment not found"); return exp; }
}
function validate(input: ExperimentInput) { if (!input.holdoutPolicy.finalHoldoutLocked) throw new Error("final holdout must be locked"); if (input.datasetSpecification.end >= input.holdoutPolicy.testStart) throw new Error("holdout leakage"); if (Object.keys(input.parameterSpecification.grid ?? {}).length > 8) throw new Error("too many tunable parameters"); if (input.resourceBudget.maxCandles <= 0 || input.resourceBudget.maxRuntimeMs <= 0) throw new Error("invalid budget"); }
export const experimentsV2Service = new ExperimentsV2Service();
