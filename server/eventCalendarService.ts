export type MarketEvent = {
  id: string;
  title: string;
  category: "macro" | "earnings" | "central_bank" | "liquidity";
  impact: "low" | "medium" | "high";
  startsAt: string;
  relatedAssets: string[];
  riskNote: string;
};

export class EventCalendarService {
  getUpcomingEvents(now = new Date()): MarketEvent[] {
    const base = now.getTime();
    return [
      {
        id: "event-cpi",
        title: "US CPI inflation release",
        category: "macro",
        impact: "high",
        startsAt: new Date(base + 24 * 60 * 60 * 1000).toISOString(),
        relatedAssets: ["SPY", "QQQ", "VTI", "BND", "TLT", "EURUSD", "DXY"],
        riskNote: "Inflation surprises can move yields, equities, bonds, the dollar, and implied volatility.",
      },
      {
        id: "event-fomc-minutes",
        title: "FOMC minutes",
        category: "central_bank",
        impact: "medium",
        startsAt: new Date(base + 72 * 60 * 60 * 1000).toISOString(),
        relatedAssets: ["SPY", "QQQ", "VTI", "BND", "SGOV", "DXY"],
        riskNote: "Policy language can change rate-cut expectations and duration risk.",
      },
      {
        id: "event-quad-witching",
        title: "Quarterly options expiration",
        category: "liquidity",
        impact: "medium",
        startsAt: new Date(base + 5 * 24 * 60 * 60 * 1000).toISOString(),
        relatedAssets: ["SPY", "QQQ", "VTI"],
        riskNote: "Index options expiration can raise intraday volatility and liquidity noise.",
      },
    ];
  }

  getRelevantEvents(asset: string, now = new Date()): MarketEvent[] {
    const normalized = normalizeAsset(asset);
    return this.getUpcomingEvents(now).filter((event) =>
      event.relatedAssets.some((related) => normalizeAsset(related) === normalized),
    );
  }

  getBlockingEvents(asset: string, now = new Date(), windowHours = 48): MarketEvent[] {
    const cutoff = now.getTime() + windowHours * 60 * 60 * 1000;
    return this.getRelevantEvents(asset, now).filter((event) => {
      const eventTime = new Date(event.startsAt).getTime();
      return event.impact === "high" && eventTime >= now.getTime() && eventTime <= cutoff;
    });
  }
}

export const eventCalendarService = new EventCalendarService();

function normalizeAsset(asset: string) {
  return asset.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
