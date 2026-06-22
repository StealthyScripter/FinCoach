import { randomUUID } from "crypto";
import type { OrderRequest, Position } from "./domain";
import { governanceRepository, type GovernanceRepository } from "./governanceRepository";

export type LimitedAutonomyPolicy = {
  enabled: boolean;
  allowedInstruments: string[];
  maxRiskPerTradePct: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
  maxLeverage: number;
  allowedStrategyIds: string[];
  tradingSessionLimits: string[];
  newsBlackoutWindows: string[];
  killSwitchStatus: "armed" | "triggered";
  emergencyClosePermission: boolean;
  mode: "paper" | "live";
};

export const DEFAULT_AUTONOMY_POLICY: LimitedAutonomyPolicy = {
  enabled: false,
  allowedInstruments: [],
  maxRiskPerTradePct: 0.5,
  maxDailyLoss: 250,
  maxOpenPositions: 2,
  maxLeverage: 5,
  allowedStrategyIds: [],
  tradingSessionLimits: [],
  newsBlackoutWindows: [],
  killSwitchStatus: "armed",
  emergencyClosePermission: false,
  mode: "paper",
};

export type CircuitState = {
  globalKillSwitch: boolean;
  strategyKillSwitches: string[];
  assetKillSwitches: string[];
  dailyLoss: number;
  maxDailyLoss: number;
  drawdownPct: number;
  maxDrawdownPct: number;
  volatilityPct: number;
  maxVolatilityPct: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  dataAgeSeconds: number;
  maxDataAgeSeconds: number;
  brokerConnected: boolean;
};

export type RiskDecision = {
  allowed: boolean;
  reasons: string[];
  checkedAt: string;
};

export class ExecutionRiskService {
  private state: CircuitState = {
    globalKillSwitch: false,
    strategyKillSwitches: [],
    assetKillSwitches: [],
    dailyLoss: 0,
    maxDailyLoss: 250,
    drawdownPct: 0,
    maxDrawdownPct: 10,
    volatilityPct: 0,
    maxVolatilityPct: 8,
    consecutiveLosses: 0,
    maxConsecutiveLosses: 4,
    dataAgeSeconds: 0,
    maxDataAgeSeconds: 60,
    brokerConnected: true,
  };

  check(request: OrderRequest): RiskDecision {
    const reasons = [
      this.state.globalKillSwitch ? "Global kill switch is triggered" : null,
      this.state.strategyKillSwitches.includes(request.strategyId) ? "Strategy kill switch is triggered" : null,
      this.state.assetKillSwitches.includes(request.instrument) ? "Asset kill switch is triggered" : null,
      this.state.dailyLoss >= this.state.maxDailyLoss ? "Daily loss circuit breaker is triggered" : null,
      this.state.drawdownPct >= this.state.maxDrawdownPct ? "Drawdown circuit breaker is triggered" : null,
      this.state.volatilityPct >= this.state.maxVolatilityPct ? "Volatility circuit breaker is triggered" : null,
      this.state.consecutiveLosses >= this.state.maxConsecutiveLosses ? "Repeated loss circuit breaker is triggered" : null,
      this.state.dataAgeSeconds > this.state.maxDataAgeSeconds ? "Market data stale circuit breaker is triggered" : null,
      !this.state.brokerConnected ? "Broker disconnected circuit breaker is triggered" : null,
      request.mode === "supervised_live" && !request.explicitUserConfirmation ? "Explicit user confirmation is required for live execution" : null,
    ].filter((reason): reason is string => Boolean(reason));
    return { allowed: reasons.length === 0, reasons, checkedAt: new Date().toISOString() };
  }

  update(update: Partial<CircuitState>) {
    this.state = { ...this.state, ...update };
    return this.snapshot();
  }

  triggerGlobalKillSwitch() {
    return this.update({ globalKillSwitch: true });
  }

  snapshot(): CircuitState {
    return {
      ...this.state,
      strategyKillSwitches: [...this.state.strategyKillSwitches],
      assetKillSwitches: [...this.state.assetKillSwitches],
    };
  }
}

export type ExecutionAuditEntry = {
  id: string;
  action: string;
  outcome: "accepted" | "rejected" | "created" | "filled" | "blocked";
  correlationId: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export class ExecutionAuditLog {
  private entries: ExecutionAuditEntry[] = [];
  private pending = new Set<Promise<unknown>>();
  private persistenceFailures = 0;
  private lastPersistenceError: string | null = null;

  constructor(private readonly repository?: GovernanceRepository) {}

  append(entry: Omit<ExecutionAuditEntry, "id" | "createdAt">) {
    const saved = { ...entry, id: randomUUID(), createdAt: new Date().toISOString() };
    this.entries.push(saved);
    if (this.repository) {
      const persistence = this.repository.saveExecutionAudit(saved);
      this.pending.add(persistence);
      void persistence.then(
        () => this.pending.delete(persistence),
        (error) => {
          this.pending.delete(persistence);
          this.persistenceFailures += 1;
          this.lastPersistenceError = error instanceof Error ? error.message : "Execution audit persistence failed";
        },
      );
    }
    return saved;
  }

  list() {
    return [...this.entries].reverse();
  }

  clearForTest() {
    this.entries = [];
  }

  async flushPersistence() {
    await Promise.all(Array.from(this.pending));
    if (this.persistenceFailures > 0) throw new Error(this.lastPersistenceError ?? "Execution audit persistence is incomplete");
  }

  async durableList() {
    await this.flushPersistence();
    if (!this.repository) return this.list();
    const persisted = await this.repository.listExecutionAudits();
    const combined = new Map<string, ExecutionAuditEntry>();
    [...persisted, ...this.entries].forEach((entry) => combined.set(entry.id, entry as ExecutionAuditEntry));
    return Array.from(combined.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  persistenceHealth() {
    return {
      configured: Boolean(this.repository),
      repository: this.repository?.health() ?? null,
      failureCount: this.persistenceFailures,
      lastError: this.lastPersistenceError,
    };
  }
}

export function summarizePositions(positions: Position[]) {
  const exposure = positions.reduce((sum, position) => sum + Math.abs(position.units * position.currentPrice), 0);
  const unrealizedPnL = positions.reduce((sum, position) => sum + position.unrealizedPnL, 0);
  const realizedPnL = positions.reduce((sum, position) => sum + position.realizedPnL, 0);
  const marginUsage = positions.reduce((sum, position) => sum + position.marginUsed, 0);
  return {
    openPositions: positions.length,
    unrealizedPnL: round(unrealizedPnL),
    realizedPnL: round(realizedPnL),
    marginUsage: round(marginUsage),
    exposure: round(exposure),
    staleData: positions.some((position) => position.staleData),
    emergencyAlerts: positions.flatMap((position) => [
      position.staleData ? `${position.instrument} market data is stale` : null,
      position.stopLossStatus === "triggered" ? `${position.instrument} stop loss triggered` : null,
    ]).filter((item): item is string => Boolean(item)),
    correlation: positions.length > 1 ? "Review correlated USD and commodity exposure" : "No multi-position correlation warning",
  };
}

function round(value: number) {
  return Number(value.toFixed(2));
}

export const executionRiskService = new ExecutionRiskService();
export const executionAuditLog = new ExecutionAuditLog(governanceRepository);
