import type { ErrorRequestHandler } from "express";
import type { Express, NextFunction, Request, Response } from "express";
import { structuredLogger } from "./structuredLogger";

export function createHttpErrorHandler(): ErrorRequestHandler {
  return (err: any, _req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    structuredLogger.application({ level: "error", module: "express", event: "http_request_failed", message, status, error: err });
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(status).json({ message });
  };
}

export function installExpressAsyncErrorPropagation(app: Express) {
  const target = app as Express & { __fincoachAsyncErrorPropagationInstalled?: boolean };
  if (target.__fincoachAsyncErrorPropagationInstalled) return;
  target.__fincoachAsyncErrorPropagationInstalled = true;
  for (const method of ["get", "post", "put", "patch", "delete", "all", "use"] as const) {
    const original = app[method].bind(app) as (...args: unknown[]) => unknown;
    (app as unknown as Record<string, (...args: unknown[]) => unknown>)[method] = (...args: unknown[]) => original(...args.map(wrapRouteArgument));
  }
}

function wrapRouteArgument(argument: unknown): unknown {
  if (Array.isArray(argument)) return argument.map(wrapRouteArgument);
  if (typeof argument !== "function") return argument;
  if (argument.length >= 4) return argument;
  const handler = argument as (req: Request, res: Response, next: NextFunction) => unknown;
  return function fincoachAsyncErrorWrapper(req: Request, res: Response, next: NextFunction) {
    try {
      const result = handler(req, res, next);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>).catch(next);
      }
      return result;
    } catch (error) {
      next(error);
      return undefined;
    }
  };
}
