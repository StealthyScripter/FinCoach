import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { DemoResearchPilotConfig, DemoResearchPilotRecord, DemoResearchPilotReport, DemoResearchPilotScorecard, DemoResearchPilotStartupGates } from "./contracts";
import { DemoResearchPilotV2EventTypes } from "./events";
import { InMemoryDemoResearchPilotRepository } from "./repository";

const emptyScorecard: DemoResearchPilotScorecard = {
  observationsGenerated: 0,
  hypothesesCreated: 0,
  hypothesesRejected: 0,
  experimentsQueued: 0,
  experimentsCompleted: 0,
  backtestsCompleted: 0,
  candidatesRejectedForOverfitting: 0,
  candidatesRejectedForLeakage: 0,
  courtroomVerdicts: 0,
  rankedCandidates: 0,
  lifecycleTransitions: 0,
  forwardTests: 0,
  signalsPublished: 0,
  externalEvaluations: 0,
  evaluatorDisagreements: 0,
  netR: 0,
  winRate: 0,
  expectancy: 0,
  drawdown: 0,
  costSensitivity: 0,
  calibration: 0,
  edgeDecay: 0,
  lessonsCreated: 0,
  strategyRevisionsProposed: 0,
  strategiesPaused: 0,
  strategiesDegraded: 0,
  strategiesRetired: 0,
  operationalFailures: 0,
  deadLetterEvents: 0,
  researchThroughput: 0,
  estimatedCostPerValidatedStrategy: 0,
};

export class DemoResearchPilotV2Service {
  private readonly repository: InMemoryDemoResearchPilotRepository;

  constructor(repositoryOrSeed: InMemoryDemoResearchPilotRepository | readonly DemoResearchPilotRecord[] = new InMemoryDemoResearchPilotRepository()) {
    this.repository = repositoryOrSeed instanceof InMemoryDemoResearchPilotRepository ? repositoryOrSeed : new InMemoryDemoResearchPilotRepository(repositoryOrSeed);
  }

  request(input: { config: DemoResearchPilotConfig; gates: DemoResearchPilotStartupGates; correlationId: string }) {
    const blocked = startupBlockReason(input.config, input.gates);
    if (blocked || this.repository.get(input.config.pilotId)) return this.block(input.correlationId, input.config.pilotId, blocked ?? "duplicate_pilot");
    const record = this.repository.save({
      pilotId: input.config.pilotId,
      schemaVersion: "fincoach.v2.demo-research-pilot.1",
      state: "running",
      config: input.config,
      scorecard: emptyScorecard,
      lineageEventIds: [],
      startedAt: input.config.pilotStartTime,
      stoppedAt: null,
      updatedAt: input.config.pilotStartTime,
    });
    return { pilot: record, events: [this.event(DemoResearchPilotV2EventTypes.DemoResearchPilotStarted, input.correlationId, { pilotId: record.pilotId })] };
  }

  updateScorecard(pilotId: string, scorecard: DemoResearchPilotScorecard, lineageEventIds: readonly string[], correlationId: string) {
    const pilot = this.repository.get(pilotId);
    if (!pilot) return { pilot: null, events: [this.event(DemoResearchPilotV2EventTypes.DemoResearchPilotFailed, correlationId, { pilotId, reason: "pilot_not_found" })] };
    const updated = this.repository.save({ ...pilot, scorecard, lineageEventIds: [...new Set([...pilot.lineageEventIds, ...lineageEventIds])].sort(), updatedAt: new Date().toISOString() });
    return { pilot: updated, events: [this.event(DemoResearchPilotV2EventTypes.DemoResearchPilotScorecardUpdated, correlationId, { pilotId })] };
  }

  pause(pilotId: string, reason: string, correlationId: string) {
    return this.transition(pilotId, "paused", DemoResearchPilotV2EventTypes.DemoResearchPilotPaused, correlationId, { reason });
  }

  resume(pilotId: string, correlationId: string) {
    return this.transition(pilotId, "running", DemoResearchPilotV2EventTypes.DemoResearchPilotResumed, correlationId, {});
  }

  safeStop(pilotId: string, reason: string, correlationId: string) {
    const pilot = this.repository.get(pilotId);
    if (!pilot) return { pilot: null, events: [this.event(DemoResearchPilotV2EventTypes.DemoResearchPilotFailed, correlationId, { pilotId, reason: "pilot_not_found" })] };
    const stopped = this.repository.save({ ...pilot, state: "stopped", stoppedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return { pilot: stopped, events: [this.event(DemoResearchPilotV2EventTypes.DemoResearchPilotStopped, correlationId, { pilotId, reason, liveExecutionBlocked: true })] };
  }

  publishSignalAllowed(pilotId: string) {
    const pilot = this.repository.get(pilotId);
    return Boolean(pilot && pilot.state === "running" && pilot.config.signalPublicationPolicy === "research_only");
  }

  report(pilotId: string, correlationId: string): { report: DemoResearchPilotReport | null; events: DomainEvent[] } {
    const pilot = this.repository.get(pilotId);
    if (!pilot) return { report: null, events: [this.event(DemoResearchPilotV2EventTypes.DemoResearchPilotFailed, correlationId, { pilotId, reason: "pilot_not_found" })] };
    const started = pilot.startedAt ? Date.parse(pilot.startedAt) : Date.now();
    const ended = pilot.stoppedAt ? Date.parse(pilot.stoppedAt) : Date.now();
    const report: DemoResearchPilotReport = {
      reportId: createHash("sha256").update(`${pilotId}:${pilot.updatedAt}`).digest("hex").slice(0, 32),
      schemaVersion: "fincoach.v2.demo-research-pilot-report.1",
      pilotId,
      state: pilot.state,
      config: pilot.config,
      scorecard: pilot.scorecard,
      durationMinutes: Math.max(0, Math.round((ended - started) / 60_000)),
      safetyState: { liveExecutionBlocked: true, externalPracticeTradesEnabled: false, historicalReplayNotForwardTesting: true },
      lineageEventIds: pilot.lineageEventIds,
      knownLimitations: ["in-memory repository", "external practice trades disabled by default"],
      createdAt: new Date().toISOString(),
      liveExecutionBlocked: true,
    };
    return { report, events: [this.event(DemoResearchPilotV2EventTypes.DemoResearchPilotReportCreated, correlationId, { pilotId, reportId: report.reportId })] };
  }

  repositorySnapshot() {
    return this.repository.snapshot();
  }

  private transition(pilotId: string, state: DemoResearchPilotRecord["state"], eventType: string, correlationId: string, payload: Record<string, unknown>) {
    const pilot = this.repository.get(pilotId);
    if (!pilot) return { pilot: null, events: [this.event(DemoResearchPilotV2EventTypes.DemoResearchPilotFailed, correlationId, { pilotId, reason: "pilot_not_found" })] };
    const updated = this.repository.save({ ...pilot, state, updatedAt: new Date().toISOString() });
    return { pilot: updated, events: [this.event(eventType, correlationId, { pilotId, ...payload })] };
  }

  private block(correlationId: string, pilotId: string, reason: string) {
    return { pilot: null, events: [this.event(DemoResearchPilotV2EventTypes.DemoResearchPilotStartupBlocked, correlationId, { pilotId, reason })] };
  }

  private event(eventType: string, correlationId: string, payload: Record<string, unknown>) {
    return createDomainEvent({ eventType, sourceModule: "governance", correlationId, payload });
  }
}

function startupBlockReason(config: DemoResearchPilotConfig, gates: DemoResearchPilotStartupGates) {
  if (!gates.v2Enabled) return "v2_disabled";
  if (!gates.researchEnabled) return "research_disabled";
  if (!gates.liveExecutionBlocked) return "live_execution_not_blocked";
  if (!gates.killSwitchHealthy) return "kill_switch_unhealthy";
  if (!gates.postgresqlStateKnown) return "postgresql_unknown";
  if (!gates.repositoriesHealthy) return "repositories_unhealthy";
  if (!gates.orchestrationHealthy) return "orchestration_unhealthy";
  if (gates.unresolvedCriticalDeadLetters > config.healthThresholds.maxDeadLetters) return "critical_dead_letters";
  if (gates.brokerMode === "unknown" || gates.brokerMode === "live") return "unsafe_broker_mode";
  if (gates.seededPromotedStrategies > 0) return "seeded_promoted_strategies";
  if (!gates.featureSchemaCompatible) return "feature_schema_incompatible";
  if (!gates.migrationStateValid) return "migration_state_invalid";
  if (!gates.providersHealthyOrExplicitlyDegraded) return "providers_unhealthy";
  if (config.externalPracticeTradesEnabled !== false) return "external_practice_trade_enabled";
  return null;
}
