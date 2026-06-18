import { normalizeSymbol } from "./domain";

export type ForexSizingInput = {
  symbol: "EUR/USD" | "GBP/USD" | "USD/JPY" | "XAU/USD" | "XAG/USD";
  accountBalance: number;
  accountCurrency: string;
  riskPerTradePct: number;
  entryPrice: number;
  stopPrice: number;
  maxLeverage: number;
  accountCurrencyConversionRate?: number;
};

export type CommoditySizingInput = {
  symbol: "XAU/USD" | "XAG/USD" | "WTI" | "Brent";
  accountBalance: number;
  riskPerTradePct: number;
  entryPrice: number;
  stopPrice: number;
  maxLeverage: number;
  volatilityMultiplier?: number;
  maxRiskCap?: number;
};

export class ForexPositionSizingEngine {
  calculate(input: ForexSizingInput) {
    const instrument = normalizeSymbol(input.symbol);
    if (!instrument) throw new Error("Unsupported forex sizing instrument");
    validateCommon(input);
    const conversionRate = input.accountCurrencyConversionRate ?? 1;
    const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
    const stopDistancePips = stopDistance / instrument.pipSize;
    const pipValuePerStandardLot = input.symbol === "USD/JPY"
      ? instrument.pipSize * instrument.lotSize / input.entryPrice * conversionRate
      : instrument.pipSize * instrument.lotSize * conversionRate;
    const riskBudget = input.accountBalance * input.riskPerTradePct / 100;
    const suggestedLots = riskBudget / (stopDistancePips * pipValuePerStandardLot);
    const maxLotsByLeverage = input.accountBalance * input.maxLeverage / (input.entryPrice * instrument.lotSize);
    const maxLotsByMargin = input.accountBalance / (input.entryPrice * instrument.lotSize * instrument.marginRequirement);
    const maxSafePositionSize = Math.max(0, Math.min(maxLotsByLeverage, maxLotsByMargin));
    const lots = Math.max(0, Math.min(suggestedLots, maxSafePositionSize));
    const units = lots * instrument.lotSize;
    return {
      symbol: instrument.symbol,
      accountCurrency: input.accountCurrency,
      accountCurrencyConversion: input.accountCurrency === instrument.quoteCurrency ? "not_required" : "placeholder_rate_applied",
      accountCurrencyConversionRate: conversionRate,
      pipValuePerStandardLot: round(pipValuePerStandardLot),
      lotSize: instrument.lotSize,
      riskPerTrade: round(riskBudget),
      stopDistance: round(stopDistance),
      stopDistancePips: round(stopDistancePips),
      maxLeverage: input.maxLeverage,
      marginEstimate: round(units * input.entryPrice * instrument.marginRequirement),
      suggestedPositionSize: { lots: round(suggestedLots), units: round(suggestedLots * instrument.lotSize) },
      maxSafePositionSize: { lots: round(maxSafePositionSize), units: round(maxSafePositionSize * instrument.lotSize) },
      finalPositionSize: { lots: round(lots), units: round(units) },
    };
  }
}

export class CommodityPositionSizingEngine {
  calculate(input: CommoditySizingInput) {
    const instrument = normalizeSymbol(input.symbol);
    if (!instrument || instrument.assetClass !== "commodity") throw new Error("Unsupported commodity sizing instrument");
    validateCommon(input);
    const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
    const stopTicks = stopDistance / instrument.tickSize;
    const tickValue = instrument.tickSize * instrument.lotSize;
    const uncappedRiskBudget = input.accountBalance * input.riskPerTradePct / 100;
    const riskBudget = Math.min(uncappedRiskBudget, input.maxRiskCap ?? uncappedRiskBudget);
    const volatilityMultiplier = Math.max(0.1, Math.min(1, input.volatilityMultiplier ?? 1));
    const suggestedContracts = riskBudget / (stopTicks * tickValue) * volatilityMultiplier;
    const maxContractsByLeverage = input.accountBalance * input.maxLeverage / (input.entryPrice * instrument.lotSize);
    const maxContractsByMargin = input.accountBalance / (input.entryPrice * instrument.lotSize * instrument.marginRequirement);
    const maxSafeContracts = Math.max(0, Math.min(maxContractsByLeverage, maxContractsByMargin));
    const contracts = Math.max(0, Math.min(suggestedContracts, maxSafeContracts));
    return {
      symbol: instrument.symbol,
      tickSize: instrument.tickSize,
      tickValue: round(tickValue),
      contractMultiplier: instrument.lotSize,
      stopDistance: round(stopDistance),
      stopTicks: round(stopTicks),
      riskPerTrade: round(riskBudget),
      maxRiskCap: round(input.maxRiskCap ?? uncappedRiskBudget),
      volatilityAdjustment: volatilityMultiplier,
      marginEstimate: round(contracts * input.entryPrice * instrument.lotSize * instrument.marginRequirement),
      suggestedPositionSize: round(suggestedContracts),
      maxSafePositionSize: round(maxSafeContracts),
      finalPositionSize: round(contracts),
    };
  }
}

function validateCommon(input: { accountBalance: number; riskPerTradePct: number; entryPrice: number; stopPrice: number; maxLeverage: number }) {
  if (input.accountBalance <= 0 || input.riskPerTradePct <= 0 || input.riskPerTradePct > 5) throw new Error("Invalid account risk inputs");
  if (input.entryPrice <= 0 || input.stopPrice <= 0 || input.entryPrice === input.stopPrice) throw new Error("Stop distance must be positive");
  if (input.maxLeverage <= 0 || input.maxLeverage > 50) throw new Error("Invalid leverage limit");
}

function round(value: number) {
  return Number(value.toFixed(4));
}

export const forexPositionSizingEngine = new ForexPositionSizingEngine();
export const commodityPositionSizingEngine = new CommodityPositionSizingEngine();
