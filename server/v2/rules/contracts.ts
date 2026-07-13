export type RuleOperator = "==" | "!=" | ">" | ">=" | "<" | "<=" | "in";
export type RuleExpression = { field: string; operator: RuleOperator; value: string | number | boolean | string[] };
export type ExitRule = { type: "atr_multiple" | "price_level" | "time"; value: number | string };
export type PositionSizingRule = { type: "fixed_fractional"; riskFraction: number };
export type CostModelReference = { costModelId: string; version: string };
export type FeatureReference = { featureId: string; version: string };
export type StrategyDefinition = {
  strategyId: string; strategyVersion: number; schemaVersion: "fincoach.v2.strategy.1"; hypothesisId: string; name: string;
  assetClasses: string[]; symbols: string[]; timeframes: string[]; entryConditions: RuleExpression[]; filters: RuleExpression[];
  sidePolicy: { candidateSide: "buy" | "sell" | "both" }; stopLoss: ExitRule; takeProfit: ExitRule; timeExit: ExitRule | null;
  invalidationRules: RuleExpression[]; positionSizing: PositionSizingRule; costModel: CostModelReference; sessionRestrictions: RuleExpression[];
  eventRestrictions: RuleExpression[]; supportedRegimes: string[]; requiredFeatureDefinitions: FeatureReference[]; complexityScore: number;
  fingerprint: string; createdAt: string; correlationId: string; causationId: string | null;
};
export type CompileStrategyInput = Omit<StrategyDefinition, "strategyId" | "strategyVersion" | "schemaVersion" | "complexityScore" | "fingerprint" | "createdAt"> & { createdAt?: string };
