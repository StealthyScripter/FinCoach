import { randomUUID } from "crypto";
import { Pool } from "pg";
import { eventLogService } from "../eventLogService";
import { executionAuditLog } from "./riskControls";
import type { StrategyValidationInput, StrategyValidationScorecard } from "./strategyValidation";
import { strategyEvidenceRecords } from "@shared/schema";

export type StrategyEvidenceKind =
  | "validation_scorecard"
  | "backtest_result"
  | "walk_forward_result"
  | "monte_carlo_result"
  | "paper_trade"
  | "sandbox_trade"
  | "post_trade_review"
  | "regret_report"
  | "counterfactual_report"
  | "regime_label"
  | "symbol_suitability"
  | "user_override"
  | "rejected_signal";

export type StrategyEvidenceVerdict = "healthy" | "watch" | "pause" | "retire" | "accept" | "reject" | "insufficient" | "developing" | "acceptable" | "robust";

export type StrategyEvidenceRecord = {
  id: string;
  strategyId: string;
  kind: StrategyEvidenceKind;
  verdict: StrategyEvidenceVerdict | null;
  symbol: string | null;
  regime: string | null;
  timeframe: string | null;
  timestamp: string;
  source: string;
  title: string;
  summary: string;
  outcome: string | null;
  relatedIds: string[];
  metadata: Record<string, unknown>;
};

export type StrategyTradeEvidenceContext = {
  originalStrategyInputs: Record<string, unknown>;
  signalFeatures: Record<string, unknown>;
  marketRegime: string;
  volatilityState: string;
  spreadState: string;
  eventBlackoutProximityMinutes: number | null;
  riskPrecheck: Record<string, unknown>;
  positionSizingDecision: Record<string, unknown>;
  lifecycleTimeline: Array<{ state: string; reason: string; createdAt: string; metadata: Record<string, unknown> }>;
};

export type StrategyRejectedSignalAnalysis = {
  id: string;
  strategyId: string;
  symbol: string;
  rejectedAt: string;
  rejectionReason: string;
  laterOutcome: string;
  correct: boolean;
  missedOpportunity: boolean;
  avoidedLoss: boolean;
  ruleImprovementSuggestion: string;
};

export type StrategyEvidenceQuery = {
  strategyId?: string;
  symbol?: string;
  regime?: string;
  verdict?: StrategyEvidenceVerdict;
  from?: string;
  to?: string;
  kind?: StrategyEvidenceKind;
};

export type StrategyEvidenceStoreSnapshot = {
  generatedAt: string;
  records: StrategyEvidenceRecord[];
  rejectedSignals: StrategyRejectedSignalAnalysis[];
};

export type SampleDepthAnalysis = {
  strategyId: string;
  verdict: "insufficient" | "developing" | "acceptable" | "robust";
  score: number;
  totalTrades: number;
  recentTrades: number;
  symbolsTested: string[];
  regimesTested: string[];
  timeframesTested: string[];
  winLossDiversity: boolean;
  stressScenarioCoverage: number;
  minimumEvidenceThreshold: boolean;
};

export class StrategyEvidenceStore {
  private records: StrategyEvidenceRecord[] = [];
  private rejectedSignals = new Map<string, StrategyEvidenceRecord>();
  private readonly pool: Pool | null;
  private readonly pending = new Set<Promise<unknown>>();
  private persistenceFailures = 0;
  private lastPersistenceError: string | null = null;
  private hydrated = false;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  }

  recordValidationScorecard(input: StrategyValidationScorecard, evidence: StrategyValidationInput) {
    const verdict = mapValidationVerdict(input.verdict);
    this.append({
      strategyId: input.strategyId,
      kind: "validation_scorecard",
      verdict,
      symbol: input.instrument,
      regime: summarizeRegime(evidence),
      timeframe: "validation",
      source: "strategy-validation",
      title: `${input.strategyId} validation scorecard`,
      summary: `Overall ${round(input.overallScore)} with ${input.verdict} verdict.`,
      outcome: input.verdict,
      relatedIds: [],
      metadata: { scorecard: clone(input), evidence: clone(evidence) },
    });
    this.recordBacktestResult(input.strategyId, {
      verdict,
      summary: `Backtest net return ${evidence.backtest.netReturnPct} with ${evidence.backtest.tradeCount} trades.`,
      symbol: input.instrument,
      regime: summarizeRegime(evidence),
      evidence: evidence.backtest,
    });
    this.recordWalkForwardResult(input.strategyId, {
      verdict,
      summary: `Walk-forward degradation ${evidence.walkForward.degradationPct}.`,
      symbol: input.instrument,
      regime: summarizeRegime(evidence),
      evidence: evidence.walkForward,
    });
    this.recordMonteCarloResult(input.strategyId, {
      verdict,
      summary: `Monte Carlo risk of ruin ${evidence.monteCarlo.riskOfRuinPct}.`,
      symbol: input.instrument,
      regime: summarizeRegime(evidence),
      evidence: evidence.monteCarlo,
    });
  }

  recordBacktestResult(strategyId: string, input: { verdict: StrategyEvidenceVerdict | null; summary: string; symbol?: string; regime?: string; evidence: unknown }) {
    this.append({
      strategyId,
      kind: "backtest_result",
      verdict: input.verdict,
      symbol: input.symbol ?? null,
      regime: input.regime ?? null,
      timeframe: null,
      source: "backtesting",
      title: `${strategyId} backtest`,
      summary: input.summary,
      outcome: input.verdict,
      relatedIds: [],
      metadata: { evidence: clone(input.evidence) },
    });
  }

  recordWalkForwardResult(strategyId: string, input: { verdict: StrategyEvidenceVerdict | null; summary: string; symbol?: string; regime?: string; evidence: unknown }) {
    this.append({
      strategyId,
      kind: "walk_forward_result",
      verdict: input.verdict,
      symbol: input.symbol ?? null,
      regime: input.regime ?? null,
      timeframe: null,
      source: "strategy-validation",
      title: `${strategyId} walk-forward`,
      summary: input.summary,
      outcome: input.verdict,
      relatedIds: [],
      metadata: { evidence: clone(input.evidence) },
    });
  }

  recordMonteCarloResult(strategyId: string, input: { verdict: StrategyEvidenceVerdict | null; summary: string; symbol?: string; regime?: string; evidence: unknown }) {
    this.append({
      strategyId,
      kind: "monte_carlo_result",
      verdict: input.verdict,
      symbol: input.symbol ?? null,
      regime: input.regime ?? null,
      timeframe: null,
      source: "strategy-validation",
      title: `${strategyId} Monte Carlo`,
      summary: input.summary,
      outcome: input.verdict,
      relatedIds: [],
      metadata: { evidence: clone(input.evidence) },
    });
  }

  recordRegimeLabel(strategyId: string, input: { regime: string; source: string; summary: string; symbol?: string; verdict?: StrategyEvidenceVerdict | null; metadata?: Record<string, unknown> }) {
    this.append({
      strategyId,
      kind: "regime_label",
      verdict: input.verdict ?? null,
      symbol: input.symbol ?? null,
      regime: input.regime,
      timeframe: null,
      source: input.source,
      title: `${strategyId} regime label`,
      summary: input.summary,
      outcome: input.regime,
      relatedIds: [],
      metadata: input.metadata ?? {},
    });
  }

  recordSymbolSuitability(strategyId: string, input: { symbol: string; verdict: StrategyEvidenceVerdict | null; summary: string; source: string; metadata?: Record<string, unknown> }) {
    this.append({
      strategyId,
      kind: "symbol_suitability",
      verdict: input.verdict,
      symbol: input.symbol,
      regime: null,
      timeframe: null,
      source: input.source,
      title: `${strategyId} symbol suitability`,
      summary: input.summary,
      outcome: input.verdict,
      relatedIds: [],
      metadata: input.metadata ?? {},
    });
  }

  recordUserOverride(strategyId: string, input: { verdict: StrategyEvidenceVerdict; summary: string; source: string; metadata?: Record<string, unknown> }) {
    this.append({
      strategyId,
      kind: "user_override",
      verdict: input.verdict,
      symbol: null,
      regime: null,
      timeframe: null,
      source: input.source,
      title: `${strategyId} user override`,
      summary: input.summary,
      outcome: input.verdict,
      relatedIds: [],
      metadata: input.metadata ?? {},
    });
  }

  recordRejectedSignal(input: {
    strategyId: string;
    symbol: string;
    reason: string;
    signalId: string;
    timestamp: string;
    regime?: string | null;
    timeframe?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const record = this.append({
      strategyId: input.strategyId,
      kind: "rejected_signal",
      verdict: "reject",
      symbol: input.symbol,
      regime: input.regime ?? null,
      timeframe: input.timeframe ?? null,
      source: "signal-rejection",
      title: `${input.strategyId} rejected signal`,
      summary: input.reason,
      outcome: null,
      relatedIds: [],
      metadata: { signalId: input.signalId, ...input.metadata },
      timestamp: input.timestamp,
    });
    this.rejectedSignals.set(record.id, record);
    return record;
  }

  recordClosedTrade(input: {
    strategyId: string;
    symbol: string;
    tradeKind: "paper_trade" | "sandbox_trade";
    verdict: "healthy" | "watch" | "pause" | "retire" | "accept" | "reject" | null;
    summary: string;
    outcome: string;
    timestamp: string;
    regime?: string | null;
    timeframe?: string | null;
    title: string;
    source: string;
    metadata: Record<string, unknown>;
  }) {
    this.append({
      strategyId: input.strategyId,
      kind: input.tradeKind,
      verdict: input.verdict,
      symbol: input.symbol,
      regime: input.regime ?? null,
      timeframe: input.timeframe ?? null,
      source: input.source,
      title: input.title,
      summary: input.summary,
      outcome: input.outcome,
      relatedIds: [],
      metadata: input.metadata,
      timestamp: input.timestamp,
    });
  }

  recordPostTradeReview(input: {
    strategyId: string;
    symbol: string;
    summary: string;
    outcome: string;
    verdict: StrategyEvidenceVerdict | null;
    timestamp: string;
    regime?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    this.append({
      strategyId: input.strategyId,
      kind: "post_trade_review",
      verdict: input.verdict,
      symbol: input.symbol,
      regime: input.regime ?? null,
      timeframe: null,
      source: "post-trade-review",
      title: `${input.strategyId} post-trade review`,
      summary: input.summary,
      outcome: input.outcome,
      relatedIds: [],
      metadata: input.metadata ?? {},
      timestamp: input.timestamp,
    });
  }

  recordRegretReport(input: {
    strategyId: string;
    summary: string;
    verdict: StrategyEvidenceVerdict | null;
    outcome: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  }) {
    this.append({
      strategyId: input.strategyId,
      kind: "regret_report",
      verdict: input.verdict,
      symbol: null,
      regime: null,
      timeframe: null,
      source: "strategy-lab",
      title: `${input.strategyId} regret report`,
      summary: input.summary,
      outcome: input.outcome,
      relatedIds: [],
      metadata: input.metadata ?? {},
      timestamp: input.timestamp,
    });
  }

  recordCounterfactualReport(input: {
    strategyId: string;
    summary: string;
    verdict: StrategyEvidenceVerdict | null;
    outcome: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  }) {
    this.append({
      strategyId: input.strategyId,
      kind: "counterfactual_report",
      verdict: input.verdict,
      symbol: null,
      regime: null,
      timeframe: null,
      source: "strategy-lab",
      title: `${input.strategyId} counterfactual report`,
      summary: input.summary,
      outcome: input.outcome,
      relatedIds: [],
      metadata: input.metadata ?? {},
      timestamp: input.timestamp,
    });
  }

  recordSandboxTrade(input: {
    strategyId: string;
    symbol: string;
    summary: string;
    outcome: string;
    timestamp: string;
    regime?: string | null;
    timeframe?: string | null;
    metadata: Record<string, unknown>;
  }) {
    this.append({
      strategyId: input.strategyId,
      kind: "sandbox_trade",
      verdict: null,
      symbol: input.symbol,
      regime: input.regime ?? null,
      timeframe: input.timeframe ?? null,
      source: "sandbox-flow",
      title: `${input.strategyId} sandbox trade`,
      summary: input.summary,
      outcome: input.outcome,
      relatedIds: [],
      metadata: input.metadata,
      timestamp: input.timestamp,
    });
  }

  query(input: StrategyEvidenceQuery = {}) {
    return this.records
      .filter((record) => !input.strategyId || record.strategyId === input.strategyId)
      .filter((record) => !input.symbol || record.symbol === input.symbol)
      .filter((record) => !input.regime || record.regime === input.regime)
      .filter((record) => !input.kind || record.kind === input.kind)
      .filter((record) => !input.verdict || record.verdict === input.verdict)
      .filter((record) => !input.from || record.timestamp >= input.from)
      .filter((record) => !input.to || record.timestamp <= input.to)
      .map(cloneRecord)
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  }

  analyzeRejectedSignals(strategyId?: string) {
    const rejected = this.query({ strategyId, kind: "rejected_signal" });
    const trades = this.query({ strategyId }).filter((record) => record.kind === "paper_trade" || record.kind === "sandbox_trade");
    return rejected.map((signal) => {
      const laterTrade = trades.find((trade) => trade.strategyId === signal.strategyId && trade.symbol === signal.symbol && trade.timestamp >= signal.timestamp);
      const laterOutcome = laterTrade?.outcome ?? "No later trade recorded";
      const missedOpportunity = laterTrade ? /win|filled|accept/i.test(laterOutcome) : false;
      const avoidedLoss = laterTrade ? /loss|reject|stop/i.test(laterOutcome) : false;
      const correct = laterTrade ? !missedOpportunity : true;
      return {
        id: signal.id,
        strategyId: signal.strategyId,
        symbol: signal.symbol ?? "unknown",
        rejectedAt: signal.timestamp,
        rejectionReason: signal.summary,
        laterOutcome,
        correct,
        missedOpportunity,
        avoidedLoss,
        ruleImprovementSuggestion: missedOpportunity
          ? "Loosen the rejection rule or require one more evidence check."
          : avoidedLoss
            ? "Keep the rejection rule; it avoided a loss."
            : "Keep gathering outcomes before changing this rule.",
      };
    });
  }

  snapshot(now = new Date()) {
    return {
      generatedAt: now.toISOString(),
      records: this.query(),
      rejectedSignals: this.analyzeRejectedSignals(),
    } satisfies StrategyEvidenceStoreSnapshot;
  }

  async bootstrap() {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.pool) return;
    const response = await this.pool.query(
      `SELECT id, strategy_id, kind, verdict, symbol, regime, timeframe, timestamp, source, title, summary, outcome, related_ids, metadata
       FROM strategy_evidence_records
       ORDER BY timestamp ASC`,
    );
    for (const row of response.rows) {
      const record: StrategyEvidenceRecord = {
        id: String(row.id),
        strategyId: String(row.strategy_id),
        kind: String(row.kind) as StrategyEvidenceKind,
        verdict: row.verdict ? String(row.verdict) as StrategyEvidenceVerdict : null,
        symbol: row.symbol ? String(row.symbol) : null,
        regime: row.regime ? String(row.regime) : null,
        timeframe: row.timeframe ? String(row.timeframe) : null,
        timestamp: new Date(row.timestamp).toISOString(),
        source: String(row.source),
        title: String(row.title),
        summary: String(row.summary),
        outcome: row.outcome ? String(row.outcome) : null,
        relatedIds: Array.isArray(row.related_ids) ? row.related_ids.map(String) : [],
        metadata: row.metadata ?? {},
      };
      this.merge(record);
    }
  }

  async flushPersistence() {
    await Promise.all(Array.from(this.pending));
    if (this.persistenceFailures > 0) {
      throw new Error(this.lastPersistenceError ?? "Strategy evidence persistence is incomplete");
    }
  }

  async replay(limit = 1000) {
    await this.bootstrap();
    await this.flushPersistence();
    return this.query({}).slice(0, limit);
  }

  exportJsonLines(limit = 1000) {
    return this.query({}).slice(0, limit).map((record) => JSON.stringify(record)).join("\n").concat(this.records.length > 0 ? "\n" : "");
  }

  persistenceHealth() {
    return {
      configured: Boolean(this.pool),
      provider: this.pool ? "postgres" : "memory",
      failures: this.persistenceFailures,
      lastError: this.lastPersistenceError,
      buffered: this.records.length,
    } as const;
  }

  clearForTest() {
    this.records.length = 0;
    this.rejectedSignals.clear();
  }

  private append(input: Omit<StrategyEvidenceRecord, "id" | "timestamp"> & { timestamp?: string }) {
    const record: StrategyEvidenceRecord = {
      id: randomUUID(),
      strategyId: input.strategyId,
      kind: input.kind,
      verdict: input.verdict,
      symbol: input.symbol,
      regime: input.regime,
      timeframe: input.timeframe,
      timestamp: input.timestamp ?? new Date().toISOString(),
      source: input.source,
      title: input.title,
      summary: input.summary,
      outcome: input.outcome,
      relatedIds: [...input.relatedIds],
      metadata: clone(input.metadata),
    };
    this.merge(record);
    if (this.pool) {
      const persistence = this.persist(record);
      this.pending.add(persistence);
      void persistence.then(
        () => this.pending.delete(persistence),
        (error) => {
          this.pending.delete(persistence);
          this.persistenceFailures += 1;
          this.lastPersistenceError = error instanceof Error ? error.message : "Strategy evidence persistence failed";
        },
      );
    }
    executionAuditLog.append({
      action: "strategy.evidence.recorded",
      outcome: "accepted",
      correlationId: record.id,
      detail: { strategyId: record.strategyId, kind: record.kind, verdict: record.verdict, symbol: record.symbol, regime: record.regime },
    });
    eventLogService.append({
      type: "analytics.snapshot_recorded",
      userId: "system",
      sourceService: "strategy-evidence-store",
      correlationId: record.id,
      payload: {
        strategyId: record.strategyId,
        kind: record.kind,
        verdict: record.verdict,
        symbol: record.symbol,
        regime: record.regime,
      },
      createdAt: record.timestamp,
    });
    return record;
  }

  private merge(record: StrategyEvidenceRecord) {
    const index = this.records.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      this.records[index] = cloneRecord(record);
    } else {
      this.records.push(cloneRecord(record));
    }
    if (record.kind === "rejected_signal") {
      this.rejectedSignals.set(record.id, cloneRecord(record));
    }
    this.enforceRetention();
  }

  private enforceRetention() {
    const recordLimit = retentionLimit("FINCOACH_STRATEGY_EVIDENCE_RETENTION_LIMIT", 5000);
    if (this.records.length > recordLimit) this.records.splice(0, this.records.length - recordLimit);
    const rejectedLimit = retentionLimit("FINCOACH_REJECTED_SIGNAL_RETENTION_LIMIT", 1000);
    while (this.rejectedSignals.size > rejectedLimit) {
      const oldest = this.rejectedSignals.keys().next().value;
      if (!oldest) break;
      this.rejectedSignals.delete(oldest);
    }
  }

  private async persist(record: StrategyEvidenceRecord) {
    if (!this.pool) throw new Error("DATABASE_URL is not configured");
    await this.pool.query(
      `INSERT INTO strategy_evidence_records
        (id, strategy_id, kind, verdict, symbol, regime, timeframe, timestamp, source, title, summary, outcome, related_ids, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        record.id,
        record.strategyId,
        record.kind,
        record.verdict,
        record.symbol,
        record.regime,
        record.timeframe,
        record.timestamp,
        record.source,
        record.title,
        record.summary,
        record.outcome,
        JSON.stringify(record.relatedIds),
        JSON.stringify(record.metadata),
      ],
    );
  }
}

export class SampleDepthService {
  analyze(records: StrategyEvidenceRecord[], strategyId: string): SampleDepthAnalysis {
    const evidence = records.filter((record) => record.strategyId === strategyId);
    const trades = evidence.filter((record) => record.kind === "paper_trade" || record.kind === "sandbox_trade");
    const recentTrades = trades.filter((record) => ageDays(record.timestamp) <= 30);
    const symbols = new Set(trades.map((record) => record.symbol).filter((symbol): symbol is string => Boolean(symbol)));
    const regimes = new Set(trades.map((record) => record.regime).filter((regime): regime is string => Boolean(regime)));
    const timeframes = new Set(trades.map((record) => record.timeframe).filter((timeframe): timeframe is string => Boolean(timeframe)));
    const wins = trades.filter((record) => /win|accept|filled/i.test(String(record.outcome))).length;
    const losses = trades.filter((record) => /loss|reject|stop/i.test(String(record.outcome))).length;
    const stressScenarioCoverage = evidence.filter((record) => ["regret_report", "counterfactual_report", "validation_scorecard", "backtest_result", "walk_forward_result", "monte_carlo_result"].includes(record.kind)).length;
    const evidenceTotal = evidence.length;
    const score = clamp(
      trades.length * 5
      + recentTrades.length * 2
      + symbols.size * 10
      + regimes.size * 10
      + timeframes.size * 8
      + Math.min(12, wins > 0 && losses > 0 ? 12 : 4)
      + Math.min(15, stressScenarioCoverage * 2),
    );
    const verdict: "insufficient" | "developing" | "acceptable" | "robust" = evidenceTotal < 4 || trades.length < 2
      ? "insufficient"
      : score < 35
        ? "developing"
        : score < 70
          ? "acceptable"
          : "robust";
    return {
      strategyId,
      verdict,
      score,
      totalTrades: trades.length,
      recentTrades: recentTrades.length,
      symbolsTested: Array.from(symbols),
      regimesTested: Array.from(regimes),
      timeframesTested: Array.from(timeframes),
      winLossDiversity: wins > 0 && losses > 0,
      stressScenarioCoverage,
      minimumEvidenceThreshold: trades.length >= 5 && symbols.size >= 2 && regimes.size >= 2,
    };
  }
}

function summarizeRegime(input: StrategyValidationInput) {
  const entries = Object.entries(input.regimePerformance);
  if (!entries.length) return "unlabeled";
  return entries.sort((left, right) => right[1] - left[1])[0]?.[0] ?? "unlabeled";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function retentionLimit(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cloneRecord(record: StrategyEvidenceRecord): StrategyEvidenceRecord {
  return { ...record, relatedIds: [...record.relatedIds], metadata: clone(record.metadata) };
}

function ageDays(timestamp: string) {
  return Math.max(0, (Date.now() - Date.parse(timestamp)) / (1000 * 60 * 60 * 24));
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function mapValidationVerdict(verdict: StrategyValidationScorecard["verdict"]): StrategyEvidenceVerdict {
  switch (verdict) {
    case "supervised_live_candidate":
      return "healthy";
    case "watchlist":
      return "watch";
    case "paper_only":
      return "accept";
    case "reject":
    default:
      return "reject";
  }
}

export const strategyEvidenceStore = new StrategyEvidenceStore();
export const sampleDepthService = new SampleDepthService();
