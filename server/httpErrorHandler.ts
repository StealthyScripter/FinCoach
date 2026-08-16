import type { ErrorRequestHandler } from "express";
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
