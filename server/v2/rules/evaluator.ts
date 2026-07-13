import type { RuleExpression } from "./contracts";
export function evaluateRule(rule: RuleExpression, facts: Record<string, unknown>) {
  const left = facts[rule.field];
  switch (rule.operator) {
    case "==": return left === rule.value;
    case "!=": return left !== rule.value;
    case ">": return Number(left) > Number(rule.value);
    case ">=": return Number(left) >= Number(rule.value);
    case "<": return Number(left) < Number(rule.value);
    case "<=": return Number(left) <= Number(rule.value);
    case "in": return Array.isArray(rule.value) && rule.value.includes(String(left));
    default: throw new Error("unknown operator");
  }
}
