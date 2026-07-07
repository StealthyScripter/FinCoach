import { DemoOnlyPolicyService } from "../../execution/demoOnlyPolicy";
import { createEvent } from "../core";
import { DemoExecutionEventTypes } from "./events";
import type { DemoExecutionDecision, DemoExecutionRequest } from "./contracts";
import { DemoExecutionRepository } from "./repository";

export class DemoExecutionService {
  constructor(
    private readonly repository = new DemoExecutionRepository(),
    private readonly policy = new DemoOnlyPolicyService({ MARKETPILOT_DEMO_ONLY: "true" }),
  ) {}

  decide(request: DemoExecutionRequest) {
    const policyResult = this.policy.check({
      provider: request.provider,
      accountMode: request.accountMode,
      verificationSource: request.verificationSource,
      attemptedAction: request.attemptedAction,
      source: "strategy-machine.demo-execution",
    });
    const blockedByKillSwitch = request.killSwitchActive;
    const decision: DemoExecutionDecision = {
      allowed: policyResult.allowed && !blockedByKillSwitch,
      blocked: policyResult.blocked || blockedByKillSwitch,
      reason: blockedByKillSwitch ? "Kill switch active; execution is blocked." : policyResult.reason,
      confirmationIgnored: request.confirmationReceived && (policyResult.blocked || blockedByKillSwitch),
      killSwitchActive: request.killSwitchActive,
      demoOnly: true,
    };
    this.repository.save(decision);
    return createEvent({ type: decision.allowed ? DemoExecutionEventTypes.DemoExecutionAllowed : DemoExecutionEventTypes.DemoExecutionBlocked, module: "demo-execution", payload: decision as unknown as Record<string, unknown>, sourceEventRefs: request.sourceEventRefs });
  }
}

export const demoExecutionService = new DemoExecutionService();
