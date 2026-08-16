import type { Express } from "express";
import { portfolioPlatformService } from "./service";

export function registerPortfolioRoutes(app: Express) {
  app.get("/api/portfolio/health", async (_req, res) => {
    res.json(await portfolioPlatformService.health());
  });

  app.get("/api/portfolio/summary", async (_req, res) => {
    res.json({ portfolios: await portfolioPlatformService.summaries() });
  });

  app.get("/api/portfolio/activity", async (req, res) => {
    const limit = Math.min(250, Math.max(1, Number(req.query.limit ?? 100)));
    res.json({ events: await portfolioPlatformService.activity(limit) });
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
