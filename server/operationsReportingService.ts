import { Pool, type QueryResultRow } from "pg";
import { accountingPeriod, type AccountingPeriodType } from "./accountingPeriods";
import { executionRiskService } from "./execution/riskControls";
import { getFinCoachV2Runtime } from "./v2/runtime/composition";
import { loadV2RuntimeConfig, type V2RuntimeConfig } from "./v2/runtime/config";
import { presentationTimezone, formatPresentation } from "./timeService";
import { operationalBlockerService } from "./operationalBlockerService";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

type MetricValue = number | "unavailable" | "not configured" | "configured empty" | "degraded" | "blocked";

type PnlProjection = {
  periodType: AccountingPeriodType;
  periodStartUtc: string;
  periodEndUtc: string;
  presentationStart: string;
  presentationEnd: string;
  realizedPnl: MetricValue;
  unrealizedPnl: MetricValue;
  grossProfit: MetricValue;
  grossLoss: MetricValue;
  fees: MetricValue;
  tradeCount: MetricValue;
  winningTrades: MetricValue;
  losingTrades: MetricValue;
  winRate: number | null | "unavailable" | "degraded";
  profitFactor: number | null | "unavailable" | "degraded";
  source: string;
  databaseBacked: boolean;
  brokerBacked: boolean;
  degraded: boolean;
  projectionError?: string;
  generatedAtUtc: string;
};

type ReportingSnapshot = {
  schemaVersion: "fincoach.operations-reporting.1";
  generatedAtUtc: string;
  presentationTimestamp: string;
  source: string;
  databaseBacked: boolean;
  brokerBacked: boolean;
  degraded: boolean;
  projectionError: string | null;
  presentationTimezone: string;
  periods: Record<AccountingPeriodType, ReturnType<typeof accountingPeriod>>;
  research: Record<string, unknown>;
  coverage: Record<string, unknown>;
  strategies: Record<string, unknown>;
  detectors: Record<string, unknown>;
  pipeline: Record<string, unknown>;
  pnl: {
    paper: PnlProjection;
    broker: PnlProjection;
    periods: Record<AccountingPeriodType, { paper: PnlProjection; broker: PnlProjection }>;
  };
  risk: Record<string, unknown>;
  runtime: Record<string, unknown>;
  blockers: Array<Record<string, unknown>>;
  operationalBlockers?: Record<string, unknown> | null;
  reconciliation: Record<string, unknown>;
  liveExecutionBlocked: true;
};

type DurableFacts = {
  degraded: boolean;
  projectionError: string | null;
  pipeline: Record<string, unknown>;
  currentHour: Record<string, unknown>;
  cycles: Record<string, unknown>;
  configuredPairs: string[];
  session: Record<string, unknown>;
  coverage: Record<string, unknown>;
  detectors: Record<string, unknown>;
  strategies: Record<string, unknown>;
};

const PIPELINE_TABLES = [
  ["observations", "v2_market_observations"],
  ["hypotheses", "v2_research_hypotheses"],
  ["strategies", "v2_strategy_definitions"],
  ["experiments", "v2_research_experiments"],
  ["backtests", "v2_backtest_results"],
  ["verdicts", "v2_court_verdicts"],
  ["rankings", "v2_ranking_decisions"],
  ["forwardTests", "v2_forward_tests"],
  ["signals", "v2_research_signals"],
  ["evaluations", "v2_external_evaluations"],
  ["journal", "v2_research_journal_entries"],
  ["lessons", "v2_learning_lessons"],
  ["lifecycle", "v2_strategy_lifecycle_decisions"],
  ["detectorEvaluations", "v2_detector_evaluations"],
] as const;

const READ_ONLY_OANDA_ENVIRONMENTS = new Set(["practice", "demo", "sandbox"]);
const OANDA_TRANSACTION_TYPES = new Set(["ORDER_FILL", "DAILY_FINANCING", "TRANSFER_FUNDS"]);

type BrokerHttpResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type BrokerHttpClient = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<BrokerHttpResponse>;

export class OperationsReportingService {
  private pool: Pool | null = null;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly db?: Queryable,
    private readonly brokerHttp: BrokerHttpClient = defaultBrokerHttp,
  ) {}

  async snapshot(now = new Date()): Promise<ReportingSnapshot> {
    const generatedAtUtc = now.toISOString();
    const timezone = presentationTimezone(this.env);
    const periods = {
      daily: accountingPeriod("daily", now, timezone),
      weekly: accountingPeriod("weekly", now, timezone),
      monthly: accountingPeriod("monthly", now, timezone),
      yearly: accountingPeriod("yearly", now, timezone),
    };
    const queryable = this.queryable();
    const runtime = safeRuntimeStatus();
    const config = safeRuntimeConfig(this.env);
    const riskSnapshot = executionRiskService.snapshot();
    const [durable, pnlPeriods] = queryable
      ? await Promise.all([this.durableFacts(queryable, now), this.pnlPeriods(queryable, periods, generatedAtUtc)])
      : [emptyDurableFacts("not_configured"), unavailablePnlPeriods(periods, "database_not_configured", generatedAtUtc)];
    const paperPnl = pnlPeriods.daily.paper;
    const brokerPnl = pnlPeriods.daily.broker;
    const degraded = durable.degraded || Object.values(pnlPeriods).some(period => period.paper.degraded || period.broker.degraded);
    const blockerSnapshot = await operationalBlockerService.snapshot(now).catch(() => null);
    const blockers = [
      ...buildBlockers({ durable, config, runtime, riskSnapshot, paperPnl, brokerPnl }),
      ...((blockerSnapshot?.active ?? []) as unknown as Array<Record<string, unknown>>),
    ];
    const pipeline = durable.pipeline;
    return {
      schemaVersion: "fincoach.operations-reporting.1",
      generatedAtUtc,
      presentationTimestamp: formatPresentation(generatedAtUtc, timezone),
      source: queryable ? "postgresql+runtime" : "runtime",
      databaseBacked: Boolean(queryable) && !durable.projectionError,
      brokerBacked: false,
      degraded,
      projectionError: durable.projectionError ?? paperPnl.projectionError ?? brokerPnl.projectionError ?? null,
      presentationTimezone: timezone,
      periods,
      research: {
        period: periods.daily,
        cyclesCompleted: durable.cycles.completed,
        cyclesFailed: durable.cycles.failed,
        cyclesSkipped: durable.cycles.skipped,
        cyclesAdmitted: durable.cycles.admitted,
        maxCyclesPerDay: config?.maxCyclesPerDay ?? numberEnv(this.env.FINCOACH_V2_MAX_CYCLES_PER_DAY, 8),
        evaluations: durable.detectors.total,
        targetEvaluationsPerHour: config?.targetEvaluationsPerHour ?? numberEnv(this.env.FINCOACH_V2_TARGET_EVALUATIONS_PER_HOUR, 200),
        minEvaluationsPerHour: config?.minEvaluationsPerHour ?? numberEnv(this.env.FINCOACH_V2_MIN_EVALUATIONS_PER_HOUR, 100),
        actualEvaluationsPerHour: durable.currentHour.evaluations,
        observations: durable.pipeline.observations,
        duplicatesSuppressed: durable.detectors.duplicateSuppressed,
        failures: durable.detectors.failed,
        nextCycle: String(runtime.nextScheduledCycleAt ?? "unavailable"),
      },
      coverage: durable.coverage,
      strategies: durable.strategies,
      detectors: durable.detectors,
      pipeline,
      pnl: { paper: paperPnl, broker: brokerPnl, periods: pnlPeriods },
      risk: {
        killSwitch: riskSnapshot.globalKillSwitch ? "active" : "inactive",
        dailyLossCircuitBreaker: Number(paperPnl.realizedPnl) < 0 && Math.abs(Number(paperPnl.realizedPnl)) >= riskSnapshot.maxDailyLoss ? "triggered" : riskSnapshot.maxDailyLoss > 0 ? "armed" : "disabled",
        automationLevel: riskSnapshot.globalKillSwitch ? 0 : "unchanged",
        accountingDayBoundary: "17:00 America/New_York",
        realizedLossCurrentDay: typeof paperPnl.realizedPnl === "number" ? Math.max(0, -paperPnl.realizedPnl) : paperPnl.realizedPnl,
        configuredLimit: riskSnapshot.maxDailyLoss,
        percentageUsed: typeof paperPnl.realizedPnl === "number" && riskSnapshot.maxDailyLoss > 0 ? round(Math.max(0, -paperPnl.realizedPnl) / riskSnapshot.maxDailyLoss * 100) : "unavailable",
        runtimeDailyLossState: "not authoritative for reporting; canonical loss uses paper PostgreSQL P/L period",
        lastActivationTime: "unavailable",
        lastActivationSource: riskSnapshot.globalKillSwitch ? "runtime_memory" : "none",
        executionGates: {
          liveExecution: "blocked",
          paperExecution: config?.paperExecutionEnabled ? "configured" : "disabled",
          demoBrokerExecution: config?.demoBrokerExecutionEnabled ? "configured" : "disabled",
          forwardTesting: config?.forwardTestingEnabled ? "configured" : "disabled",
          researchSignals: config?.researchSignalEnabled ? "configured" : "disabled",
          telegramPublication: config?.telegramSignalPublicationEnabled ? "configured" : "disabled",
        },
      },
      runtime: {
        state: runtime.state ?? "unknown",
        currentSession: durable.session.current,
        configuredPairs: durable.configuredPairs,
        liveExecutionEnabled: false,
        liveExecutionState: "blocked",
        paperExecutionEnabled: Boolean(config?.paperExecutionEnabled),
        demoBrokerExecutionEnabled: Boolean(config?.demoBrokerExecutionEnabled),
        forwardTestingEnabled: Boolean(config?.forwardTestingEnabled),
        researchSignalEnabled: Boolean(config?.researchSignalEnabled),
        telegramSignalPublicationEnabled: Boolean(config?.telegramSignalPublicationEnabled),
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
      },
      blockers,
      operationalBlockers: blockerSnapshot,
      reconciliation: {
        postgresql: queryable ? "queried" : "not_configured",
        apiV2Status: "same_projection_required",
        apiV2ResearchProgress: "same_projection_required",
        telegram: "same_projection_required",
        mismatches: [],
      },
      liveExecutionBlocked: true,
    };
  }

  async apiView(view = "status", now = new Date()) {
    const snapshot = await this.snapshot(now);
    return { status: 200, body: viewBody(snapshot, view) };
  }

  async telegramMessage(command: string, argument = "", now = new Date()) {
    const snapshot = await this.snapshot(now);
    return formatTelegram(snapshot, command, argument).slice(0, 3900);
  }

  private queryable() {
    if (this.db) return this.db;
    const url = this.env.DATABASE_URL?.trim();
    if (!url) return null;
    if (!this.pool) this.pool = new Pool({ connectionString: url });
    return this.pool;
  }

  private async durableFacts(db: Queryable, now: Date): Promise<DurableFacts> {
    try {
      const daily = accountingPeriod("daily", now);
      const currentHour = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())).toISOString();
      const countSql = PIPELINE_TABLES.map(([key, table]) => `(SELECT count(*)::int FROM ${table}) AS "${key}"`).join(", ");
      const currentSql = PIPELINE_TABLES.map(([key, table]) => `(SELECT count(*)::int FROM ${table} WHERE created_at >= $1::timestamp) AS "${key}"`).join(", ");
      const [counts, current, cycles, coverage, detectors, detectorReasons, strategies, rankings] = await Promise.all([
        db.query(`SELECT ${countSql}`),
        db.query(`SELECT ${currentSql}`, [currentHour]),
        db.query(`SELECT status, count(*)::int AS count FROM v2_orchestration_cycles WHERE created_at >= $1::timestamp AND created_at < $2::timestamp GROUP BY status`, [daily.startUtc, daily.endUtc]),
        db.query(`SELECT symbol, timeframe, detector_id, strategy_family, count(*)::int AS count FROM v2_market_observations GROUP BY symbol, timeframe, detector_id, strategy_family ORDER BY count DESC, symbol LIMIT 200`),
        db.query(`SELECT detector_id, symbol, timeframe, count(*)::int AS total, count(*) FILTER (WHERE status = 'attempted')::int AS attempted, count(*) FILTER (WHERE status = 'completed')::int AS completed, count(*) FILTER (WHERE status = 'skipped')::int AS skipped, count(*) FILTER (WHERE status = 'duplicate_suppressed')::int AS duplicate_suppressed, count(*) FILTER (WHERE status = 'failed')::int AS failed FROM v2_detector_evaluations GROUP BY detector_id, symbol, timeframe ORDER BY total DESC LIMIT 200`),
        db.query(`SELECT status, COALESCE(reason, status) AS reason, count(*)::int AS count FROM v2_detector_evaluations WHERE created_at >= $1::timestamp GROUP BY status, COALESCE(reason, status) ORDER BY status, reason`, [currentHour]),
        db.query(`SELECT payload, created_at FROM v2_strategy_definitions ORDER BY created_at DESC LIMIT 1000`),
        db.query(`SELECT payload, created_at FROM v2_ranking_decisions ORDER BY created_at DESC LIMIT 1000`),
      ]);
      const pipeline = mapCounts(counts.rows[0] ?? {});
      const hour = mapCounts(current.rows[0] ?? {});
      const strategyRows = strategies.rows.map(row => row.payload as Record<string, unknown>);
      const rankingRows = rankings.rows.map(row => row.payload as Record<string, unknown>);
      const detectorRows = detectors.rows.map(row => ({ detector: String(row.detector_id ?? "unknown"), symbol: String(row.symbol ?? "unknown"), timeframe: String(row.timeframe ?? "unknown"), total: Number(row.total ?? 0), attempted: Number(row.attempted ?? 0), completed: Number(row.completed ?? 0), skipped: Number(row.skipped ?? 0), duplicateSuppressed: Number(row.duplicate_suppressed ?? 0), failed: Number(row.failed ?? 0) }));
      const evaluationTotal = detectorRows.reduce((sum, row) => sum + row.total, 0);
      const attemptedTotal = detectorRows.reduce((sum, row) => sum + row.attempted, 0);
      const skippedTotal = detectorRows.reduce((sum, row) => sum + row.skipped, 0);
      const duplicateTotal = detectorRows.reduce((sum, row) => sum + row.duplicateSuppressed, 0);
      const failureTotal = detectorRows.reduce((sum, row) => sum + row.failed, 0);
      const reasonSummary = detectorReasonSummary(detectorReasons.rows);
      return {
        degraded: false,
        projectionError: null as string | null,
        pipeline,
        currentHour: hour,
        cycles: countStatuses(cycles.rows),
        configuredPairs: configuredPairs(this.env, coverage.rows),
        session: currentSession(now),
        coverage: coverageFacts(coverage.rows, this.env),
        detectors: {
          total: evaluationTotal,
          attempted: attemptedTotal,
          completed: detectorRows.reduce((sum, row) => sum + row.completed, 0),
          skipped: skippedTotal,
          positiveObservations: pipeline.observations,
          positiveRate: evaluationTotal > 0 ? round(Number(pipeline.observations ?? 0) / evaluationTotal * 100) : null,
          duplicateSuppressed: duplicateTotal,
          duplicateRate: evaluationTotal > 0 ? round(duplicateTotal / evaluationTotal * 100) : null,
          failed: failureTotal,
          failureRate: evaluationTotal > 0 ? round(failureTotal / evaluationTotal * 100) : null,
          currentHourByStatus: reasonSummary.byStatus,
          currentHourByReason: reasonSummary.byReason,
          supported: detectorRows,
          abnormalWarnings: evaluationTotal > 0 && Number(pipeline.observations ?? 0) / evaluationTotal >= 0.95 ? ["near_100_percent_positive_output"] : [],
        },
        strategies: strategyFacts(strategyRows, rankingRows, now),
      };
    } catch (error) {
      return emptyDurableFacts(error instanceof Error ? error.message : "postgres_projection_failed");
    }
  }

  private async paperPnl(db: Queryable, period: ReturnType<typeof accountingPeriod>, generatedAtUtc: string): Promise<PnlProjection> {
    try {
      const result = await db.query(`SELECT detail FROM execution_audit_entries WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz AND action IN ('trade.lifecycle', 'paper.trade.closed', 'trade.closed')`, [period.startUtc, period.endUtc]);
      const realized = result.rows.map(row => numeric((row.detail as Record<string, unknown>)?.realizedPnL ?? (row.detail as Record<string, unknown>)?.realizedPL)).filter((value): value is number => value !== null);
      return pnlFromValues(period, realized, "fincoach-paper-postgresql", true, false, generatedAtUtc);
    } catch (error) {
      return unavailablePnl(period, "fincoach-paper-postgresql", true, error instanceof Error ? error.message : "paper_pnl_projection_failed", generatedAtUtc);
    }
  }

  private async pnlPeriods(db: Queryable, periods: Record<AccountingPeriodType, ReturnType<typeof accountingPeriod>>, generatedAtUtc: string) {
    const entries = await Promise.all((Object.keys(periods) as AccountingPeriodType[]).map(async (type) => {
      const period = periods[type];
      const [paper, broker] = await Promise.all([this.paperPnl(db, period, generatedAtUtc), this.brokerPnl(period, generatedAtUtc)]);
      return [type, { paper, broker }] as const;
    }));
    return Object.fromEntries(entries) as Record<AccountingPeriodType, { paper: PnlProjection; broker: PnlProjection }>;
  }

  private async brokerPnl(period: ReturnType<typeof accountingPeriod>, generatedAtUtc: string): Promise<PnlProjection> {
    const environment = String(this.env.OANDA_ENV ?? this.env.OANDA_ENVIRONMENT ?? "").toLowerCase();
    if (!READ_ONLY_OANDA_ENVIRONMENTS.has(environment)) {
      return unavailablePnl(period, "oanda", false, "practice_broker_not_configured_for_read_only_reporting", generatedAtUtc);
    }
    if (environment !== "practice") {
      return unavailablePnl(period, `oanda-${environment}`, false, "only_oanda_practice_read_only_pnl_is_supported", generatedAtUtc);
    }
    if (!this.env.OANDA_API_TOKEN?.trim() || !this.env.OANDA_ACCOUNT_ID?.trim()) {
      return unavailablePnl(period, "oanda-practice", false, "oanda_practice_credentials_not_configured", generatedAtUtc);
    }
    try {
      const baseUrl = (this.env.OANDA_BASE_URL?.trim() || "https://api-fxpractice.oanda.com/v3").replace(/\/$/, "");
      const host = new URL(baseUrl).hostname;
      if (!["api-fxpractice.oanda.com", "localhost", "127.0.0.1"].includes(host)) {
        return unavailablePnl(period, "oanda-practice", false, "oanda_live_or_unknown_endpoint_rejected", generatedAtUtc);
      }
      const transactions = await this.readOandaTransactions(baseUrl, period);
      const values = transactions
        .map(transaction => numeric(transaction.pl))
        .filter((value): value is number => value !== null);
      const financing = transactions.map(transaction => numeric(transaction.financing)).filter((value): value is number => value !== null);
      const commissions = transactions.map(transaction => numeric(transaction.commission)).filter((value): value is number => value !== null);
      const projection = pnlFromValues(period, values, "oanda-practice-transactions", false, true, generatedAtUtc);
      projection.fees = round(Math.abs(financing.reduce((sum, value) => sum + value, 0)) + Math.abs(commissions.reduce((sum, value) => sum + value, 0)));
      projection.unrealizedPnl = await this.readOandaUnrealizedPnl(baseUrl).catch(() => "unavailable" as const);
      return projection;
    } catch (error) {
      return unavailablePnl(period, "oanda-practice-transactions", false, error instanceof Error ? sanitizeError(error.message) : "oanda_pnl_projection_failed", generatedAtUtc);
    }
  }

  private async readOandaTransactions(baseUrl: string, period: ReturnType<typeof accountingPeriod>) {
    const accountId = encodeURIComponent(this.env.OANDA_ACCOUNT_ID ?? "");
    const query = new URLSearchParams({ from: period.startUtc, to: period.endUtc });
    const payload = await this.oandaGet(`${baseUrl}/accounts/${accountId}/transactions?${query.toString()}`);
    const pageLinks = Array.isArray((payload as Record<string, unknown>).pages) ? (payload as Record<string, unknown>).pages as string[] : [];
    const direct = Array.isArray((payload as Record<string, unknown>).transactions) ? (payload as Record<string, unknown>).transactions as Record<string, unknown>[] : [];
    const pages = pageLinks.length ? await Promise.all(pageLinks.slice(0, 50).map(url => this.oandaGet(url))) : [];
    const transactions = pageLinks.length
      ? pages.flatMap(page => Array.isArray((page as Record<string, unknown>).transactions) ? (page as Record<string, unknown>).transactions as Record<string, unknown>[] : [])
      : direct;
    return transactions.filter(transaction => OANDA_TRANSACTION_TYPES.has(String(transaction.type ?? "")));
  }

  private async readOandaUnrealizedPnl(baseUrl: string) {
    const accountId = encodeURIComponent(this.env.OANDA_ACCOUNT_ID ?? "");
    const payload = await this.oandaGet(`${baseUrl}/accounts/${accountId}/openPositions`);
    const positions = Array.isArray((payload as Record<string, unknown>).positions) ? (payload as Record<string, unknown>).positions as Record<string, unknown>[] : [];
    return round(positions.reduce((sum, position) => sum + numeric(position.unrealizedPL, 0), 0));
  }

  private async oandaGet(url: string) {
    if (/\/orders(?:\/|$)|\/trades\/[^?]+\/close|\/positions\/[^?]+\/close/i.test(url)) {
      throw new Error("broker_execution_endpoint_rejected");
    }
    const response = await this.brokerHttp(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.env.OANDA_API_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "FinCoach-ReadOnlyReporting/1.0",
      },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`oanda_read_failed_http_${response.status}`);
    return payload;
  }
}

function viewBody(snapshot: ReportingSnapshot, view: string) {
  const key = view.replace(/^\/+/, "");
  if (key === "status") return snapshot;
  if (["blockers", "config_blockers", "fallbacks", "limits"].includes(key)) {
    return {
      schemaVersion: "fincoach.operations-reporting-view.1",
      generatedAtUtc: snapshot.generatedAtUtc,
      presentationTimestamp: snapshot.presentationTimestamp,
      view: key,
      data: filterBlockers(snapshot.blockers, key),
      operationalBlockers: snapshot.operationalBlockers,
      liveExecutionBlocked: true,
    };
  }
  return {
    schemaVersion: "fincoach.operations-reporting-view.1",
    generatedAtUtc: snapshot.generatedAtUtc,
    presentationTimestamp: snapshot.presentationTimestamp,
    source: snapshot.source,
    databaseBacked: snapshot.databaseBacked,
    brokerBacked: snapshot.brokerBacked,
    degraded: snapshot.degraded,
    projectionError: snapshot.projectionError,
    view: key,
    data: (snapshot as unknown as Record<string, unknown>)[key] ?? null,
    liveExecutionBlocked: true,
  };
}

function filterBlockers(blockers: Array<Record<string, unknown>>, key: string) {
  return blockers.filter(item => {
    const kind = String(item.kind ?? "");
    const text = String(item.code ?? item.reason ?? item.component ?? "");
    if (key === "config_blockers") return kind === "configuration" || /config|disabled|required|unset|missing/i.test(text);
    if (key === "fallbacks") return kind === "fallback" || kind === "dependency" || /broker|provider|data|fallback/i.test(text);
    if (key === "limits") return kind === "limit" || /limit|budget|max|min|cap|timeout|lease|rate|threshold/i.test(text);
    return true;
  });
}

function formatTelegram(snapshot: ReportingSnapshot, command: string, argument: string) {
  const header = (title: string) => [`${snapshot.degraded ? "🟡" : "🟢"} ${title}`, `Time: ${snapshot.presentationTimestamp}`, `Source: ${snapshot.source}; databaseBacked=${snapshot.databaseBacked}; degraded=${snapshot.degraded}`, `Period: ${snapshot.periods.daily.presentationStart} -> ${snapshot.periods.daily.presentationEnd}`];
  const pipeline = snapshot.pipeline;
  const research = snapshot.research;
  const strategies = snapshot.strategies;
  const risk = snapshot.risk;
  const broker = snapshot.pnl.broker;
  const paper = snapshot.pnl.paper;
  switch (command) {
    case "/status":
      return [...header("FinCoach Status"), `Runtime: ${snapshot.runtime.state}`, `Session: ${snapshot.runtime.currentSession}`, `Pairs: ${formatList(snapshot.runtime.configuredPairs as unknown[])}`, `Cycles: ${research.cyclesCompleted}/${research.maxCyclesPerDay} completed`, `Evaluations: ${research.evaluations}; Observations: ${research.observations}`, `Strategies: ${strategies.total}; Ranked: ${strategies.ranked}`, `Top strategy: ${formatTopStrategy(strategies)}`, `P/L paper realized/unrealized: ${paper.realizedPnl}/${paper.unrealizedPnl}`, `Broker P/L: ${broker.realizedPnl} (${broker.projectionError ?? broker.source})`, `Kill switch: ${risk.killSwitch}; daily loss: ${risk.dailyLossCircuitBreaker}`, `Live execution: ${snapshot.runtime.liveExecutionState}`].join("\n");
    case "/research":
      return [...header("FinCoach Research Progress"), `Cycles completed/failed/skipped: ${research.cyclesCompleted}/${research.cyclesFailed}/${research.cyclesSkipped}`, `Evaluations: ${research.evaluations}; target/hr: ${research.targetEvaluationsPerHour}; actual/hr: ${research.actualEvaluationsPerHour}`, `Observations: ${research.observations}; skipped: ${snapshot.detectors.skipped ?? 0}; duplicates: ${research.duplicatesSuppressed}; failures: ${research.failures}`, `Reasons: ${formatObject(snapshot.detectors.currentHourByReason as Record<string, unknown>) || "none"}`, `Coverage: ${coverageLine(snapshot.coverage)}`, `Lowest-covered: ${formatList((snapshot.coverage.lowestCoveredPairs as unknown[]) ?? [])}`, `Next cycle: ${research.nextCycle}`].join("\n");
    case "/coverage":
      return [...header("Coverage"), `Configured: ${formatList(snapshot.coverage.configuredInstruments as unknown[])}`, `Covered: ${formatList(snapshot.coverage.coveredInstruments as unknown[])}`, `Missing/starved: ${formatList(snapshot.coverage.missingInstruments as unknown[])}`, `By pair: ${formatObject(snapshot.coverage.observationsByPair as Record<string, unknown>)}`, `Sessions: ${formatObject(snapshot.coverage.sessionDistribution as Record<string, unknown>)}`, `Detectors: ${formatObject(snapshot.coverage.detectorDistribution as Record<string, unknown>)}`, `Warnings: ${formatList(snapshot.coverage.warnings as unknown[]) || "none"}`].join("\n");
    case "/strategies":
      return [...header("Strategies"), `Durable strategy definitions: ${strategies.total}`, `Created today: ${strategies.createdToday}`, `Ranked: ${strategies.ranked}`, `Validation: ${strategies.validationState}`, `Families: ${formatObject(strategies.byFamily as Record<string, unknown>)}`, `Symbols: ${formatObject(strategies.bySymbol as Record<string, unknown>)}`, `Sessions: ${formatObject(strategies.bySession as Record<string, unknown>)}`, `Timeframes: ${formatObject(strategies.byTimeframe as Record<string, unknown>)}`, `Warnings: ${formatList(strategies.concentrationWarnings as unknown[]) || "none"}`].join("\n");
    case "/leaderboard":
      return [...header("Leaderboard"), ...((strategies.top as Record<string, unknown>[] | undefined) ?? []).slice(0, 10).map((item, index) => `${index + 1}. ${item.strategyId ?? item.id ?? "unknown"} ${item.symbol ?? "unknown"} score=${item.score ?? "unavailable"} trades=${item.tradeCount ?? "unavailable"} WR=${item.winRate ?? "unavailable"} PF=${item.profitFactor ?? "unavailable"}`), "Ranking is not based on win rate alone."].join("\n");
    case "/strategy":
      return formatStrategyDetail(snapshot, argument);
    case "/week":
      return formatPeriodReport(snapshot, "weekly");
    case "/sessions":
      return [...header("Sessions"), `Current FX research phase: ${snapshot.runtime.currentSession}`, `Tradable instruments: ${formatList(snapshot.runtime.configuredPairs as unknown[])}`, `Priority pairs: ${formatList(snapshot.coverage.coveredInstruments as unknown[])}`, `Applicable families: ${formatObject(strategies.byFamily as Record<string, unknown>)}`, `Next boundary: ${snapshot.periods.daily.presentationEnd}`].join("\n");
    case "/detectors":
      return [...header("Detectors"), `Evaluations: ${snapshot.detectors.total}`, `Attempted/completed/skipped/duplicates/failed: ${snapshot.detectors.attempted ?? 0}/${snapshot.detectors.completed ?? 0}/${snapshot.detectors.skipped ?? 0}/${snapshot.detectors.duplicateSuppressed ?? 0}/${snapshot.detectors.failed ?? 0}`, `Current-hour reasons: ${formatObject(snapshot.detectors.currentHourByReason as Record<string, unknown>) || "none"}`, `Positive observations: ${snapshot.detectors.positiveObservations}`, `Positive rate: ${snapshot.detectors.positiveRate ?? "unavailable"}%`, `Duplicate rate: ${snapshot.detectors.duplicateRate ?? "unavailable"}%`, `Failure rate: ${snapshot.detectors.failureRate ?? "unavailable"}%`, `Warnings: ${formatList(snapshot.detectors.abnormalWarnings as unknown[]) || "none"}`].join("\n");
    case "/pipeline":
      return [...header("Pipeline"), `evaluations -> ${pipeline.evaluations}`, `observations -> ${pipeline.observations}`, `hypotheses -> ${pipeline.hypotheses}`, `strategies -> ${pipeline.strategies}`, `experiments -> ${pipeline.experiments}`, `backtests -> ${pipeline.backtests}`, `verdicts -> ${pipeline.verdicts}`, `rankings -> ${pipeline.rankings}`, `forward eligible -> ${strategies.forwardEligible}`, `forward tests -> ${pipeline.forwardTests}`, `signals -> ${pipeline.signals}`, `EXPECTED GATE: disabled execution/signal flags stay locked unless explicitly configured.`, `UNEXPECTED FAILURE: ${snapshot.projectionError ?? "none"}`].join("\n");
    case "/research_blockers":
    case "/blockers":
    case "/config_blockers":
    case "/fallbacks":
    case "/limits":
      return formatBlockersTelegram(snapshot, command, header);
    case "/data":
      return [...header("Data"), `Provider reachability: ${snapshot.pnl.broker.degraded ? "degraded" : "available"}`, `Latest market data: ${snapshot.coverage.latestMarketDataTimestamp ?? "unavailable"}`, `Symbols receiving data: ${formatList(snapshot.coverage.coveredInstruments as unknown[])}`, `Timeframes: ${formatObject(snapshot.coverage.timeframeDistribution as Record<string, unknown>)}`, `Synthetic/demo data: unavailable`, `Temporal integrity: enforced`, `Future-dated violations: unavailable`].join("\n");
    case "/trading":
      return [...header("Trading"), `Broker/environment: ${broker.source}`, `Execution: 🔒 live blocked; paper=${snapshot.runtime.paperExecutionEnabled ? "configured" : "disabled"}; demo=${snapshot.runtime.demoBrokerExecutionEnabled ? "configured" : "disabled"}`, `Orders submitted: ${broker.tradeCount}`, `Trades closed: ${broker.tradeCount}`, `Open trades/positions/pending orders: unavailable`, `Paper realized/unrealized: ${paper.realizedPnl}/${paper.unrealizedPnl}`, `Broker realized/unrealized: ${broker.realizedPnl}/${broker.unrealizedPnl}`, `Wins/losses: ${paper.winningTrades}/${paper.losingTrades}`, `Daily loss used: ${risk.percentageUsed}%`, `Kill switch: ${risk.killSwitch}`].join("\n");
    case "/risk":
      return [...header("Risk"), `Kill switch: ${risk.killSwitch}`, `Daily-loss breaker: ${risk.dailyLossCircuitBreaker}`, `Automation level: ${risk.automationLevel}`, `Accounting boundary: ${risk.accountingDayBoundary}`, `Realized loss current day: ${risk.realizedLossCurrentDay}`, `Configured limit: ${risk.configuredLimit}`, `Used: ${risk.percentageUsed}%`, `Last activation: ${risk.lastActivationTime}; source=${risk.lastActivationSource}`, `Execution gates: ${JSON.stringify(risk.executionGates)}`].join("\n");
    case "/health":
      return [...header("Health"), `Uptime: ${snapshot.runtime.uptimeSeconds}s; PID=${snapshot.runtime.pid}`, `PostgreSQL: ${snapshot.databaseBacked ? "healthy" : "degraded"}`, `Migration state: see /api/v2/status`, `Telegram polling: runtime health`, `Latest delivery: unavailable`, `OANDA/provider: ${broker.projectionError ? "degraded" : "available"}`, `Scheduler: ${snapshot.runtime.state}`, `Next cycle: ${research.nextCycle}`, `Leases/stale leases: unavailable`].join("\n");
    case "/daily":
      return [...header("Daily"), `Research: cycles=${research.cyclesCompleted}, observations=${research.observations}, strategies=${strategies.createdToday}`, `Coverage: ${coverageLine(snapshot.coverage)}`, `Backtests/rankings: ${pipeline.backtests}/${pipeline.rankings}`, `Best strategy: ${formatTopStrategy(strategies)}`, `OANDA activity: ${broker.realizedPnl} (${broker.projectionError ?? "available"})`, `P/L paper realized/unrealized: ${paper.realizedPnl}/${paper.unrealizedPnl}`, `Safety: kill=${risk.killSwitch}; dailyLoss=${risk.dailyLossCircuitBreaker}`, `Infrastructure: db=${snapshot.databaseBacked}; runtime=${snapshot.runtime.state}`, `Blockers: ${snapshot.blockers.length}`, `Conclusion: ${snapshot.degraded ? "🟡 degraded reporting requires review" : "🟢 expected state"}`].join("\n");
    case "/why":
      return formatWhy(snapshot, argument);
    default:
      return [...header("Operations"), "Use /status /research /coverage /strategies /leaderboard /strategy <id> /sessions /detectors /pipeline /blockers /data /trading /risk /health /daily /why <metric>"].join("\n");
  }
}

function mapCounts(row: Record<string, unknown>) {
  return Object.fromEntries(PIPELINE_TABLES.map(([key]) => [key, Number(row[key] ?? 0)]));
}

function countStatuses(rows: QueryResultRow[]) {
  const counts = Object.fromEntries(rows.map(row => [String(row.status), Number(row.count ?? 0)]));
  return { completed: counts.completed ?? 0, failed: counts.failed ?? 0, skipped: counts.skipped ?? 0, admitted: Object.values(counts).reduce((sum, value) => sum + value, 0) };
}

function detectorReasonSummary(rows: QueryResultRow[]) {
  const byStatus: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  for (const row of rows) {
    const status = String(row.status ?? "unknown");
    const reason = sanitizedDetectorReason(row.reason ?? status);
    const count = Number(row.count ?? 0);
    byStatus[status] = (byStatus[status] ?? 0) + count;
    byReason[reason] = (byReason[reason] ?? 0) + count;
  }
  return { byStatus, byReason };
}

function sanitizedDetectorReason(value: unknown) {
  const reason = String(value ?? "unknown").trim().toLowerCase();
  if (/^provider_http_(401|403|429|5xx)$/.test(reason)) return reason;
  if ([
    "provider_timeout",
    "provider_network",
    "insufficient_completed_candles",
    "invalid_candles",
    "incomplete_latest_candle",
    "session_gated",
    "unsupported_timeframe",
    "duplicate_suppressed",
    "cycle_budget",
    "provider_budget",
    "database_write_budget",
    "market_data_unavailable",
    "completed",
    "attempted",
    "failed",
    "skipped",
  ].includes(reason)) return reason;
  if (/401/.test(reason)) return "provider_http_401";
  if (/403/.test(reason)) return "provider_http_403";
  if (/429/.test(reason)) return "provider_http_429";
  if (/\b5\d\d\b/.test(reason)) return "provider_http_5xx";
  if (/timeout|abort/.test(reason)) return "provider_timeout";
  if (/network|fetch|econn|enotfound|eai_again|socket/.test(reason)) return "provider_network";
  if (/insufficient.*completed|completed.*insufficient/.test(reason)) return "insufficient_completed_candles";
  if (/insufficient/.test(reason)) return "insufficient_completed_candles";
  if (/invalid|missing mid|non-finite/.test(reason)) return "invalid_candles";
  if (/incomplete/.test(reason)) return "incomplete_latest_candle";
  if (/unsupported.*timeframe|granularity/.test(reason)) return "unsupported_timeframe";
  if (/duplicate/.test(reason)) return "duplicate_suppressed";
  return "market_data_unavailable";
}

function coverageFacts(rows: QueryResultRow[], env: NodeJS.ProcessEnv) {
  const configured = configuredPairs(env, rows);
  const observationsByPair = countsFromRows(rows, "symbol");
  const covered = Object.keys(observationsByPair);
  const missing = configured.filter(item => !covered.includes(item));
  const total = Object.values(observationsByPair).reduce((sum, value) => sum + value, 0);
  return {
    configuredInstruments: configured,
    coveredInstruments: covered,
    missingInstruments: missing,
    observationsByPair,
    timeframeDistribution: countsFromRows(rows, "timeframe"),
    detectorDistribution: countsFromRows(rows, "detector_id"),
    sessionDistribution: {},
    concentrationPercentages: Object.fromEntries(Object.entries(observationsByPair).map(([key, value]) => [key, total > 0 ? round(value / total * 100) : 0])),
    lowestCoveredPairs: Object.entries(observationsByPair).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([key, value]) => `${key}:${value}`),
    latestMarketDataTimestamp: "unavailable",
    warnings: missing.length ? [`${missing.length} configured instruments have no observations`] : [],
  };
}

function strategyFacts(strategies: Record<string, unknown>[], rankings: Record<string, unknown>[], now: Date) {
  const today = accountingPeriod("daily", now);
  const top = rankings.map((ranking, index) => ({ rank: ranking.rank ?? index + 1, strategyId: ranking.strategyId ?? ranking.id, symbol: ranking.symbol, session: ranking.session, family: ranking.family, score: ranking.score ?? ranking.compositeScore, tradeCount: ranking.tradeCount, winRate: ranking.winRate, profitFactor: ranking.profitFactor, expectancy: ranking.expectancy, maxDrawdown: ranking.maxDrawdown, status: ranking.status })).sort((left, right) => Number(left.rank ?? 999999) - Number(right.rank ?? 999999));
  return {
    total: strategies.length,
    createdToday: "unavailable",
    ranked: rankings.length,
    validationState: rankings.length ? "available" : "configured empty",
    byFamily: countBy(strategies, strategy => String(nested(strategy, "filters", "primaryFamily") ?? strategy.family ?? "unknown")),
    bySymbol: countMulti(strategies, strategy => arrayOfStrings(strategy.symbols)),
    bySession: countBy(strategies, strategy => String(firstArrayValue(nested(strategy, "sessionRestrictions", "sessionId")) ?? firstArrayValue(nested(strategy, "sessionRestrictions", "sessionGroup")) ?? strategy.session ?? "unknown")),
    byTimeframe: countMulti(strategies, strategy => arrayOfStrings(strategy.timeframes)),
    byRegime: countMulti(strategies, strategy => arrayOfStrings(strategy.supportedRegimes)),
    top,
    rejectedOrDemoted: top.filter(item => /reject|demote|blocked|paused/i.test(String(item.status ?? ""))).slice(0, 10),
    concentrationWarnings: concentrationWarnings(strategies.length),
    forwardEligible: rankings.filter(item => /eligible|approved|ranked/i.test(String(item.status ?? ""))).length,
    accountingPeriod: today,
  };
}

function pnlFromValues(period: ReturnType<typeof accountingPeriod>, values: number[], source: string, databaseBacked: boolean, brokerBacked: boolean, generatedAtUtc: string): PnlProjection {
  const wins = values.filter(value => value > 0);
  const losses = values.filter(value => value < 0);
  const grossProfit = round(wins.reduce((sum, value) => sum + value, 0));
  const grossLoss = round(Math.abs(losses.reduce((sum, value) => sum + value, 0)));
  return {
    periodType: period.type,
    periodStartUtc: period.startUtc,
    periodEndUtc: period.endUtc,
    presentationStart: period.presentationStart,
    presentationEnd: period.presentationEnd,
    realizedPnl: round(values.reduce((sum, value) => sum + value, 0)),
    unrealizedPnl: "unavailable",
    grossProfit,
    grossLoss,
    fees: "unavailable",
    tradeCount: values.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: values.length ? round(wins.length / values.length * 100) : null,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    source,
    databaseBacked,
    brokerBacked,
    degraded: false,
    generatedAtUtc,
  };
}

function unavailablePnl(period: ReturnType<typeof accountingPeriod>, source: string, databaseBacked: boolean, projectionError: string, generatedAtUtc: string): PnlProjection {
  return {
    periodType: period.type,
    periodStartUtc: period.startUtc,
    periodEndUtc: period.endUtc,
    presentationStart: period.presentationStart,
    presentationEnd: period.presentationEnd,
    realizedPnl: "unavailable",
    unrealizedPnl: "unavailable",
    grossProfit: "unavailable",
    grossLoss: "unavailable",
    fees: "unavailable",
    tradeCount: "unavailable",
    winningTrades: "unavailable",
    losingTrades: "unavailable",
    winRate: "unavailable",
    profitFactor: "unavailable",
    source,
    databaseBacked,
    brokerBacked: false,
    degraded: true,
    projectionError,
    generatedAtUtc,
  };
}

function unavailablePnlPeriods(periods: Record<AccountingPeriodType, ReturnType<typeof accountingPeriod>>, reason: string, generatedAtUtc: string) {
  return Object.fromEntries((Object.keys(periods) as AccountingPeriodType[]).map(type => [
    type,
    {
      paper: unavailablePnl(periods[type], "fincoach-paper", false, reason, generatedAtUtc),
      broker: unavailablePnl(periods[type], "oanda", false, "practice_broker_not_configured_for_read_only_reporting", generatedAtUtc),
    },
  ])) as Record<AccountingPeriodType, { paper: PnlProjection; broker: PnlProjection }>;
}

function emptyDurableFacts(reason: string): DurableFacts {
  const pipeline = Object.fromEntries(PIPELINE_TABLES.map(([key]) => [key, reason === "not_configured" ? "not configured" : "degraded"]));
  return {
    degraded: reason !== "not_configured",
    projectionError: reason === "not_configured" ? null : reason,
    pipeline,
    currentHour: pipeline,
    cycles: { completed: "unavailable", failed: "unavailable", skipped: "unavailable", admitted: "unavailable" },
    configuredPairs: [],
    session: { current: "unavailable" },
    coverage: { configuredInstruments: [], coveredInstruments: [], missingInstruments: [], observationsByPair: {}, timeframeDistribution: {}, detectorDistribution: {}, sessionDistribution: {}, concentrationPercentages: {}, lowestCoveredPairs: [], latestMarketDataTimestamp: "unavailable", warnings: [reason] },
    detectors: { total: "unavailable", attempted: "unavailable", completed: "unavailable", skipped: "unavailable", positiveObservations: "unavailable", positiveRate: "unavailable", duplicateSuppressed: "unavailable", duplicateRate: "unavailable", failed: "unavailable", failureRate: "unavailable", currentHourByStatus: {}, currentHourByReason: {}, supported: [], abnormalWarnings: [] },
    strategies: { total: "unavailable", createdToday: "unavailable", ranked: "unavailable", validationState: "unavailable", byFamily: {}, bySymbol: {}, bySession: {}, byTimeframe: {}, byRegime: {}, top: [], rejectedOrDemoted: [], concentrationWarnings: [], forwardEligible: "unavailable" },
  };
}

function buildBlockers(input: { durable: DurableFacts; config: V2RuntimeConfig | null; runtime: Record<string, unknown>; riskSnapshot: ReturnType<typeof executionRiskService.snapshot>; paperPnl: PnlProjection; brokerPnl: PnlProjection }) {
  const blockers: Array<Record<string, unknown>> = [];
  if (input.riskSnapshot.globalKillSwitch) blockers.push(blocker("critical", "risk", "Kill switch is active", "active", "inactive", "Operator must investigate and explicitly reset", false, "🔴"));
  if (!input.config?.forwardTestingEnabled) blockers.push(blocker("info", "forward-testing", "Forward testing is intentionally disabled", "false", "explicit true", "Leave disabled unless release policy changes", true, "🔒"));
  if (!input.config?.researchSignalEnabled) blockers.push(blocker("info", "signals", "Research signal creation is intentionally disabled", "false", "explicit true", "Leave disabled unless release policy changes", true, "🔒"));
  if (input.durable.projectionError) blockers.push(blocker("warning", "postgresql", "Durable reporting projection failed", input.durable.projectionError, "healthy SELECT projection", "Inspect PostgreSQL connectivity/schema", false, "🟡"));
  if (input.brokerPnl.projectionError) blockers.push(blocker("info", "broker", "Broker P/L is unavailable/degraded", input.brokerPnl.projectionError, "read-only broker report", "Configure read-only OANDA reporting only", true, "🟡"));
  return blockers;
}

function blocker(severity: string, component: string, reason: string, currentValue: unknown, requiredValue: unknown, nextAction: string, expected: boolean, status: string) {
  return { severity, component, reason, currentValue, requiredValue, nextAction, expected, status };
}

function safeRuntimeStatus() {
  try {
    return getFinCoachV2Runtime().status() as Record<string, unknown>;
  } catch {
    return { state: "unavailable" };
  }
}

function safeRuntimeConfig(env: NodeJS.ProcessEnv) {
  try {
    return loadV2RuntimeConfig(env).config;
  } catch {
    return null;
  }
}

function currentSession(now: Date) {
  const hour = now.getUTCHours();
  const current = hour >= 21 || hour < 6 ? "asia-pacific" : hour < 12 ? "london" : hour < 17 ? "new-york" : "rollover";
  return { current };
}

function configuredPairs(env: NodeJS.ProcessEnv, rows: QueryResultRow[]) {
  const raw = env.FINCOACH_V2_RESEARCH_SYMBOLS ?? env.FINCOACH_V2_SYMBOLS ?? env.FINCOACH_SYMBOLS;
  const configured = raw?.split(",").map(item => item.trim()).filter(Boolean) ?? [];
  if (configured.length) return Array.from(new Set(configured)).sort();
  return Array.from(new Set(rows.map(row => String(row.symbol ?? "")).filter(Boolean))).sort();
}

function countsFromRows(rows: QueryResultRow[], key: string) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = String(row[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + Number(row.count ?? 0);
  }
  return counts;
}

function countBy(items: Record<string, unknown>[], select: (item: Record<string, unknown>) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) counts[select(item)] = (counts[select(item)] ?? 0) + 1;
  return counts;
}

function countMulti(items: Record<string, unknown>[], select: (item: Record<string, unknown>) => string[]) {
  const counts: Record<string, number> = {};
  for (const item of items) for (const value of select(item)) counts[value || "unknown"] = (counts[value || "unknown"] ?? 0) + 1;
  return counts;
}

function concentrationWarnings(total: number) {
  return total === 0 ? ["configured empty"] : [];
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item)) : value ? [String(value)] : ["unknown"];
}

function firstArrayValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function nested(source: Record<string, unknown>, ...path: string[]) {
  let value: unknown = source;
  for (const key of path) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function numeric(value: unknown): number | null;
function numeric(value: unknown, fallback: number): number;
function numeric(value: unknown, fallback?: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback ?? null;
}

function numberEnv(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function formatList(values: unknown[]) {
  return values.length ? values.slice(0, 12).join(", ") : "none";
}

function formatObject(value?: Record<string, unknown>) {
  if (!value) return "none";
  const entries = Object.entries(value);
  return entries.length ? entries.slice(0, 8).map(([key, count]) => `${key}:${count}`).join(", ") : "none";
}

function coverageLine(value: Record<string, unknown>) {
  return `${(value.coveredInstruments as unknown[] | undefined)?.length ?? 0}/${(value.configuredInstruments as unknown[] | undefined)?.length ?? 0} instruments`;
}

function formatTopStrategy(strategies: Record<string, unknown>) {
  const top = (strategies.top as Array<Record<string, unknown>> | undefined)?.[0];
  return top ? `${top.strategyId ?? top.id ?? "unknown"} score=${top.score ?? "unavailable"}` : "none";
}

function formatBlockersTelegram(snapshot: ReportingSnapshot, command: string, header: (title: string) => string[]) {
  const title = command === "/fallbacks" ? "Provider/Data Fallbacks" : command === "/limits" ? "Configured Limits" : command === "/config_blockers" ? "Configuration Blockers" : "FinCoach Research Blockers";
  const filtered = snapshot.blockers.filter(item => {
    const kind = String(item.kind ?? "");
    if (command === "/fallbacks") return kind === "fallback" || kind === "dependency" || /broker|provider|data/i.test(String(item.component ?? item.reason ?? ""));
    if (command === "/limits") return kind === "limit" || /limit|budget|max|min|cap|timeout|lease|rate|threshold/i.test(String(item.code ?? item.reason ?? ""));
    if (command === "/config_blockers") return kind === "configuration" || /config|disabled|required|unset|missing/i.test(String(item.code ?? item.reason ?? ""));
    return true;
  });
  const lines = filtered.length ? filtered.slice(0, 12).map(item => {
    const scope = [item.symbol ? `symbol=${item.symbol}` : null, item.strategyId ? `strategy=${item.strategyId}` : null, item.cycleId ? `cycle=${item.cycleId}` : null, item.scope && typeof item.scope === "object" ? compactScope(item.scope as Record<string, unknown>) : null].filter(Boolean).join("; ");
    const current = item.currentValue ?? item.current_value ?? "unavailable";
    const required = item.limitValue ?? item.requiredValue ?? item.limit_value ?? "unavailable";
    const action = item.action ?? item.nextAction ?? "Inspect configuration and capacity before changing limits.";
    const config = item.configKey ? `; config=${item.configKey}=${item.configValueState ?? "N/A"}` : "";
    return `${item.status ?? "active"} [${item.severity ?? "warning"}] ${item.code ?? item.component ?? "blocker"}: ${item.reason}; current=${formatScalar(current)}; required=${formatScalar(required)}${config}; ${scope || "scope=global"}; ${item.expected ? "EXPECTED GATE" : "ABNORMAL FAILURE"}; action=${action}`;
  }) : ["No matching active blockers from canonical projection."];
  const counts = snapshot.operationalBlockers && typeof snapshot.operationalBlockers === "object" ? (snapshot.operationalBlockers.limitTriggeredCounts as Record<string, unknown> | undefined) : undefined;
  return [...header(title), ...lines, counts ? `Limit counts: ${JSON.stringify(counts)}` : null].filter(Boolean).join("\n");
}

function compactScope(scope: Record<string, unknown>) {
  return Object.entries(scope).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => `${key}=${value}`).join("; ");
}

function formatScalar(value: unknown) {
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatStrategyDetail(snapshot: ReportingSnapshot, argument: string) {
  const strategies = (snapshot.strategies.top as Array<Record<string, unknown>> | undefined) ?? [];
  const trimmed = argument.trim();
  const item = strategies.find((candidate, index) => String(index + 1) === trimmed || String(candidate.rank ?? "") === trimmed || String(candidate.strategyId ?? candidate.id ?? "").toLowerCase() === trimmed.toLowerCase() || String(candidate.symbol ?? "").toLowerCase() === trimmed.toLowerCase());
  return [`${item ? "🟢" : "🟡"} Strategy`, `Time: ${snapshot.presentationTimestamp}`, `Period: ${snapshot.periods.daily.presentationStart} -> ${snapshot.periods.daily.presentationEnd}`, item ? `ID: ${item.strategyId ?? item.id}` : `No ranked strategy matched '${trimmed || "empty"}'`, item ? `Family/session/symbol: ${item.family ?? "unknown"}/${item.session ?? "unknown"}/${item.symbol ?? "unknown"}` : null, item ? `Rank/score: ${item.rank ?? "unavailable"}/${item.score ?? "unavailable"}` : null, item ? `Trades/wins/losses: ${item.tradeCount ?? "unavailable"}/unavailable/unavailable` : null, item ? `WR/PF/expectancy/maxDD: ${item.winRate ?? "unavailable"}/${item.profitFactor ?? "unavailable"}/${item.expectancy ?? "unavailable"}/${item.maxDrawdown ?? "unavailable"}` : null, `Forward-test state: ${snapshot.runtime.forwardTestingEnabled ? "configured" : "🔒 disabled"}`, `Blockers: ${snapshot.blockers.length}`].filter(Boolean).join("\n");
}

function formatPeriodReport(snapshot: ReportingSnapshot, type: AccountingPeriodType) {
  const period = snapshot.periods[type];
  const pnl = snapshot.pnl.periods[type];
  return [
    `${snapshot.degraded ? "🟡" : "🟢"} ${type[0].toUpperCase()}${type.slice(1)}`,
    `Time: ${snapshot.presentationTimestamp}`,
    `Source: ${snapshot.source}; databaseBacked=${snapshot.databaseBacked}; degraded=${snapshot.degraded}`,
    `Period: ${period.presentationStart} -> ${period.presentationEnd}`,
    `Paper P/L realized/unrealized: ${pnl.paper.realizedPnl}/${pnl.paper.unrealizedPnl}`,
    `Paper gross profit/loss: ${pnl.paper.grossProfit}/${pnl.paper.grossLoss}; fees=${pnl.paper.fees}`,
    `Paper trades/wins/losses: ${pnl.paper.tradeCount}/${pnl.paper.winningTrades}/${pnl.paper.losingTrades}; WR=${pnl.paper.winRate ?? "unavailable"}; PF=${pnl.paper.profitFactor ?? "unavailable"}`,
    `Broker P/L realized/unrealized: ${pnl.broker.realizedPnl}/${pnl.broker.unrealizedPnl}`,
    `Broker source: ${pnl.broker.source}; brokerBacked=${pnl.broker.brokerBacked}; degraded=${pnl.broker.degraded}`,
  ].join("\n");
}

function formatWhy(snapshot: ReportingSnapshot, argument: string) {
  const metric = argument.trim() || "status";
  const lines = [`🟡 Why ${metric}`, `Time: ${snapshot.presentationTimestamp}`, `Source: ${snapshot.source}; databaseBacked=${snapshot.databaseBacked}`, `Period: ${snapshot.periods.daily.presentationStart} -> ${snapshot.periods.daily.presentationEnd}`];
  if (/forward/i.test(metric)) lines.push(`Intended configuration: ${snapshot.runtime.forwardTestingEnabled ? "enabled" : "🔒 intentionally disabled"}`, "Eligibility: requires ranked candidates and explicit forward-testing capacity.", "Blocked reason: safety flag is disabled unless explicitly enabled.");
  else if (/signal/i.test(metric)) lines.push(`Intended configuration: ${snapshot.runtime.researchSignalEnabled ? "enabled" : "🔒 intentionally disabled"}`, `Telegram publication: ${snapshot.runtime.telegramSignalPublicationEnabled ? "enabled" : "🔒 intentionally disabled"}`);
  else if (/pnl|trading/i.test(metric)) lines.push(`FinCoach paper P/L: ${snapshot.pnl.paper.realizedPnl}; source=${snapshot.pnl.paper.source}`, `Broker P/L: ${snapshot.pnl.broker.realizedPnl}; reason=${snapshot.pnl.broker.projectionError ?? "available"}`, "Zero is reported only when the source was queried successfully.");
  else if (/coverage|observation|cycle/i.test(metric)) lines.push(`Research counts: evaluations=${snapshot.research.evaluations}, observations=${snapshot.research.observations}`, `Provider/session/budget blockers: ${snapshot.blockers.map(item => item.reason).join("; ") || "none"}`);
  else if (/telegram/i.test(metric)) lines.push("Telegram command data is derived from the canonical operations-reporting projection.", "It does not maintain independent counters.");
  else lines.push(`Projection degraded: ${snapshot.degraded}`, `Blockers: ${snapshot.blockers.map(item => item.reason).join("; ") || "none"}`);
  return lines.join("\n");
}

export const operationsReportingService = new OperationsReportingService();

async function defaultBrokerHttp(url: string, init: { method: string; headers: Record<string, string> }) {
  return fetch(url, init);
}

function sanitizeError(message: string) {
  return message.replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]").replace(/(OANDA_API_TOKEN|TELEGRAM_BOT_TOKEN|DATABASE_URL)=?[^ \n]*/gi, "$1=[REDACTED]");
}
