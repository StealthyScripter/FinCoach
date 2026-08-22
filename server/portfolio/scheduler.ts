import { loadPortfolioConfig, type PortfolioConfig } from "./config";
import { portfolioPlatformService, type PortfolioPlatformLike } from "./service";
import { structuredLogger } from "../structuredLogger";

export type PortfolioSchedulerProviderState = "idle" | "healthy" | "rate_limited" | "waiting_for_quota" | "degraded" | "provider_unavailable";

export class PortfolioScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private providerState: PortfolioSchedulerProviderState = "idle";

  constructor(
    private readonly service: PortfolioPlatformLike = portfolioPlatformService,
    private readonly config: PortfolioConfig = loadPortfolioConfig(),
    private readonly intervalMs = Number(process.env.FINCOACH_PORTFOLIO_SCHEDULER_INTERVAL_MS ?? 900_000),
  ) {}

  start() {
    if (!this.config.enabled || !this.config.autostart) return { started: false as const, reason: "portfolio_scheduler_disabled" };
    if (this.timer) return { started: false as const, reason: "portfolio_scheduler_already_started" };
    this.timer = setInterval(() => void this.runOnce("timer"), Math.max(60_000, this.intervalMs));
    void this.runOnce("startup");
    return { started: true as const };
  }

  async stop(reason = "shutdown") {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    structuredLogger.application({ level: "info", module: "portfolio-scheduler", event: "portfolio_scheduler_stopped", message: "Portfolio scheduler stopped", reason });
  }

  async runOnce(trigger = "manual") {
    if (this.running) return { ok: false as const, reason: "portfolio_scheduler_already_running" };
    this.running = true;
    try {
      await this.service.summaries(new Date());
      if ("research" in this.service && typeof this.service.research === "function") await this.service.research(5, new Date());
      if ("maintenance" in this.service && typeof this.service.maintenance === "function") await this.service.maintenance(new Date());
      this.lastRunAt = new Date().toISOString();
      this.lastError = null;
      this.providerState = "healthy";
      return { ok: true as const, trigger };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.providerState = classifyPortfolioProviderState(error);
      structuredLogger.application({ level: "error", module: "portfolio-scheduler", event: "portfolio_scheduler_run_failed", message: "Portfolio scheduler run failed", error, providerState: this.providerState });
      return { ok: false as const, reason: "portfolio_scheduler_failed", providerState: this.providerState };
    } finally {
      this.running = false;
    }
  }

  status() {
    return { enabled: this.config.enabled && this.config.autostart, running: this.running, active: Boolean(this.timer), lastRunAt: this.lastRunAt, lastError: this.lastError, providerState: this.providerState };
  }
}

export const portfolioScheduler = new PortfolioScheduler();

export function classifyPortfolioProviderState(error: unknown): PortfolioSchedulerProviderState {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  const text = `${code} ${message}`.toLowerCase();
  if (/provider_budget_exhausted|quota|rate_limited|too many|frequency/.test(text)) return "waiting_for_quota";
  if (/timeout|temporar|degraded/.test(text)) return "degraded";
  if (/unavailable|capability_unavailable|provider down|network|econn|enotfound|fetch/.test(text)) return "provider_unavailable";
  return "degraded";
}
