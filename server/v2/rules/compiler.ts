import { createHash } from "crypto";
import { createDomainEvent, type DomainEvent } from "../contracts";
import type { CompileStrategyInput, RuleExpression, StrategyDefinition } from "./contracts";
import { RulesV2EventTypes } from "./events";
import { validateStrategyInput } from "./validator";

export class RulesV2Compiler {
  compile(input: CompileStrategyInput): { strategy: StrategyDefinition | null; events: DomainEvent[] } {
    try { validateStrategyInput(input); } catch (error) {
      return { strategy: null, events: [createDomainEvent({ eventType: RulesV2EventTypes.RuleSetRejected, sourceModule: "rules", correlationId: input.correlationId, causationId: input.causationId, payload: { reason: error instanceof Error ? error.message : "unknown" } })] };
    }
    const fingerprint = strategyFingerprint(input);
    const strategy: StrategyDefinition = { ...input, strategyId: createHash("sha256").update(fingerprint).digest("hex").slice(0, 32), strategyVersion: 1, schemaVersion: "fincoach.v2.strategy.1", complexityScore: complexity(input), fingerprint, createdAt: input.createdAt ?? new Date().toISOString() };
    return { strategy, events: [
      createDomainEvent({ eventType: RulesV2EventTypes.RuleSetCompiled, sourceModule: "rules", correlationId: input.correlationId, causationId: input.causationId, payload: { strategyId: strategy.strategyId, fingerprint } }),
      createDomainEvent({ eventType: RulesV2EventTypes.StrategyDefinitionCreated, sourceModule: "rules", correlationId: input.correlationId, causationId: input.causationId, payload: { strategyId: strategy.strategyId, strategyVersion: 1 } }),
    ] };
  }
}
export function strategyFingerprint(input: CompileStrategyInput) { return createHash("sha256").update(JSON.stringify({ ...input, entryConditions: canon(input.entryConditions), filters: canon(input.filters), invalidationRules: canon(input.invalidationRules) })).digest("hex"); }
function canon(rules: RuleExpression[]) { return [...rules].sort((a,b)=>`${a.field}${a.operator}${JSON.stringify(a.value)}`.localeCompare(`${b.field}${b.operator}${JSON.stringify(b.value)}`)); }
function complexity(input: CompileStrategyInput) { return input.entryConditions.length + input.filters.length + input.invalidationRules.length + input.requiredFeatureDefinitions.length; }
export const rulesV2Compiler = new RulesV2Compiler();
