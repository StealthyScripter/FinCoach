import { INSTRUMENTS } from "../execution/domain";
import { marketSessionRulesService } from "../execution/marketSessionRules";
import { emitTelegramEvent } from "./events";
import { formatMarketSession } from "./formatter";
import { telegramNotificationService, type TelegramNotificationService } from "./notificationService";

type SessionState = {
  key: string;
  open: boolean;
  label: string;
  market: string;
  instruments: string[];
};

export class TelegramMarketSessionMonitor {
  private lastStates = new Map<string, boolean>();

  constructor(private readonly notifications: TelegramNotificationService = telegramNotificationService) {}

  async check(now = new Date()) {
    const states = this.sessionStates(now);
    const alerts = [];
    for (const state of states) {
      const prior = this.lastStates.get(state.key);
      this.lastStates.set(state.key, state.open);
      if (prior === undefined || prior === state.open) continue;
      const eventType = state.open ? "MarketSessionOpened" : "MarketSessionClosed";
      emitTelegramEvent(eventType, { market: state.market, session: state.label, opened: state.open, time: now.toISOString() });
      const sent = await this.notifications.sendOperations("market_session", formatMarketSession({
        opened: state.open,
        market: state.market,
        session: state.label,
        time: now.toISOString(),
        instruments: state.instruments,
        dataStatus: "freshness tracked",
      }));
      emitTelegramEvent("MarketSessionAlertSent", { market: state.market, session: state.label, opened: state.open, sent: sent.sent });
      alerts.push({ state, sent });
    }
    return alerts;
  }

  sessionStates(now = new Date()): SessionState[] {
    const base = { accountEquity: 100_000, currentMarginUsed: 0, projectedMarginUsed: 0, positionHeldOvernight: false, financingAcknowledged: false, now };
    const forex = marketSessionRulesService.evaluate({ ...base, assetClass: "forex" });
    const commodity = marketSessionRulesService.evaluate({ ...base, assetClass: "commodity" });
    const equity = marketSessionRulesService.evaluate({ ...base, assetClass: "equity" });
    const hourUtc = now.getUTCHours();
    return [
      { key: "forex-weekly", open: forex.marketHoursOpen, label: forex.marketHoursOpen ? "Weekly" : "Weekly close", market: "Forex", instruments: forexInstruments() },
      { key: "forex-asian", open: forex.marketHoursOpen && (hourUtc >= 22 || hourUtc < 7), label: "Asian", market: "Forex", instruments: forexInstruments() },
      { key: "forex-london", open: forex.marketHoursOpen && hourUtc >= 7 && hourUtc < 16, label: "London", market: "Forex", instruments: forexInstruments() },
      { key: "forex-new-york", open: forex.marketHoursOpen && hourUtc >= 12 && hourUtc < 21, label: "New York", market: "Forex", instruments: forexInstruments() },
      { key: "forex-overlap", open: forex.marketHoursOpen && hourUtc >= 12 && hourUtc < 16, label: "London/New York overlap", market: "Forex", instruments: forexInstruments() },
      { key: "metals", open: commodity.marketHoursOpen, label: commodity.marketHoursOpen ? "Provider session" : "Provider close", market: "Metals", instruments: ["XAU/USD", "XAG/USD"] },
      { key: "us-equity-regular", open: equity.marketHoursOpen, label: equity.marketHoursOpen ? "Regular market" : "Regular market close", market: "U.S. equities", instruments: ["Tracked stocks"] },
    ];
  }
}

function forexInstruments() {
  return INSTRUMENTS.filter((instrument) => instrument.assetClass === "forex").map((instrument) => instrument.symbol);
}

export const telegramMarketSessionMonitor = new TelegramMarketSessionMonitor();
