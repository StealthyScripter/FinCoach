import { createHash } from "crypto";
import { createEvent, type EventEnvelope, type EventReference } from "../core";
import type { Hypothesis } from "../hypothesis";
import { RuleBuilderEventTypes } from "./events";
import type { ObjectiveCondition, RuleFamily, RuleSet } from "./contracts";
import { RuleSetRepository } from "./repository";

export class RuleBuilderService {
  constructor(private readonly repository = new RuleSetRepository()) {}

  createFromHypothesis(hypothesisEvent: EventEnvelope) {
    const hypothesis = hypothesisEvent.payload as unknown as Hypothesis;
    if (!hypothesis.hypothesisId || hypothesis.status === "rejected") return this.reject(hypothesisEvent, "hypothesis_not_eligible");
    const family = familyFor(hypothesis.patternTypes.map(String));
    const ruleSet = buildRuleSet(hypothesis, family, 1, [referenceFrom(hypothesisEvent)]);
    validateObjective(ruleSet);
    this.repository.save(ruleSet);
    return createEvent({ type: RuleBuilderEventTypes.RuleSetCreated, module: "rule-builder", payload: ruleSet as unknown as Record<string, unknown>, sourceEventRefs: ruleSet.sourceHypothesisRefs });
  }

  version(ruleSet: RuleSet, changes: Partial<Pick<RuleSet, "entryCondition" | "exitCondition" | "stopLossRule" | "takeProfitRule">>, refs: EventReference[]) {
    const next: RuleSet = { ...JSON.parse(JSON.stringify(ruleSet)), ...changes, version: ruleSet.version + 1 };
    validateObjective(next);
    this.repository.save(next);
    return createEvent({ type: RuleBuilderEventTypes.RuleSetVersioned, module: "rule-builder", payload: next as unknown as Record<string, unknown>, sourceEventRefs: refs });
  }

  private reject(hypothesisEvent: EventEnvelope, reason: string) {
    return createEvent({ type: RuleBuilderEventTypes.RuleSetRejected, module: "rule-builder", payload: { reason }, sourceEventRefs: [referenceFrom(hypothesisEvent)] });
  }
}

function buildRuleSet(hypothesis: Hypothesis, family: RuleFamily, version: number, refs: EventReference[]): RuleSet {
  const ruleSetId = createHash("sha1").update(`${hypothesis.hypothesisId}|${family}`).digest("hex").slice(0, 16);
  return {
    ruleSetId,
    version,
    family,
    hypothesisId: hypothesis.hypothesisId,
    instrumentConstraints: [hypothesis.instrument],
    timeframeConstraints: [hypothesis.timeframe],
    entryCondition: conditionSet(["confirmedBreakoutDistanceAtr", ">", 0.2], ["closeAboveStructure", "==", true]),
    exitCondition: conditionSet(["barsInTrade", ">=", 12]),
    stopLossRule: conditionSet(["stopDistanceAtr", ">=", 0.8], ["stopDistanceAtr", "<=", 1.5]),
    takeProfitRule: conditionSet(["targetR", ">=", 1.5]),
    positionSizingAssumption: conditionSet(["riskPerTradePct", "<=", 0.25]),
    sessionFilter: conditionSet(["session", "!=", "off_hours"]),
    volatilityFilter: conditionSet(["volatilityState", "!=", "unknown"]),
    spreadFilter: conditionSet(["spreadState", "!=", "wide"]),
    regimeFilter: conditionSet(["regimeConfirmed", "==", true]),
    newsBlackoutFilter: conditionSet(["economicBlackout", "==", false]),
    sourceHypothesisRefs: refs,
  };
}

function conditionSet(...items: Array<[ObjectiveCondition["field"], ObjectiveCondition["operator"], ObjectiveCondition["value"]]>): ObjectiveCondition[] {
  return items.map(([field, operator, value]) => ({ field, operator, value }));
}

function familyFor(patternTypes: string[]): RuleFamily {
  if (patternTypes.includes("liquidity_sweep")) return "liquidity_sweep_reversal";
  if (patternTypes.includes("support_resistance_reaction")) return "support_resistance_reaction";
  if (patternTypes.includes("pullback")) return "ema_pullback_continuation";
  if (patternTypes.includes("volatility_compression")) return "volatility_compression_breakout";
  if (patternTypes.includes("volatility_expansion")) return "atr_expansion_breakout";
  return "london_breakout_after_asian_range";
}

export function validateObjective(ruleSet: RuleSet) {
  const buckets = [
    ruleSet.entryCondition,
    ruleSet.exitCondition,
    ruleSet.stopLossRule,
    ruleSet.takeProfitRule,
    ruleSet.positionSizingAssumption,
    ruleSet.sessionFilter,
    ruleSet.volatilityFilter,
    ruleSet.spreadFilter,
    ruleSet.regimeFilter,
    ruleSet.newsBlackoutFilter,
  ];
  for (const condition of buckets.flat()) {
    if (!condition.field || typeof condition.operator !== "string") throw new Error("Rule condition is not objective");
    if (typeof condition.value === "string" && /(good|bad|strong|weak|looks|seems|subjective)/i.test(condition.value)) throw new Error("Subjective rule value rejected");
  }
  return true;
}

function referenceFrom(event: EventEnvelope): EventReference {
  return { eventId: event.id, eventType: event.type, module: event.module, schemaVersion: event.schemaVersion, occurredAt: event.occurredAt };
}

export const ruleBuilderService = new RuleBuilderService();
