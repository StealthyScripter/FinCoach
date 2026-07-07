import type { RuleSet } from "./contracts";

export class RuleSetRepository {
  private readonly ruleSets = new Map<string, RuleSet[]>();

  save(ruleSet: RuleSet) {
    const versions = this.ruleSets.get(ruleSet.ruleSetId) ?? [];
    versions.push(clone(ruleSet));
    this.ruleSets.set(ruleSet.ruleSetId, versions);
    return ruleSet;
  }

  versions(ruleSetId: string) {
    return (this.ruleSets.get(ruleSetId) ?? []).map(clone);
  }
}

function clone(ruleSet: RuleSet): RuleSet {
  return JSON.parse(JSON.stringify(ruleSet)) as RuleSet;
}
