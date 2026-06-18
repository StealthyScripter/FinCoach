import assert from "node:assert/strict";
import { portfolioRiskAnalyticsSchema } from "@shared/schema";
import type { PaperPortfolio } from "@shared/schema";
import { createSeedOverview } from "./storage";
import { PortfolioRiskAnalyticsService } from "./portfolioRiskAnalyticsService";

const service = new PortfolioRiskAnalyticsService();
const seed = createSeedOverview();
const generatedAt = new Date("2026-06-15T12:00:00.000Z");
const analytics = service.analyze(seed.portfolio, generatedAt);

portfolioRiskAnalyticsSchema.parse(analytics);
assert.equal(analytics.portfolioId, seed.portfolio.id);
assert.equal(analytics.generatedAt, generatedAt.toISOString());
assert.ok(analytics.valueAtRisk95 > 0);
assert.ok(analytics.conditionalValueAtRisk95 > analytics.valueAtRisk95);
assert.ok(analytics.estimatedAnnualVolatilityPct > 0);
assert.ok(analytics.beta > 0);
assert.equal(analytics.largestPosition.symbol, "VTI");
assert.equal(analytics.largestPosition.allocation, 42);
assert.ok(analytics.correlationMatrix.some((item) => item.pair === "VTI/VXUS"));
assert.ok(analytics.riskBreaches.some((item) => /Largest holding VTI/.test(item)));

const thinCashPortfolio: PaperPortfolio = {
  ...seed.portfolio,
  id: "thin-cash",
  cash: 100,
  totalValue: 100000,
  holdings: [
    { symbol: "VTI", name: "Total US Stock Market", allocation: 92, value: 92000, unrealizedPnl: 0 },
    { symbol: "BND", name: "Total Bond Market", allocation: 7.9, value: 7900, unrealizedPnl: 0 },
  ],
};
const thinCashAnalytics = service.analyze(thinCashPortfolio, generatedAt);

assert.ok(thinCashAnalytics.riskBreaches.some((item) => /Cash below 5%/.test(item)));
assert.ok(thinCashAnalytics.riskBreaches.some((item) => /Portfolio beta above/.test(item)));
assert.ok(thinCashAnalytics.requiredActions.some((item) => /Review portfolio risk/.test(item)));

console.log("portfolioRiskAnalyticsService smoke tests passed");
