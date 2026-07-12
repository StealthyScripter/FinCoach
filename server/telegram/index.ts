import type { Express } from "express";
import { z } from "zod";
import { buildTelegramStatus } from "./health";
import { telegramNotificationService } from "./notificationService";
import { telegramReportingService } from "./reportingService";
import { telegramRepository } from "./repository";
import { telegramSignalPublisher } from "./signalPublisher";
import { telegramLifecycleMonitor } from "./lifecycleMonitor";
import { telegramScheduler } from "./scheduler";
import { telegramMetrics } from "./metrics";
import { loadTelegramConfig, validateTelegramConfig } from "./telegramClient";
import { telegramCommandRouter } from "./commandRouter";
import { telegramUpdateReceiver } from "./updateReceiver";

const signalPreviewSchema = z.object({
  signal: z.record(z.unknown()).optional(),
});

const manualSummarySchema = z.object({
  forceSend: z.boolean().optional().default(false),
});

export async function startTelegramOperations() {
  const config = loadTelegramConfig();
  const validation = validateTelegramConfig(config);
  if (!config.notificationsEnabled || !config.botToken || !config.chatId) {
    return { started: false, validation };
  }
  await telegramLifecycleMonitor.start();
  const scheduler = telegramScheduler.start();
  const updateReceiver = telegramUpdateReceiver.start();
  return { started: true, validation, scheduler, updateReceiver };
}

export function registerTelegramOperationsRoutes(app: Express) {
  app.get("/api/marketpilot/telegram/status", async (_req, res) => {
    res.json({ ...(await buildTelegramStatus()), metrics: telegramMetrics.snapshot() });
  });

  app.get("/api/marketpilot/telegram/deliveries", async (_req, res) => {
    res.json({ deliveries: await telegramRepository.listDeliveries(100), liveExecutionBlocked: true });
  });

  app.get("/api/marketpilot/telegram/signals", async (_req, res) => {
    res.json({ signals: await telegramRepository.listSignals(100), liveExecutionBlocked: true });
  });

  app.get("/api/marketpilot/telegram/signals/:id", async (req, res) => {
    const signal = await telegramRepository.getSignal(req.params.id);
    if (!signal) {
      res.status(404).json({ message: "Signal not found" });
      return;
    }
    res.json({ signal, updates: await telegramRepository.listSignalUpdates(req.params.id), liveExecutionBlocked: true });
  });

  app.post("/api/marketpilot/telegram/test", async (_req, res) => {
    const result = await telegramNotificationService.sendTestMessage();
    res.status(result.sent ? 201 : 400).json({ ...result, liveExecutionBlocked: true });
  });

  app.post("/api/marketpilot/telegram/daily-summary", async (_req, res) => {
    const parsed = manualSummarySchema.safeParse(_req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid manual summary payload", issues: parsed.error.flatten() });
      return;
    }
    const result = await telegramReportingService.dailySummaryResult();
    const delivery = parsed.data.forceSend
      ? await telegramNotificationService.sendOperations("report", result.summary.conciseMessage, { summaryId: result.summary.id, period: "daily", manual: true, forceSend: true })
      : { sent: false as const, reason: result.status === "existing" ? "existing summary reused; forceSend required for manual resend" : "manual summary generated without automatic send" };
    if (delivery.sent || result.status === "existing") telegramMetrics.recordSummarySend("daily", "manual", delivery.sent);
    res.status(result.status === "created" ? 201 : 200).json({ summary: result.summary, status: result.status, delivery, liveExecutionBlocked: true });
  });

  app.post("/api/marketpilot/telegram/weekly-summary", async (_req, res) => {
    const parsed = manualSummarySchema.safeParse(_req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid manual summary payload", issues: parsed.error.flatten() });
      return;
    }
    const result = await telegramReportingService.weeklySummaryResult();
    const delivery = parsed.data.forceSend
      ? await telegramNotificationService.sendOperations("report", result.summary.conciseMessage, { summaryId: result.summary.id, period: "weekly", manual: true, forceSend: true })
      : { sent: false as const, reason: result.status === "existing" ? "existing summary reused; forceSend required for manual resend" : "manual summary generated without automatic send" };
    if (delivery.sent || result.status === "existing") telegramMetrics.recordSummarySend("weekly", "manual", delivery.sent);
    res.status(result.status === "created" ? 201 : 200).json({ summary: result.summary, status: result.status, delivery, liveExecutionBlocked: true });
  });

  app.post("/api/marketpilot/telegram/signal-preview", async (req, res) => {
    const parsed = signalPreviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid signal preview payload", issues: parsed.error.flatten() });
      return;
    }
    res.json({
      previewOnly: true,
      publishes: false,
      schema: "fincoach.signal.v1",
      requiredQualityGate: [
        "demo run running",
        "demo-only policy healthy",
        "kill switch inactive",
        "fresh market data",
        "provider healthy",
        "objective rule set",
        "experiment/backtest/validation evidence",
        "entry, stop loss, take profit, invalidation",
        "duplicate/cooldown/session/news checks",
      ],
      liveExecutionBlocked: true,
    });
  });
}

export { telegramCommandRouter, telegramLifecycleMonitor, telegramNotificationService, telegramReportingService, telegramRepository, telegramScheduler, telegramSignalPublisher, telegramUpdateReceiver };
