import type { EventReference } from "../core";

export type RuleFamily =
  | "london_breakout_after_asian_range"
  | "volatility_compression_breakout"
  | "ema_pullback_continuation"
  | "support_resistance_reaction"
  | "liquidity_sweep_reversal"
  | "atr_expansion_breakout";

export type ObjectiveCondition = {
  field: string;
  operator: ">" | ">=" | "<" | "<=" | "==" | "!=" | "between";
  value: number | string | boolean | [number, number];
};

export type RuleSet = {
  ruleSetId: string;
  version: number;
  family: RuleFamily;
  hypothesisId: string;
  instrumentConstraints: string[];
  timeframeConstraints: string[];
  entryCondition: ObjectiveCondition[];
  exitCondition: ObjectiveCondition[];
  stopLossRule: ObjectiveCondition[];
  takeProfitRule: ObjectiveCondition[];
  positionSizingAssumption: ObjectiveCondition[];
  sessionFilter: ObjectiveCondition[];
  volatilityFilter: ObjectiveCondition[];
  spreadFilter: ObjectiveCondition[];
  regimeFilter: ObjectiveCondition[];
  newsBlackoutFilter: ObjectiveCondition[];
  sourceHypothesisRefs: EventReference[];
};
