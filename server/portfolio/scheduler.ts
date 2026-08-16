import { loadPortfolioConfig, type PortfolioConfig } from "./config";
import { portfolioPlatformService, type PortfolioPlatformLike } from "./service";
import { structuredLogger } from "../structuredLogger";

export class PortfolioScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;

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
      this.lastRunAt = new Date().toISOString();
      this.lastError = null;
      return { ok: true as const, trigger };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      structuredLogger.application({ level: "error", module: "portfolio-scheduler", event: "portfolio_scheduler_run_failed", message: "Portfolio scheduler run failed", error });
      return { ok: false as const, reason: "portfolio_scheduler_failed" };
    } finally {
      this.running = false;
    }
  }

  status() {
    return { enabled: this.config.enabled && this.config.autostart, running: this.running, active: Boolean(this.timer), lastRunAt: this.lastRunAt, lastError: this.lastError };
  }
}

export const portfolioScheduler = new PortfolioScheduler();
