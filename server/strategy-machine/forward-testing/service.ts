import { randomUUID } from "crypto";
import { DemoOnlyPolicyService } from "../../execution/demoOnlyPolicy";
import { createEvent, type EventReference } from "../core";
import { ForwardTestingEventTypes } from "./events";
import type { DemoTrade, ForwardTest, ForwardTestMode } from "./contracts";
import { ForwardTestRepository } from "./repository";

export class ForwardTestService {
  constructor(
    private readonly repository = new ForwardTestRepository(),
    private readonly demoOnlyPolicy = new DemoOnlyPolicyService({ MARKETPILOT_DEMO_ONLY: "true" }),
  ) {}

  start(input: { experimentId: string; provider: string; accountMode: string; mode: ForwardTestMode; allowedInstruments: string[]; riskLimitPct: number; refs: EventReference[] }) {
    this.demoOnlyPolicy.assertAllowed({
      provider: input.provider,
      accountMode: input.accountMode,
      verificationSource: `${input.provider}.account_mode`,
      attemptedAction: "strategy-machine.forward-test.start",
      source: "strategy-machine.forward-testing",
    });
    const forwardTest: ForwardTest = {
      forwardTestId: randomUUID(),
      experimentId: input.experimentId,
      mode: input.mode,
      provider: input.provider,
      accountMode: input.accountMode,
      state: "running",
      allowedInstruments: input.allowedInstruments,
      riskLimitPct: input.riskLimitPct,
      openedTradeRefs: [],
      closedTradeRefs: [],
    };
    this.repository.saveForwardTest(forwardTest);
    return createEvent({ type: ForwardTestingEventTypes.ForwardTestStarted, module: "forward-testing", payload: forwardTest as unknown as Record<string, unknown>, sourceEventRefs: input.refs });
  }

  openDemoTrade(forwardTestId: string, input: { instrument: string; side: DemoTrade["side"]; quantity: number; refs: EventReference[]; now?: Date }) {
    const forwardTest = this.require(forwardTestId);
    this.demoOnlyPolicy.assertAllowed({
      provider: forwardTest.provider,
      accountMode: forwardTest.accountMode,
      verificationSource: `${forwardTest.provider}.account_mode`,
      attemptedAction: "strategy-machine.demo-trade.open",
      source: "strategy-machine.forward-testing",
      metadata: { instrument: input.instrument, quantity: input.quantity },
    });
    if (!forwardTest.allowedInstruments.includes(input.instrument)) throw new Error(`Instrument not allowed for forward test: ${input.instrument}`);
    if (input.quantity <= 0 || input.quantity > 1_000) throw new Error("Demo trade quantity exceeds risk controls");
    const trade: DemoTrade = {
      tradeId: randomUUID(),
      forwardTestId,
      instrument: input.instrument,
      side: input.side,
      quantity: input.quantity,
      openedAt: (input.now ?? new Date()).toISOString(),
      closedAt: null,
      demoOnly: true,
    };
    this.repository.saveTrade(trade);
    const event = createEvent({ type: ForwardTestingEventTypes.DemoTradeOpened, module: "forward-testing", payload: trade as unknown as Record<string, unknown>, sourceEventRefs: input.refs });
    forwardTest.openedTradeRefs.push(referenceFrom(event));
    this.repository.saveForwardTest(forwardTest);
    return event;
  }

  pause(forwardTestId: string, refs: EventReference[]) {
    const forwardTest = this.require(forwardTestId);
    forwardTest.state = "paused";
    this.repository.saveForwardTest(forwardTest);
    return createEvent({ type: ForwardTestingEventTypes.ForwardTestPaused, module: "forward-testing", payload: forwardTest as unknown as Record<string, unknown>, sourceEventRefs: refs });
  }

  complete(forwardTestId: string, refs: EventReference[]) {
    const forwardTest = this.require(forwardTestId);
    forwardTest.state = "completed";
    this.repository.saveForwardTest(forwardTest);
    return createEvent({ type: ForwardTestingEventTypes.ForwardTestCompleted, module: "forward-testing", payload: forwardTest as unknown as Record<string, unknown>, sourceEventRefs: refs });
  }

  private require(id: string) {
    const forwardTest = this.repository.getForwardTest(id);
    if (!forwardTest) throw new Error(`Forward test not found: ${id}`);
    return forwardTest;
  }
}

function referenceFrom(event: { id: string; type: string; module: EventReference["module"]; schemaVersion: string; occurredAt: string }): EventReference {
  return { eventId: event.id, eventType: event.type, module: event.module, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt };
}

export const forwardTestService = new ForwardTestService();
