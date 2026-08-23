import { getStorageHealth } from "../storageMode";
import { providerRegistryService } from "../providerRegistryService";
import { executionRiskService } from "../execution/riskControls";
import { demoRunService } from "../demoRunService";
import { strategyResearchSchedulerService } from "../strategyResearchSchedulerService";
import { loadTelegramConfig, telegramClient, validateTelegramConfig } from "./telegramClient";
import { telegramRepository } from "./repository";
import { redactChatId } from "./formatter";
import { telegramUpdateReceiver } from "./updateReceiver";
import { telegramLifecycleMonitor } from "./lifecycleMonitor";
import { telegramMetrics } from "./metrics";

const processStartedAt = Date.now();

export async function buildTelegramStatus() {
  const config = loadTelegramConfig();
  const validation = validateTelegramConfig(config);
  const demo = await demoRunService.status().catch(() => null);
  const pipeline = strategyResearchSchedulerService.snapshot();
  const storage = getStorageHealth();
  const providers = providerRegistryService.getSnapshot();
  const risk = executionRiskService.snapshot();
  const clientHealth = telegramClient.health();
  const receiverHealth = telegramUpdateReceiver.health();
  const metrics = telegramMetrics.snapshot();
  return {
    generatedAt: new Date().toISOString(),
    finCoachState: "running",
    uptimeSeconds: Math.round((Date.now() - processStartedAt) / 1000),
    demoRunState: demo?.state ?? "unknown",
    researchPipelineState: pipeline.health.status,
    postgresqlStatus: storage.status,
    dataFreshness: pipeline.historicalDataCoverage.length > 0 ? "tracked" : "unknown",
      providers: providers.providers.map((provider) => ({ id: provider.id, health: provider.status })),
    liveExecutionBlocked: true,
    killSwitchActive: risk.globalKillSwitch,
    openDemoTrades: 0,
    currentExposure: 0,
    latestResearchCycle: pipeline.lastRunAt,
    telegram: {
      configValid: validation.ok,
      errors: validation.errors,
      warnings: validation.warnings,
      operationsChat: redactChatId(config.chatId),
      signalChat: redactChatId(config.signalChatId),
      client: telegramClient.health(),
      updateReceiver: receiverHealth,
      outbound: {
        configured: clientHealth.configured,
        reachable: clientHealth.lastSuccessfulSendAt !== null || clientHealth.consecutiveFailureCount === 0,
        enabled: clientHealth.enabled,
        lastSuccessfulSendAt: clientHealth.lastSuccessfulSendAt,
        lastFailedSendAt: clientHealth.lastFailedSendAt,
      },
      commands: {
        enabled: config.commandPollingEnabled && config.inboundPollingEnabled && config.longPollingEnabled && config.transport === "long_polling",
        pollerRunning: receiverHealth.running,
        ownershipState: receiverHealth.ownershipState,
        reachabilityState: receiverHealth.reachabilityState,
        lastSuccessfulPollAt: receiverHealth.lastPollSuccessAt,
        lastCommandReceivedAt: receiverHealth.lastCommandReceivedAt ?? metrics.lastCommandReceivedAt,
        lastCommandProcessedAt: receiverHealth.lastCommandProcessedAt ?? metrics.lastCommandProcessedAt,
        lastReplySentAt: receiverHealth.lastReplySentAt ?? metrics.lastReplySentAt,
      },
      telegramTransport: {
        configured: clientHealth.configured,
        receiverRunning: receiverHealth.running,
        lastPollSuccessAt: receiverHealth.lastPollSuccessAt,
        lastPollFailureAt: receiverHealth.lastPollFailureAt,
        consecutivePollFailures: receiverHealth.consecutivePollFailures,
        lastPollError: receiverHealth.lastPollError,
        lastDeliverySuccessAt: clientHealth.lastSuccessfulSendAt,
        lastDeliveryFailureAt: clientHealth.lastFailedSendAt,
        reachabilityState: receiverHealth.reachabilityState,
      },
      repository: telegramRepository.health(),
    },
    telegramLifecycle: telegramLifecycleMonitor.status(),
  };
}

export async function buildHealthMessage() {
  const status = await buildTelegramStatus();
  return [
    "FinCoach Health",
    `State: ${status.finCoachState}`,
    `Uptime: ${status.uptimeSeconds}s`,
    `Demo run: ${status.demoRunState}`,
    `Research pipeline: ${status.researchPipelineState}`,
    `PostgreSQL: ${status.postgresqlStatus}`,
    `Kill switch: ${status.killSwitchActive ? "ACTIVE" : "inactive"}`,
    "Live execution: blocked",
  ].join("\n");
}
