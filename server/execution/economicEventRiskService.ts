import { randomUUID } from "crypto";
import { eventLogService, type EventLogService } from "../eventLogService";
import { normalizeSymbol } from "./domain";
import { executionAuditLog, type ExecutionAuditLog } from "./riskControls";

export type EconomicEventType = "CPI" | "NFP" | "FOMC" | "central_bank_rate_decision" | "crude_oil_inventories" | "major_geopolitical_risk";
export type EconomicEventSeverity = "low" | "medium" | "high" | "critical";

export type EconomicRiskEvent = {
  id: string;
  type: EconomicEventType;
  title: string;
  startsAt: string;
  endsAt: string;
  severity: EconomicEventSeverity;
  symbols: string[];
  assetClasses: Array<"forex" | "commodity">;
  notes: string;
  enabled: boolean;
};

export type EventRiskSettings = {
  enabled: boolean;
  blockSeverities: EconomicEventSeverity[];
  warnSeverities: EconomicEventSeverity[];
  minutesBefore: number;
  minutesAfter: number;
};

export class EconomicEventRiskService {
  private events = new Map<string, EconomicRiskEvent>();

  constructor(
    private readonly eventLog: EventLogService = eventLogService,
    private readonly audit: ExecutionAuditLog = executionAuditLog,
  ) {}

  configure(input: Omit<EconomicRiskEvent, "id"> & { id?: string }) {
    const event = { ...input, id: input.id ?? randomUUID() };
    if (Date.parse(event.endsAt) < Date.parse(event.startsAt)) throw new Error("Economic event end must follow start");
    this.events.set(event.id, event);
    return { ...event };
  }

  list() {
    return Array.from(this.events.values()).map((event) => ({ ...event, symbols: [...event.symbols], assetClasses: [...event.assetClasses] }));
  }

  evaluate(symbol: string, settings: EventRiskSettings, now = new Date()) {
    const instrument = normalizeSymbol(symbol);
    if (!instrument || !settings.enabled) return this.result("allow", [], symbol, now);
    const matches = this.list().filter((event) => {
      if (!event.enabled) return false;
      const start = Date.parse(event.startsAt) - settings.minutesBefore * 60_000;
      const end = Date.parse(event.endsAt) + settings.minutesAfter * 60_000;
      const relevant = event.symbols.some((item) => normalizeSymbol(item)?.symbol === instrument.symbol)
        || event.assetClasses.includes(instrument.assetClass);
      return relevant && now.getTime() >= start && now.getTime() <= end;
    });
    const block = matches.some((event) => settings.blockSeverities.includes(event.severity));
    const warn = matches.some((event) => settings.warnSeverities.includes(event.severity));
    return this.result(block ? "block" : warn ? "warn" : "allow", matches, instrument.symbol, now);
  }

  private result(action: "allow" | "warn" | "block", events: EconomicRiskEvent[], symbol: string, now: Date) {
    const correlationId = randomUUID();
    const result = {
      action,
      blocked: action === "block",
      warning: action === "warn",
      symbol,
      events,
      reasons: events.map((event) => `${event.severity} ${event.title}`),
      evaluatedAt: now.toISOString(),
    };
    this.eventLog.append({
      type: "event_blackout.evaluated",
      userId: "system",
      sourceService: "economic-event-risk",
      correlationId,
      payload: { symbol, action, eventIds: events.map((event) => event.id) },
      createdAt: now.toISOString(),
    });
    this.audit.append({
      action: "event.blackout.evaluate",
      outcome: action === "block" ? "blocked" : "accepted",
      correlationId,
      detail: { symbol, action, eventIds: events.map((event) => event.id) },
    });
    return result;
  }
}

export const DEFAULT_EVENT_RISK_SETTINGS: EventRiskSettings = {
  enabled: true,
  blockSeverities: ["high", "critical"],
  warnSeverities: ["medium"],
  minutesBefore: 30,
  minutesAfter: 30,
};

export const economicEventRiskService = new EconomicEventRiskService();
