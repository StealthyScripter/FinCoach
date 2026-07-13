import type { CompileStrategyInput, RuleExpression } from "./contracts";
const operators = new Set(["==", "!=", ">", ">=", "<", "<=", "in"]);
export function validateStrategyInput(input: CompileStrategyInput) {
  const rules = [...input.entryConditions, ...input.filters, ...input.invalidationRules, ...input.sessionRestrictions, ...input.eventRestrictions];
  if (!input.stopLoss) throw new Error("missing stop loss");
  if (!input.takeProfit) throw new Error("missing take profit");
  if (!input.invalidationRules.length) throw new Error("missing invalidation");
  if (!input.positionSizing || input.positionSizing.riskFraction <= 0 || input.positionSizing.riskFraction > 0.05) throw new Error("invalid position sizing");
  if (!input.costModel?.costModelId) throw new Error("missing cost model");
  for (const rule of rules) {
    if (!operators.has(rule.operator)) throw new Error(`unknown operator: ${rule.operator}`);
    if (typeof rule.value === "string" && /\b(strong|weak|looks|should|maybe)\b/i.test(rule.value)) throw new Error("subjective natural language rejected");
    if (!rule.field || /\s/.test(rule.field)) throw new Error("invalid feature field");
  }
  detectContradictions(rules);
}
function detectContradictions(rules: RuleExpression[]) {
  for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
    const a = rules[i], b = rules[j];
    if (a.field === b.field && a.operator === "==" && b.operator === "==" && a.value !== b.value) throw new Error("contradictory rules");
  }
}
