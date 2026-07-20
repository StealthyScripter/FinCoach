import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { createApiRateLimiter } from "./rateLimit";
import { metricsService } from "./metricsService";
import { strategyEvidenceStore } from "./execution/strategyEvidenceStore";
import { startDemoRunScheduler } from "./demoRunScheduler";
import { demoOnlyPolicyService } from "./execution/demoOnlyPolicy";
import { startTelegramOperations } from "./telegram";
import { getFinCoachV2Runtime } from "./v2/runtime/composition";
import { structuredLogger } from "./structuredLogger";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));
app.use("/api", createApiRateLimiter());

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
  structuredLogger.application({ level: "info", module: source, event: "console_log", message });
}

process.on("uncaughtException", (error) => {
  structuredLogger.application({ level: "fatal", module: "process", event: "uncaught_exception", message: "Uncaught exception", error });
});

process.on("unhandledRejection", (reason) => {
  structuredLogger.application({ level: "fatal", module: "process", event: "unhandled_rejection", message: "Unhandled promise rejection", error: reason });
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      metricsService.recordRequest();
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const demoOnlyEnvironment = demoOnlyPolicyService.validateEnvironment();
  if (!demoOnlyEnvironment.safe) {
    structuredLogger.audit({ level: "fatal", event: "startup_safety_check_failed", message: "MarketPilot demo-only safety check failed", violations: demoOnlyEnvironment.violations });
    throw new Error(`MarketPilot demo-only safety check failed: ${demoOnlyEnvironment.violations.join(", ") || "demo-only mode disabled"}`);
  }
  structuredLogger.audit({ level: "info", event: "startup_safety_check_passed", message: "MarketPilot demo-only safety check passed" });
  await strategyEvidenceStore.bootstrap();
  const v2Runtime = getFinCoachV2Runtime();
  await v2Runtime.initialize();
  await registerRoutes(httpServer, app);
  await v2Runtime.start();
  startDemoRunScheduler();
  void startTelegramOperations().then((result) => {
    structuredLogger.telegram({ level: result.started ? "info" : "warn", event: result.started ? "telegram_operations_started" : "telegram_operations_not_started", message: result.started ? "Telegram operations started" : "Telegram operations not started", reason: "reason" in result ? result.reason : undefined, validation: result.validation });
  }).catch((error) => {
    structuredLogger.telegram({ level: "error", event: "telegram_operations_start_failed", message: "Telegram operations failed to start", error });
  });
  const shutdown = (signal: string) => {
    structuredLogger.audit({ level: "info", event: "graceful_shutdown_started", message: "Process graceful shutdown started", signal });
    void v2Runtime.stop(`process_${signal.toLowerCase()}`).finally(() => {
      structuredLogger.audit({ level: "info", event: "graceful_shutdown_completed", message: "Process graceful shutdown completed", signal });
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    structuredLogger.application({ level: "error", module: "express", event: "http_request_failed", message, status, error: err });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      structuredLogger.audit({ level: "info", event: "application_listening", message: "FinCoach server listening", port });
    },
  );
})();
