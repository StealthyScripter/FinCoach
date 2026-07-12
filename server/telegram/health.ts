import { getStorageHealth } from "../storageMode";
import { providerRegistryService } from "../providerRegistryService";
import { executionRiskService } from "../execution/riskControls";
import { demoRunService } from "../demoRunService";
import { strategyResearchSchedulerService } from "../strategyResearchSchedulerService";
import { loadTelegramConfig, telegramClient, validateTelegramConfig } from "./telegramClient";
import { telegramRepository } from "./repository";
import { redactChatId } from "./formatter";

const processStartedAt = Date.now();

export async function buildTelegramStatus() {
  const config = loadTelegramConfig();
  const validation = validateTelegramConfig(config);
  const demo = await demoRunService.status().catch(() => null);
  const pipeline = strategyResearchSchedulerService.snapshot();
  const storage = getStorageHealth();
  const providers = providerRegistryService.getSnapshot();
  const risk = executionRiskService.snapshot();
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
      repository: telegramRepository.health(),
    },
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
