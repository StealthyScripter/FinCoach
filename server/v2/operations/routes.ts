import type { Express, Request, Response } from "express";
import { v2OperationsService, type V2OperationsService } from "./service";
import type { V2OperationsCollection } from "./contracts";
import { v2TelemetryService } from "../telemetry";

const routes: [string, V2OperationsCollection][] = [
  ["/api/v2/observations", "observations"],
  ["/api/v2/hypotheses", "hypotheses"],
  ["/api/v2/experiments", "experiments"],
  ["/api/v2/backtests", "backtests"],
  ["/api/v2/court-cases", "court-cases"],
  ["/api/v2/strategies", "strategies"],
  ["/api/v2/forward-tests", "forward-tests"],
  ["/api/v2/signals", "signals"],
  ["/api/v2/evaluations", "evaluations"],
  ["/api/v2/journal", "journal"],
  ["/api/v2/lessons", "lessons"],
  ["/api/v2/models", "models"],
  ["/api/v2/lifecycle", "lifecycle"],
  ["/api/v2/orchestration", "orchestration"],
];

export function registerV2OperationsRoutes(app: Express, service: V2OperationsService = v2OperationsService) {
  app.get("/api/v2/status", async (req: Request, res: Response) => send(res, await service.statusAsync({ correlationId: correlationId(req) })));
  app.get("/api/v2/metrics", async (_req: Request, res: Response) => res.status(200).json({ ...v2TelemetryService.snapshot(), liveExecutionBlocked: true }));
  for (const [path, collection] of routes) {
    app.get(path, async (req: Request, res: Response) => send(res, await service.listAsync(collection, {
      limit: numberParam(req.query.limit),
      offset: numberParam(req.query.offset),
      symbol: stringParam(req.query.symbol),
      strategyId: stringParam(req.query.strategyId),
      status: stringParam(req.query.status),
      since: stringParam(req.query.since),
      until: stringParam(req.query.until),
      correlationId: correlationId(req),
    })));
  }
}

function send(res: Response, response: { status: number; body: Record<string, unknown> }) {
  res.status(response.status).json(response.body);
}

function correlationId(req: Request) {
  const header = req.headers["x-correlation-id"];
  return typeof header === "string" ? header : undefined;
}

function numberParam(value: unknown) {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringParam(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
