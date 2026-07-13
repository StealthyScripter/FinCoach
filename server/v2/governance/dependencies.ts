import { type V2ModuleName, v2Modules } from "../contracts/events";

const allowedDependencies = v2Modules.reduce((rules, module) => {
  rules[module] = ["contracts", "lineage", "telemetry", "governance"];
  return rules;
}, {} as Record<V2ModuleName, readonly V2ModuleName[]>);

allowedDependencies["contracts"] = [];
allowedDependencies["lineage"] = ["contracts"];
allowedDependencies["governance"] = ["contracts", "lineage"];
allowedDependencies["orchestration"] = v2Modules.filter((module) => module !== "orchestration");
allowedDependencies["signals"] = ["contracts", "lineage", "governance", "validation", "courtroom", "forward-testing", "telemetry"];
allowedDependencies["forward-testing"] = ["contracts", "lineage", "governance", "validation", "courtroom", "signals", "journal", "telemetry"];

export function assertV2ModuleDependency(caller: V2ModuleName, target: V2ModuleName) {
  if (caller === target) return true;
  if (!allowedDependencies[caller]?.includes(target)) {
    throw new Error(`V2 module dependency violation: ${caller} cannot depend on ${target}`);
  }
  return true;
}

export function getV2DependencyRules() {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(allowedDependencies).map(([module, dependencies]) => [module, Object.freeze([...dependencies])]),
    ),
  ) as Readonly<Record<V2ModuleName, readonly V2ModuleName[]>>;
}
