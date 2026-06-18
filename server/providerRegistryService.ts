import type { ProviderHealth, ProviderRegistrySnapshot } from "@shared/schema";

export class ProviderRegistryService {
  getSnapshot(now = new Date()): ProviderRegistrySnapshot {
    const checkedAt = now.toISOString();
    return {
      generatedAt: checkedAt,
      providers: [
        provider({
          id: "demo-market-data",
          name: "Demo Market Data Provider",
          kind: "market_data",
          capabilities: ["quotes", "historical_prices"],
          checkedAt,
        }),
        provider({
          id: "demo-economic-data",
          name: "Demo Economic Data Provider",
          kind: "economic_data",
          capabilities: ["economic_events"],
          checkedAt,
        }),
        provider({
          id: "demo-news",
          name: "Demo News Provider",
          kind: "news",
          capabilities: ["news"],
          checkedAt,
        }),
        provider({
          id: "demo-filings",
          name: "Demo Filing Data Provider",
          kind: "filings",
          capabilities: ["filings"],
          checkedAt,
        }),
        provider({
          id: "demo-options",
          name: "Demo Options Data Provider",
          kind: "options_data",
          capabilities: ["options_chain"],
          checkedAt,
        }),
        provider({
          id: "demo-broker",
          name: "MarketPilot Paper Broker Data Provider",
          kind: "broker_data",
          capabilities: ["broker_account", "broker_orders"],
          checkedAt,
        }),
      ],
    };
  }
}

export const providerRegistryService = new ProviderRegistryService();

function provider(input: Pick<ProviderHealth, "id" | "name" | "kind" | "capabilities" | "checkedAt">): ProviderHealth {
  return {
    ...input,
    status: "healthy",
    providerMode: "demo",
    freshness: {
      newestTimestamp: input.checkedAt,
      oldestTimestamp: input.checkedAt,
      stale: false,
    },
    confidence: 72,
    requiredActions: [
      "Replace demo provider with configured external adapter before production market decisions.",
    ],
  };
}
