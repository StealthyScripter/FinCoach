import type { Express } from "express";
import { portfolioPlatformService } from "./service";

export function registerPortfolioRoutes(app: Express) {
  app.get("/api/portfolio/health", async (_req, res) => {
    res.json(await portfolioPlatformService.health());
  });

  app.get("/api/portfolio/readiness", async (_req, res) => {
    const health = await portfolioPlatformService.health();
    res.json(health.readiness);
  });

  app.get("/api/portfolio/provider", async (_req, res) => {
    const health = await portfolioPlatformService.health();
    res.json({ providerHealth: health.providerHealth, lastSuccessfulMarketDataRefresh: health.lastSuccessfulMarketDataRefresh, marketDataAgeSeconds: health.marketDataAgeSeconds, fallbacks: health.fallbacks, blockers: health.blockers });
  });

  app.get("/api/portfolio/summary", async (_req, res) => {
    res.json({ portfolios: await portfolioPlatformService.summaries() });
  });

  app.get("/api/portfolio/activity", async (req, res) => {
    const limit = Math.min(250, Math.max(1, Number(req.query.limit ?? 100)));
    res.json({ events: await portfolioPlatformService.activity(limit) });
  });

  app.get("/api/portfolio/rankings", async (_req, res) => {
    res.json(await portfolioPlatformService.rankings());
  });

  app.get("/api/portfolio/research", async (req, res) => {
    const limit = Math.min(250, Math.max(1, Number(req.query.limit ?? 100)));
    const strategyId = typeof req.query.strategyId === "string" ? req.query.strategyId : undefined;
    res.json(await portfolioPlatformService.researchArtifacts(strategyId, limit));
  });

  app.post("/api/portfolio/research/run", async (req, res) => {
    const limit = Math.min(20, Math.max(1, Number(req.body?.limit ?? 5)));
    const result = await portfolioPlatformService.research(limit);
    res.status(result.ok ? 200 : 409).json(result);
  });

  app.get("/api/portfolio/strategies/:portfolioId/orders", async (req, res) => {
    const limit = Math.min(250, Math.max(1, Number(req.query.limit ?? 100)));
    res.json({ orders: await portfolioPlatformService.orders(req.params.portfolioId, limit) });
  });

  app.get("/api/portfolio/strategies/:portfolioId/transactions", async (req, res) => {
    const limit = Math.min(250, Math.max(1, Number(req.query.limit ?? 100)));
    res.json({ transactions: await portfolioPlatformService.transactions(req.params.portfolioId, limit) });
  });

  app.get("/api/portfolio/strategies/:portfolioId", async (req, res) => {
    const detail = await portfolioPlatformService.detail(req.params.portfolioId);
    if (!detail) {
      res.status(404).json({ message: "Portfolio not found" });
      return;
    }
    res.json(detail);
  });

  app.post("/api/portfolio/strategies/:portfolioId/rebalance", async (req, res) => {
    const result = await portfolioPlatformService.rebalance(req.params.portfolioId);
    if (!result.ok) {
      res.status(result.reason === "portfolio_not_found" ? 404 : 409).json(result);
      return;
    }
    res.json(result);
  });
}
