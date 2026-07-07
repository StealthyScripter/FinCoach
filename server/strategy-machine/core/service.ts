import { CoreEventTypes, createEvent, validateEventReferences } from "./events";
import { strategyMachineEventRepository, type InMemoryEventRepository } from "./repository";
import { strategyMachineModules, type ModuleRegistration, type StrategyMachineModule } from "./contracts";

const defaultRegistrations: ModuleRegistration[] = strategyMachineModules.map((name) => ({
  name,
  ownsTables: name === "core" ? ["strategy_machine_events"] : [],
  consumesEvents: [],
  emitsEvents: [],
  publicContracts: ["contracts.ts", "events.ts", "service.ts", "index.ts"],
}));

export class StrategyMachineCoreService {
  constructor(private readonly events: InMemoryEventRepository = strategyMachineEventRepository) {}

  registry() {
    return defaultRegistrations.map((registration) => ({ ...registration, ownsTables: [...registration.ownsTables] }));
  }

  eventCatalog() {
    return [
      CoreEventTypes.ModuleRegistered,
      CoreEventTypes.ContractViolationDetected,
      CoreEventTypes.ModuleErrorRaised,
      "MarketSnapshotCreated",
      "CandleSeriesCreated",
      "PatternDetected",
      "HypothesisCreated",
      "RuleSetCreated",
      "ExperimentCreated",
      "BacktestCompleted",
      "ExperimentValidated",
      "ForwardTestStarted",
      "TradeJournalCreated",
      "StrategyRanked",
      "RegimeClassified",
      "TelemetrySnapshotCreated",
      "LearningLoopCompleted",
    ];
  }

  registerModule(module: StrategyMachineModule) {
    const registration = this.registry().find((item) => item.name === module);
    if (!registration) throw new Error(`Unknown strategy-machine module: ${module}`);
    const event = createEvent({
      type: CoreEventTypes.ModuleRegistered,
      module: "core",
      payload: { module, registration },
    });
    return this.events.append(event);
  }

  assertBoundary(input: { caller: StrategyMachineModule; target: StrategyMachineModule; access: "contract" | "event" | "repository" | "internal" }) {
    if (input.caller !== input.target && (input.access === "repository" || input.access === "internal")) {
      const event = createEvent({
        type: CoreEventTypes.ContractViolationDetected,
        module: "core",
        payload: input,
      });
      this.events.append(event);
      throw new Error(`Module boundary violation: ${input.caller} cannot access ${input.target} ${input.access}`);
    }
    return true;
  }

  validateLineage(eventId: string) {
    const event = this.events.find(eventId);
    if (!event) throw new Error(`Event not found: ${eventId}`);
    return validateEventReferences(event.sourceEventRefs);
  }
}

export const strategyMachineCoreService = new StrategyMachineCoreService();
