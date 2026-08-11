import { formatInTimezone } from "./runtime/weeklyResearchWindow";
import { resolveResearchInstrument } from "./researchUniverse";

export type FxResearchSessionId =
  | "sydney_open"
  | "sydney_tokyo"
  | "tokyo"
  | "late_asia"
  | "frankfurt_london_open"
  | "london_morning"
  | "london_new_york_overlap"
  | "new_york_open"
  | "new_york_afternoon"
  | "new_york_close_sydney_transition";

export type FxResearchSessionPhase = {
  sessionId: FxResearchSessionId;
  label: string;
  openedAt: string;
  closesAt: string;
  active: boolean;
  currenciesEmphasized: string[];
  compatibleConfiguredSymbols: string[];
  prioritySymbols: string[];
  liquidityExpectation: "high" | "medium" | "low";
  sessionQuality: "partial";
  source: "built_in_fx_liquidity_phase_model";
  note: string;
};

type PhaseDefinition = {
  sessionId: FxResearchSessionId;
  label: string;
  startHourUtc: number;
  endHourUtc: number;
  currenciesEmphasized: string[];
  prioritySymbols: string[];
  liquidityExpectation: "high" | "medium" | "low";
};

export const FX_RESEARCH_SESSION_PHASES: PhaseDefinition[] = [
  { sessionId: "sydney_open", label: "Sydney open", startHourUtc: 21, endHourUtc: 22, currenciesEmphasized: ["AUD", "NZD", "JPY"], prioritySymbols: ["AUD_USD", "NZD_USD", "AUD_NZD", "AUD_JPY", "NZD_JPY"], liquidityExpectation: "medium" },
  { sessionId: "sydney_tokyo", label: "Sydney -> Tokyo", startHourUtc: 22, endHourUtc: 0, currenciesEmphasized: ["AUD", "NZD", "JPY", "USD"], prioritySymbols: ["AUD_JPY", "NZD_JPY", "USD_JPY", "AUD_USD", "NZD_USD"], liquidityExpectation: "medium" },
  { sessionId: "tokyo", label: "Tokyo", startHourUtc: 0, endHourUtc: 3, currenciesEmphasized: ["JPY", "USD", "AUD", "NZD"], prioritySymbols: ["USD_JPY", "EUR_JPY", "GBP_JPY", "AUD_JPY", "NZD_JPY", "AUD_NZD"], liquidityExpectation: "high" },
  { sessionId: "late_asia", label: "Late Asia", startHourUtc: 3, endHourUtc: 7, currenciesEmphasized: ["JPY", "AUD", "EUR", "USD"], prioritySymbols: ["USD_JPY", "AUD_JPY", "EUR_JPY", "EUR_USD"], liquidityExpectation: "medium" },
  { sessionId: "frankfurt_london_open", label: "Frankfurt/London open", startHourUtc: 7, endHourUtc: 8, currenciesEmphasized: ["EUR", "GBP", "CHF", "JPY", "USD"], prioritySymbols: ["EUR_USD", "GBP_USD", "EUR_GBP", "GBP_JPY", "EUR_JPY", "USD_CHF"], liquidityExpectation: "high" },
  { sessionId: "london_morning", label: "London morning", startHourUtc: 8, endHourUtc: 12, currenciesEmphasized: ["EUR", "GBP", "CHF", "JPY", "USD"], prioritySymbols: ["EUR_USD", "GBP_USD", "GBP_JPY", "EUR_JPY", "EUR_GBP", "USD_CHF"], liquidityExpectation: "high" },
  { sessionId: "london_new_york_overlap", label: "London -> New York overlap", startHourUtc: 12, endHourUtc: 15, currenciesEmphasized: ["USD", "EUR", "GBP", "CAD", "CHF", "JPY"], prioritySymbols: ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "GBP_JPY", "EUR_JPY"], liquidityExpectation: "high" },
  { sessionId: "new_york_open", label: "New York open", startHourUtc: 15, endHourUtc: 17, currenciesEmphasized: ["USD", "CAD", "EUR", "GBP", "JPY", "CHF"], prioritySymbols: ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF"], liquidityExpectation: "high" },
  { sessionId: "new_york_afternoon", label: "New York afternoon", startHourUtc: 17, endHourUtc: 20, currenciesEmphasized: ["USD", "CAD", "EUR", "GBP", "JPY"], prioritySymbols: ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD"], liquidityExpectation: "medium" },
  { sessionId: "new_york_close_sydney_transition", label: "New York close -> Sydney transition", startHourUtc: 20, endHourUtc: 21, currenciesEmphasized: ["USD", "AUD", "NZD", "JPY"], prioritySymbols: ["AUD_USD", "NZD_USD", "USD_JPY"], liquidityExpectation: "low" },
];

export function activeFxResearchSession(now = new Date(), configuredSymbols: string[] = []) {
  return fxResearchSessions(now, configuredSymbols).find((session) => session.active) ?? null;
}

export function fxResearchSessions(now = new Date(), configuredSymbols: string[] = []): FxResearchSessionPhase[] {
  return FX_RESEARCH_SESSION_PHASES.map((phase) => phaseState(phase, now, configuredSymbols));
}

export function compatibleFxSessionSymbols(sessionId: FxResearchSessionId, configuredSymbols: string[]) {
  const phase = FX_RESEARCH_SESSION_PHASES.find((item) => item.sessionId === sessionId);
  if (!phase) return [];
  const symbols: string[] = [];
  for (const configured of configuredSymbols) {
    const instrument = resolveResearchInstrument(configured);
    if (!instrument || instrument.assetClass !== "forex") continue;
    if (!phase.currenciesEmphasized.includes(instrument.baseCurrency) && !phase.currenciesEmphasized.includes(instrument.quoteCurrency)) continue;
    symbols.push(instrument.symbol);
  }
  return symbols.sort();
}

function phaseState(phase: PhaseDefinition, now: Date, configuredSymbols: string[]): FxResearchSessionPhase {
  const open = boundary(now, phase.startHourUtc, phase.startHourUtc > phase.endHourUtc && now.getUTCHours() < phase.endHourUtc ? -1 : 0);
  const close = boundary(now, phase.endHourUtc, phase.startHourUtc > phase.endHourUtc && now.getUTCHours() >= phase.startHourUtc ? 1 : 0);
  const active = inWindow(now, phase.startHourUtc, phase.endHourUtc);
  const compatibleConfiguredSymbols = compatibleFxSessionSymbols(phase.sessionId, configuredSymbols);
  const priority = phase.prioritySymbols.filter((symbol) => compatibleConfiguredSymbols.includes(symbol));
  return {
    sessionId: phase.sessionId,
    label: phase.label,
    openedAt: open.toISOString(),
    closesAt: close.toISOString(),
    active,
    currenciesEmphasized: [...phase.currenciesEmphasized],
    compatibleConfiguredSymbols,
    prioritySymbols: priority,
    liquidityExpectation: phase.liquidityExpectation,
    sessionQuality: "partial",
    source: "built_in_fx_liquidity_phase_model",
    note: `Research-priority phase only; tradability is still controlled by FX 24/5 market-session rules. Local labels: London ${formatInTimezone(now, "Europe/London", false)}, New York ${formatInTimezone(now, "America/New_York", false)}, Sydney ${formatInTimezone(now, "Australia/Sydney", false)}, Tokyo ${formatInTimezone(now, "Asia/Tokyo", false)}.`,
  };
}

function inWindow(now: Date, startHourUtc: number, endHourUtc: number) {
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (startHourUtc < endHourUtc) return hour >= startHourUtc && hour < endHourUtc;
  return hour >= startHourUtc || hour < endHourUtc;
}

function boundary(now: Date, hourUtc: number, dayOffset: number) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hourUtc, 0, 0, 0));
}
