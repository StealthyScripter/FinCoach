import { randomUUID } from "crypto";
import { eventLogService } from "./eventLogService";
import { publicProviderAdapters } from "./publicProviderAdapters";
import { timeSeriesStore, type ProviderIngestionRun } from "./timeSeriesStoreService";

export type IngestionRunRequest = {
  providers?: Array<"fred" | "sec" | "market" | "calendar">;
  assets?: string[];
  dryRun?: boolean;
};

export type IngestionRunReport = {
  id: string;
  status: "success" | "partial" | "failed" | "dry_run";
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  providerReports: Array<{ provider: string; status: string; records: number; errors: string[] }>;
  freshness: { newestTimestamp: string | null; oldestTimestamp: string | null };
  requiredActions: string[];
};

export class IngestionRunnerService {
  async run(request: IngestionRunRequest = {}): Promise<IngestionRunReport> {
    const startedAt = new Date().toISOString();
    const providers = request.providers ?? ["market", "fred", "sec", "calendar"];
    const assets = request.assets?.length ? request.assets : ["SPY"];
    const providerReports: IngestionRunReport["providerReports"] = [];
    const timestamps: string[] = [];

    for (const provider of providers) {
      try {
        if (provider === "market") {
          const bars = await Promise.all(assets.map((asset) => publicProviderAdapters.market.getDailyBar(asset)));
          timestamps.push(...bars.map((bar) => bar.timestamp));
          if (!request.dryRun) await timeSeriesStore.writePriceBars(bars);
          providerReports.push({ provider, status: "success", records: bars.length, errors: [] });
        } else if (provider === "fred") {
          const observation = await publicProviderAdapters.fred.getObservation();
          timestamps.push(observation.timestamp);
          if (!request.dryRun) await timeSeriesStore.writeEconomicObservations([observation]);
          providerReports.push({ provider, status: "success", records: 1, errors: [] });
        } else if (provider === "sec") {
          const filings = await Promise.all(assets.map((asset) => publicProviderAdapters.sec.getLatestFiling(asset)));
          timestamps.push(...filings.map((filing) => filing.filedAt));
          providerReports.push({ provider, status: "success", records: filings.length, errors: [] });
        } else {
          const event = await publicProviderAdapters.calendar.getNextEvent();
          timestamps.push(event.startsAt);
          providerReports.push({ provider, status: "success", records: 1, errors: [] });
        }
      } catch (error) {
        providerReports.push({ provider, status: "failed", records: 0, errors: [error instanceof Error ? error.message : "Unknown ingestion error"] });
      }
    }

    const completedAt = new Date().toISOString();
    const status = request.dryRun ? "dry_run" : providerReports.every((report) => report.status === "success") ? "success" : providerReports.some((report) => report.status === "success") ? "partial" : "failed";
    const report: IngestionRunReport = {
      id: randomUUID(),
      status,
      dryRun: Boolean(request.dryRun),
      startedAt,
      completedAt,
      providerReports,
      freshness: {
        newestTimestamp: timestamps.sort().at(-1) ?? null,
        oldestTimestamp: timestamps.sort()[0] ?? null,
      },
      requiredActions: providerReports.some((item) => item.status === "failed") ? ["Review failed provider reports before relying on new data."] : [],
    };
    const run: ProviderIngestionRun = {
      id: report.id,
      providerId: providers.join(","),
      status,
      startedAt,
      completedAt,
      records: providerReports.reduce((sum, item) => sum + item.records, 0),
      freshness: report.freshness,
      errors: providerReports.flatMap((item) => item.errors),
    };
    if (!request.dryRun) await timeSeriesStore.recordIngestionRun(run);
    eventLogService.append({
      type: "provider.ingestion_run",
      userId: "user-demo",
      sourceService: "market-data-service",
      payload: { ingestionRunId: report.id, status: report.status, records: run.records },
    });
    return report;
  }
}

export const ingestionRunnerService = new IngestionRunnerService();
