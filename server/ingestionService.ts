import type { EconomicEvent, IngestionSnapshot, MarketPrice, NewsArticle } from "@shared/schema";
import { eventCalendarService } from "./eventCalendarService";
import {
  MockMarketDataProvider,
  MockNewsProvider,
  type MarketDataProvider,
  type NewsProvider,
} from "./marketProviders";

const trackedSymbols = ["SPY", "QQQ", "SGOV", "EURUSD"];

export class IngestionService {
  constructor(
    private readonly marketData: MarketDataProvider = new MockMarketDataProvider(),
    private readonly news: NewsProvider = new MockNewsProvider(),
  ) {}

  async getSnapshot(now = new Date()): Promise<IngestionSnapshot> {
    const generatedAt = now.toISOString();
    const [quotes, newsResults] = await Promise.all([
      Promise.all(trackedSymbols.map((symbol) => this.marketData.getQuote(symbol))),
      Promise.all(["SPY", "SGOV", "EURUSD"].map((symbol) => this.news.getRelevantNews(symbol))),
    ]);
    const marketPrices: MarketPrice[] = quotes.map((quote) => ({
      id: `price-${quote.symbol.toLowerCase()}`,
      symbol: quote.symbol,
      name: quote.name,
      price: quote.price,
      changePct: quote.changePct,
      volumeTrend: quote.volumeTrend,
      provider: "MarketPilot demo quote provider",
      observedAt: quote.timestamp,
      ingestedAt: generatedAt,
    }));
    const newsArticles: NewsArticle[] = newsResults.flat().map((item, index) => ({
      id: `news-${index + 1}`,
      headline: item.headline,
      source: item.source,
      reliability: item.reliability,
      sentiment: item.sentiment,
      relatedSymbols: item.relatedSymbols,
      publishedAt: item.timestamp,
      ingestedAt: generatedAt,
    }));
    const economicEvents: EconomicEvent[] = eventCalendarService.getUpcomingEvents().map((event) => ({
      id: event.id,
      title: event.title,
      category: event.category,
      impact: event.impact,
      startsAt: event.startsAt,
      relatedAssets: event.relatedAssets,
      source: "MarketPilot demo event calendar",
      riskNote: event.riskNote,
      ingestedAt: generatedAt,
    }));
    const timestamps = [
      ...marketPrices.map((item) => item.observedAt),
      ...newsArticles.map((item) => item.publishedAt),
      ...economicEvents.map((item) => item.startsAt),
    ].sort();
    const staleItems = [
      marketPrices.length === 0 ? "No market prices ingested" : null,
      newsArticles.length === 0 ? "No news articles ingested" : null,
      economicEvents.length === 0 ? "No economic events ingested" : null,
      ...marketPrices
        .filter((item) => minutesBetween(item.observedAt, generatedAt) > 15)
        .map((item) => `${item.symbol} quote is older than 15 minutes`),
    ].filter((item): item is string => Boolean(item));

    return {
      generatedAt,
      providerMode: "demo",
      marketPrices,
      economicEvents,
      newsArticles,
      freshness: {
        staleItems,
        newestTimestamp: timestamps.at(-1) ?? null,
        oldestTimestamp: timestamps[0] ?? null,
      },
      requiredActions: staleItems.length > 0
        ? ["Refresh ingestion snapshot before relying on research outputs", "Treat stale sources as partially verified"]
        : ["Use source timestamps when writing market explanations"],
    };
  }
}

export const ingestionService = new IngestionService();

function minutesBetween(leftIso: string, rightIso: string) {
  return Math.abs(new Date(rightIso).getTime() - new Date(leftIso).getTime()) / 60000;
}
