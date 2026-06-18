import type { NextFunction, Request, Response } from "express";
import { metricsService } from "./metricsService";

export type RateLimiterOptions = {
  windowMs?: number;
  maxRequests?: number;
  keyPrefix?: string;
  now?: () => number;
};

type Bucket = {
  resetAt: number;
  count: number;
};

export function createApiRateLimiter({
  windowMs = 60_000,
  maxRequests = 120,
  keyPrefix = "api",
  now = () => Date.now(),
}: RateLimiterOptions = {}) {
  const buckets = new Map<string, Bucket>();

  return function apiRateLimiter(req: Request, res: Response, next: NextFunction) {
    const currentTime = now();
    const key = `${keyPrefix}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= currentTime) {
      buckets.set(key, { resetAt: currentTime + windowMs, count: 1 });
      setHeaders(res, maxRequests, maxRequests - 1, Math.ceil((currentTime + windowMs) / 1000));
      next();
      return;
    }

    bucket.count += 1;
    const remaining = Math.max(0, maxRequests - bucket.count);
    setHeaders(res, maxRequests, remaining, Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > maxRequests) {
      metricsService.recordRateLimit();
      res.status(429).json({
        message: "Too many API requests. Please wait before retrying.",
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000)),
      });
      return;
    }

    next();
  };
}

function setHeaders(res: Response, limit: number, remaining: number, resetEpochSeconds: number) {
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(remaining));
  res.setHeader("RateLimit-Reset", String(resetEpochSeconds));
}
