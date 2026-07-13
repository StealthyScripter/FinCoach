import { createDomainEvent, type DomainEvent } from "../contracts";
import type { TraderAnalysisInput, TraderAnalysisPackage } from "./contracts";
import { TraderEmulatorV2EventTypes } from "./events";
import { analyzeWithPolicy } from "./profile";

export class TraderEmulatorsV2Service {
  analyze(input: TraderAnalysisInput): { analysis: TraderAnalysisPackage; events: DomainEvent[] } {
    const analysis = analyzeWithPolicy(input);
    const events: DomainEvent[] = [createDomainEvent({ eventType: TraderEmulatorV2EventTypes.TraderAnalysisCompleted, sourceModule: "trader-emulators", correlationId: input.correlationId, causationId: input.causationId, payload: { analysisId: analysis.analysisId, profile: analysis.profile, opportunityState: analysis.opportunityState } })];
    events.push(createDomainEvent({ eventType: analysis.opportunityState === "candidate" ? TraderEmulatorV2EventTypes.TraderOpportunityIdentified : TraderEmulatorV2EventTypes.TraderNoTradeDecision, sourceModule: "trader-emulators", correlationId: input.correlationId, causationId: events[0].eventId, payload: { analysisId: analysis.analysisId, profile: analysis.profile } }));
    for (const risk of analysis.risks) events.push(createDomainEvent({ eventType: TraderEmulatorV2EventTypes.TraderRiskConcernRaised, sourceModule: "trader-emulators", correlationId: input.correlationId, causationId: events[0].eventId, payload: { analysisId: analysis.analysisId, riskId: risk.riskId } }));
    return { analysis, events };
  }
}
export const traderEmulatorsV2Service = new TraderEmulatorsV2Service();
