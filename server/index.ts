import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { createApiRateLimiter } from "./rateLimit";
import { metricsService } from "./metricsService";
import { strategyEvidenceStore } from "./execution/strategyEvidenceStore";
import { startDemoRunScheduler, stopDemoRunScheduler } from "./demoRunScheduler";
import { demoOnlyPolicyService } from "./execution/demoOnlyPolicy";
import { startTelegramOperations, stopTelegramOperations, telegramLifecycleMonitor } from "./telegram";
import { configureWeeklyTransitionNotifier, getFinCoachV2Runtime } from "./v2/runtime/composition";
import { weeklyMarketNotificationService } from "./telegram/weeklyMarketNotificationService";
import { structuredLogger } from "./structuredLogger";
import { deploymentMetadata } from "./deploymentMetadata";
import { strategyResearchSchedulerService } from "./strategyResearchSchedulerService";
import { getStorageHealth } from "./storageMode";
import { configureAuth } from "./auth/service";
import { portfolioScheduler } from "./portfolio/scheduler";
import { createHttpErrorHandler } from "./httpErrorHandler";

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
configureAuth(app);
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
  structuredLogger.audit({ level: "info", event: "application_starting", message: "FinCoach server starting", deployedRevision: deploymentMetadata() });
  const demoOnlyEnvironment = demoOnlyPolicyService.validateEnvironment();
  if (!demoOnlyEnvironment.safe) {
    structuredLogger.audit({ level: "fatal", event: "startup_safety_check_failed", message: "MarketPilot demo-only safety check failed", violations: demoOnlyEnvironment.violations });
    throw new Error(`MarketPilot demo-only safety check failed: ${demoOnlyEnvironment.violations.join(", ") || "demo-only mode disabled"}`);
  }
  structuredLogger.audit({ level: "info", event: "startup_safety_check_passed", message: "MarketPilot demo-only safety check passed" });
  await strategyEvidenceStore.bootstrap();
  configureWeeklyTransitionNotifier((input) => input.kind === "open"
    ? weeklyMarketNotificationService.sendOpen(input)
    : weeklyMarketNotificationService.sendClose(input));
  const v2Runtime = getFinCoachV2Runtime();
  await v2Runtime.initialize();
  await registerRoutes(httpServer, app);
  const runtimeStartStatus = await v2Runtime.start();
  startDemoRunScheduler();
  const portfolioSchedulerStart = portfolioScheduler.start();
  structuredLogger.application({ level: portfolioSchedulerStart.started ? "info" : "warn", module: "portfolio-scheduler", event: portfolioSchedulerStart.started ? "portfolio_scheduler_started" : "portfolio_scheduler_not_started", message: portfolioSchedulerStart.started ? "Portfolio scheduler started" : "Portfolio scheduler not started", reason: "reason" in portfolioSchedulerStart ? portfolioSchedulerStart.reason : undefined });
  let shuttingDown = false;
  const shutdown = (signal: "SIGTERM" | "SIGINT" | "graceful_shutdown") => {
    if (shuttingDown) return;
    shuttingDown = true;
    structuredLogger.audit({ level: "info", event: "graceful_shutdown_started", message: "Process graceful shutdown started", signal });
    void (async () => {
      const runtimeBeforeStop = v2Runtime.status();
      await closeHttpServer(httpServer, 2_000);
      stopDemoRunScheduler();
      await portfolioScheduler.stop(`process_${signal.toLowerCase()}`).catch((error) => {
        structuredLogger.application({ level: "error", module: "portfolio-scheduler", event: "portfolio_scheduler_shutdown_failed", message: "Portfolio scheduler failed to stop cleanly", error });
      });
      await v2Runtime.stop(`process_${signal.toLowerCase()}`).catch((error) => {
        structuredLogger.v2Error({ level: "error", event: "v2_runtime_shutdown_failed", message: "V2 runtime shutdown failed", error });
      });
      await telegramLifecycleMonitor.stop(signal, {
        runtimeState: String(runtimeBeforeStop.state ?? "unknown"),
        lastCompletedResearchCycle: runtimeBeforeStop.lastRunAt ?? null,
        bootId: runtimeBeforeStop.bootId,
        timeoutMs: 3_000,
      });
      await stopTelegramOperations().catch((error) => {
        structuredLogger.telegram({ level: "error", event: "telegram_operations_stop_failed", message: "Telegram operations failed to stop cleanly", error });
      });
      structuredLogger.audit({ level: "info", event: "graceful_shutdown_completed", message: "Process graceful shutdown completed", signal });
      process.exit(0);
    })().catch((error) => {
      structuredLogger.audit({ level: "fatal", event: "graceful_shutdown_failed", message: "Process graceful shutdown failed", signal, error });
      process.exit(1);
    });
  };
  if (!isAutomatedTestProcess()) {
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  }

  app.use(createHttpErrorHandler());

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
      void (async () => {
        const telegramStart = await startTelegramOperations();
        structuredLogger.telegram({ level: telegramStart.started ? "info" : "warn", event: telegramStart.started ? "telegram_operations_started" : "telegram_operations_not_started", message: telegramStart.started ? "Telegram operations started" : "Telegram operations not started", reason: "reason" in telegramStart ? telegramStart.reason : undefined, validation: telegramStart.validation });
        if (telegramStart.started && telegramStart.validation.ok && !isAutomatedTestProcess()) {
          await telegramLifecycleMonitor.start();
          const runtimeStatus = v2Runtime.status();
          const researchStatus = strategyResearchSchedulerService.snapshot();
          await telegramLifecycleMonitor.notifyStartup({
            runtimeState: String(runtimeStatus.state ?? runtimeStartStatus.state ?? "unknown"),
            researchSchedulerState: researchStatus.health.status,
            postgresqlHealth: getStorageHealth().status,
            telegramState: "connected",
            bootId: runtimeStatus.bootId,
          });
        }
      })().catch((error) => {
        structuredLogger.telegram({ level: "error", event: "telegram_operations_start_failed", message: "Telegram operations failed to start", error });
      });
    },
  );
})();

function isAutomatedTestProcess(env: NodeJS.ProcessEnv = process.env) {
  const argv = process.argv.join(" ");
  return env.NODE_ENV === "test" || argv.includes(".test.") || argv.includes("tsx server/");
}

async function closeHttpServer(server: typeof httpServer, timeoutMs: number) {
  await new Promise<void>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve();
      }
    }, timeoutMs);
    server.close((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) structuredLogger.application({ level: "error", module: "http", event: "http_server_close_failed", message: "HTTP server close failed", error });
      resolve();
    });
  });
}
