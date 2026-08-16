import { randomUUID } from "crypto";
import { Pool } from "pg";
import type { PortfolioAccount, PortfolioDecisionEvent, PortfolioOrder, PortfolioPosition, PortfolioStrategy, PortfolioTransaction } from "./domain";

export type PortfolioRepository = {
  listStrategies(): Promise<PortfolioStrategy[]>;
  saveStrategy(strategy: PortfolioStrategy): Promise<void>;
  getStrategy(id: string): Promise<PortfolioStrategy | null>;
  listPortfolios(): Promise<PortfolioAccount[]>;
  savePortfolio(portfolio: PortfolioAccount): Promise<void>;
  getPortfolio(id: string): Promise<PortfolioAccount | null>;
  listPositions(portfolioId: string): Promise<PortfolioPosition[]>;
  savePosition(position: PortfolioPosition): Promise<void>;
  saveOrder(order: PortfolioOrder): Promise<void>;
  listOrders(portfolioId: string, limit?: number): Promise<PortfolioOrder[]>;
  saveTransaction(transaction: PortfolioTransaction): Promise<void>;
  listTransactions(portfolioId: string, limit?: number): Promise<PortfolioTransaction[]>;
  addDecision(event: PortfolioDecisionEvent): Promise<void>;
  listDecisions(portfolioId?: string, limit?: number): Promise<PortfolioDecisionEvent[]>;
  saveNav(input: { portfolioId: string; nav: number; cash: number; marketValue: number; realizedPnl: number; unrealizedPnl: number; dailyPnl: number; weeklyPnl: number; source: string; stale: boolean; observedAt: string; idempotencyKey: string }): Promise<void>;
  navHistory(portfolioId: string, limit?: number): Promise<Array<{ observedAt: string; nav: number }>>;
};

export class InMemoryPortfolioRepository implements PortfolioRepository {
  private strategies = new Map<string, PortfolioStrategy>();
  private portfolios = new Map<string, PortfolioAccount>();
  private positions = new Map<string, PortfolioPosition>();
  private orders = new Map<string, PortfolioOrder>();
  private transactions = new Map<string, PortfolioTransaction>();
  private decisions: PortfolioDecisionEvent[] = [];
  private navRows: Array<{ portfolioId: string; observedAt: string; nav: number; idempotencyKey: string }> = [];

  async listStrategies() { return [...this.strategies.values()]; }
  async saveStrategy(strategy: PortfolioStrategy) { this.strategies.set(strategy.id, strategy); }
  async getStrategy(id: string) { return this.strategies.get(id) ?? null; }
  async listPortfolios() { return [...this.portfolios.values()]; }
  async savePortfolio(portfolio: PortfolioAccount) { this.portfolios.set(portfolio.id, portfolio); }
  async getPortfolio(id: string) { return this.portfolios.get(id) ?? null; }
  async listPositions(portfolioId: string) { return [...this.positions.values()].filter((item) => item.portfolioId === portfolioId); }
  async savePosition(position: PortfolioPosition) { this.positions.set(`${position.portfolioId}:${position.symbol}`, position); }
  async saveOrder(order: PortfolioOrder) { if (![...this.orders.values()].some((item) => item.idempotencyKey === order.idempotencyKey)) this.orders.set(order.id, order); }
  async listOrders(portfolioId: string, limit = 100) { return [...this.orders.values()].filter((item) => item.portfolioId === portfolioId).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, limit); }
  async saveTransaction(transaction: PortfolioTransaction) { if (![...this.transactions.values()].some((item) => item.idempotencyKey === transaction.idempotencyKey)) this.transactions.set(transaction.id, transaction); }
  async listTransactions(portfolioId: string, limit = 100) { return [...this.transactions.values()].filter((item) => item.portfolioId === portfolioId).sort((a, b) => b.executedAt.localeCompare(a.executedAt)).slice(0, limit); }
  async addDecision(event: PortfolioDecisionEvent) { if (!this.decisions.some((item) => item.id === event.id)) this.decisions.unshift(event); }
  async listDecisions(portfolioId?: string, limit = 100) { return this.decisions.filter((item) => !portfolioId || item.portfolioId === portfolioId).slice(0, limit); }
  async saveNav(input: { portfolioId: string; nav: number; observedAt: string; idempotencyKey: string }) {
    if (!this.navRows.some((row) => row.idempotencyKey === input.idempotencyKey)) this.navRows.push(input);
  }
  async navHistory(portfolioId: string, limit = 90) {
    return this.navRows.filter((row) => row.portfolioId === portfolioId).sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, limit).map((row) => ({ observedAt: row.observedAt, nav: row.nav }));
  }
}

export class PgPortfolioRepository implements PortfolioRepository {
  private readonly pool: Pool;
  constructor(databaseUrl = process.env.DATABASE_URL, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString: databaseUrl });
  }

  async listStrategies() {
    const result = await this.pool.query("SELECT * FROM portfolio_strategies ORDER BY risk_level, short_name");
    return result.rows.map(mapStrategy);
  }

  async saveStrategy(strategy: PortfolioStrategy) {
    await this.pool.query(
      `INSERT INTO portfolio_strategies
       (id, short_name, name, description, mandate, risk_level, risk_label, lifecycle_state, strategy_version, parent_strategy_id, research_hypothesis, parameters, benchmark_symbol, starting_capital, currency, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO NOTHING`,
      [strategy.id, strategy.shortName, strategy.name, strategy.description, strategy.mandate, strategy.riskLevel, strategy.riskLabel, strategy.lifecycleState, strategy.strategyVersion, strategy.parentStrategyId, strategy.researchHypothesis, JSON.stringify(strategy.parameters), strategy.benchmarkSymbol, strategy.startingCapital, strategy.currency, strategy.createdAt, strategy.updatedAt],
    );
  }

  async getStrategy(id: string) {
    const result = await this.pool.query("SELECT * FROM portfolio_strategies WHERE id = $1", [id]);
    return result.rows[0] ? mapStrategy(result.rows[0]) : null;
  }

  async listPortfolios() {
    const result = await this.pool.query("SELECT * FROM portfolios ORDER BY created_at");
    return result.rows.map(mapPortfolio);
  }

  async savePortfolio(portfolio: PortfolioAccount) {
    await this.pool.query(
      `INSERT INTO portfolios (id, strategy_id, starting_capital, cash, currency, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (strategy_id) DO UPDATE SET
         cash = EXCLUDED.cash,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [portfolio.id, portfolio.strategyId, portfolio.startingCapital, portfolio.cash, portfolio.currency, portfolio.status, portfolio.createdAt, portfolio.updatedAt],
    );
  }

  async getPortfolio(id: string) {
    const result = await this.pool.query("SELECT * FROM portfolios WHERE id = $1", [id]);
    return result.rows[0] ? mapPortfolio(result.rows[0]) : null;
  }

  async listPositions(portfolioId: string) {
    const result = await this.pool.query("SELECT * FROM portfolio_positions WHERE portfolio_id = $1 ORDER BY symbol", [portfolioId]);
    return result.rows.map(mapPosition);
  }

  async savePosition(position: PortfolioPosition) {
    await this.pool.query(
      `INSERT INTO portfolio_positions (id, portfolio_id, symbol, asset_class, quantity, average_cost, currency, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (portfolio_id, symbol) DO UPDATE SET quantity = EXCLUDED.quantity, average_cost = EXCLUDED.average_cost, updated_at = EXCLUDED.updated_at`,
      [position.id, position.portfolioId, position.symbol, position.assetClass, position.quantity, position.averageCost, position.currency, position.updatedAt],
    );
  }

  async saveOrder(order: PortfolioOrder) {
    await this.pool.query(
      `INSERT INTO portfolio_orders (id, portfolio_id, idempotency_key, side, symbol, asset_class, quantity, status, reason, submitted_at, filled_at, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [order.id, order.portfolioId, order.idempotencyKey, order.side, order.symbol, order.assetClass, order.quantity, order.status, order.reason, order.submittedAt, order.filledAt, JSON.stringify(order.evidence)],
    );
  }

  async listOrders(portfolioId: string, limit = 100) {
    const result = await this.pool.query("SELECT * FROM portfolio_orders WHERE portfolio_id = $1 ORDER BY submitted_at DESC LIMIT $2", [portfolioId, limit]);
    return result.rows.map(mapOrder);
  }

  async saveTransaction(transaction: PortfolioTransaction) {
    await this.pool.query(
      `INSERT INTO portfolio_transactions (id, portfolio_id, idempotency_key, side, symbol, asset_class, quantity, price, fee, realized_pnl, reason, evidence, executed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [transaction.id, transaction.portfolioId, transaction.idempotencyKey, transaction.side, transaction.symbol, transaction.assetClass, transaction.quantity, transaction.price, transaction.fee, transaction.realizedPnl, transaction.reason, JSON.stringify(transaction.evidence), transaction.executedAt],
    );
  }

  async listTransactions(portfolioId: string, limit = 100) {
    const result = await this.pool.query("SELECT * FROM portfolio_transactions WHERE portfolio_id = $1 ORDER BY executed_at DESC LIMIT $2", [portfolioId, limit]);
    return result.rows.map(mapTransaction);
  }

  async addDecision(event: PortfolioDecisionEvent) {
    await this.pool.query(
      `INSERT INTO portfolio_decision_journal
       (id, portfolio_id, strategy_id, event_type, symbol, reason, before_state, after_state, evidence, expected_effect, actual_effect, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [event.id, event.portfolioId, event.strategyId, event.eventType, event.symbol, event.reason, JSON.stringify(event.beforeState), JSON.stringify(event.afterState), JSON.stringify(event.evidence), JSON.stringify(event.expectedEffect), JSON.stringify(event.actualEffect), event.createdAt],
    );
  }

  async listDecisions(portfolioId?: string, limit = 100) {
    const result = portfolioId
      ? await this.pool.query("SELECT * FROM portfolio_decision_journal WHERE portfolio_id = $1 ORDER BY created_at DESC LIMIT $2", [portfolioId, limit])
      : await this.pool.query("SELECT * FROM portfolio_decision_journal ORDER BY created_at DESC LIMIT $1", [limit]);
    return result.rows.map(mapDecision);
  }

  async saveNav(input: { portfolioId: string; nav: number; cash: number; marketValue: number; realizedPnl: number; unrealizedPnl: number; dailyPnl: number; weeklyPnl: number; source: string; stale: boolean; observedAt: string; idempotencyKey: string }) {
    await this.pool.query(
      `INSERT INTO portfolio_nav_history
       (id, portfolio_id, idempotency_key, nav, cash, market_value, realized_pnl, unrealized_pnl, daily_pnl, weekly_pnl, source, stale, observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [randomUUID(), input.portfolioId, input.idempotencyKey, input.nav, input.cash, input.marketValue, input.realizedPnl, input.unrealizedPnl, input.dailyPnl, input.weeklyPnl, input.source, input.stale, input.observedAt],
    );
  }

  async navHistory(portfolioId: string, limit = 90) {
    const result = await this.pool.query("SELECT observed_at, nav FROM portfolio_nav_history WHERE portfolio_id = $1 ORDER BY observed_at DESC LIMIT $2", [portfolioId, limit]);
    return result.rows.map((row) => ({ observedAt: new Date(row.observed_at).toISOString(), nav: Number(row.nav) })).reverse();
  }
}

export function createPortfolioRepository(): PortfolioRepository {
  return process.env.DATABASE_URL ? new PgPortfolioRepository() : new InMemoryPortfolioRepository();
}

function mapStrategy(row: Record<string, unknown>): PortfolioStrategy {
  return {
    id: String(row.id),
    shortName: String(row.short_name),
    name: String(row.name),
    description: String(row.description),
    mandate: String(row.mandate) as PortfolioStrategy["mandate"],
    riskLevel: Number(row.risk_level),
    riskLabel: String(row.risk_label),
    lifecycleState: String(row.lifecycle_state) as PortfolioStrategy["lifecycleState"],
    strategyVersion: Number(row.strategy_version),
    parentStrategyId: row.parent_strategy_id ? String(row.parent_strategy_id) : null,
    researchHypothesis: String(row.research_hypothesis),
    parameters: typeof row.parameters === "object" && row.parameters ? row.parameters as Record<string, unknown> : {},
    benchmarkSymbol: String(row.benchmark_symbol),
    startingCapital: Number(row.starting_capital),
    currency: "USD",
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapPortfolio(row: Record<string, unknown>): PortfolioAccount {
  return { id: String(row.id), strategyId: String(row.strategy_id), startingCapital: Number(row.starting_capital), cash: Number(row.cash), currency: "USD", status: String(row.status) as PortfolioAccount["status"], createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
}

function mapPosition(row: Record<string, unknown>): PortfolioPosition {
  return { id: String(row.id), portfolioId: String(row.portfolio_id), symbol: String(row.symbol), assetClass: String(row.asset_class) as PortfolioPosition["assetClass"], quantity: Number(row.quantity), averageCost: Number(row.average_cost), currency: "USD", updatedAt: new Date(String(row.updated_at)).toISOString() };
}

function mapDecision(row: Record<string, unknown>): PortfolioDecisionEvent {
  return { id: String(row.id), portfolioId: row.portfolio_id ? String(row.portfolio_id) : null, strategyId: row.strategy_id ? String(row.strategy_id) : null, eventType: String(row.event_type), symbol: row.symbol ? String(row.symbol) : null, reason: String(row.reason), beforeState: object(row.before_state), afterState: object(row.after_state), evidence: object(row.evidence), expectedEffect: object(row.expected_effect), actualEffect: object(row.actual_effect), createdAt: new Date(String(row.created_at)).toISOString() };
}

function mapOrder(row: Record<string, unknown>): PortfolioOrder {
  return { id: String(row.id), portfolioId: String(row.portfolio_id), idempotencyKey: String(row.idempotency_key), side: String(row.side) as PortfolioOrder["side"], symbol: row.symbol ? String(row.symbol) : null, assetClass: row.asset_class ? String(row.asset_class) as PortfolioOrder["assetClass"] : null, quantity: row.quantity === null || row.quantity === undefined ? null : Number(row.quantity), status: String(row.status) as PortfolioOrder["status"], reason: String(row.reason), submittedAt: new Date(String(row.submitted_at)).toISOString(), filledAt: row.filled_at ? new Date(String(row.filled_at)).toISOString() : null, evidence: object(row.evidence) };
}

function mapTransaction(row: Record<string, unknown>): PortfolioTransaction {
  return { id: String(row.id), portfolioId: String(row.portfolio_id), idempotencyKey: String(row.idempotency_key), side: String(row.side) as PortfolioTransaction["side"], symbol: String(row.symbol), assetClass: String(row.asset_class) as PortfolioTransaction["assetClass"], quantity: Number(row.quantity), price: Number(row.price), fee: Number(row.fee), realizedPnl: Number(row.realized_pnl), reason: String(row.reason), evidence: object(row.evidence), executedAt: new Date(String(row.executed_at)).toISOString() };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
