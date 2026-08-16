import { randomUUID } from "crypto";
import type { AssetClass, PortfolioOrder, PortfolioQuote, PortfolioTransaction } from "./domain";
import type { PortfolioMarketDataProvider } from "./marketData";
import type { PortfolioRepository } from "./repository";
import { canonicalInstrument } from "./instruments";
import { marketStatusForInstrument } from "./calendars";
import { commission, fillPrice, nextPositionAfterFill } from "./accounting";

export type VirtualBrokerConfig = {
  conservativeSpreadBps: number;
  slippageBps: number;
  minFee: number;
  feeBps: number;
};

export class VirtualPortfolioBroker {
  constructor(
    private readonly repository: PortfolioRepository,
    private readonly marketData: PortfolioMarketDataProvider,
    private readonly config: VirtualBrokerConfig = { conservativeSpreadBps: 20, slippageBps: 2, minFee: 1, feeBps: 5 },
  ) {}

  async submitOrder(input: { portfolioId: string; idempotencyKey: string; side: "BUY" | "SELL" | "HOLD"; symbol?: string; assetClass?: AssetClass; quantity?: number; reason: string; now?: Date }) {
    const now = input.now ?? new Date();
    const existing = (await this.repository.listOrders(input.portfolioId, 100)).find((order) => order.idempotencyKey === input.idempotencyKey);
    if (existing) return { ok: true as const, order: existing, idempotent: true };
    const portfolio = await this.repository.getPortfolio(input.portfolioId);
    if (!portfolio) return this.reject(input, "portfolio_not_found", now);
    if (input.side === "HOLD") {
      const order = await this.persistOrder(input, "filled", now, { action: "HOLD" });
      return { ok: true as const, order, idempotent: false };
    }
    if (!input.symbol || !input.assetClass || !input.quantity || input.quantity <= 0 || !Number.isFinite(input.quantity)) return this.reject(input, "invalid_quantity", now);
    const instrument = canonicalInstrument(input.symbol, { assetClass: input.assetClass });
    const marketStatus = marketStatusForInstrument(instrument, now);
    if (marketStatus.status !== "open") return this.reject(input, "market_closed", now, { marketStatus });
    const quote = await this.marketData.getQuote(input.symbol, input.assetClass, now);
    const price = fillPrice({ side: input.side, quote, conservativeSpreadBps: this.config.conservativeSpreadBps, slippageBps: this.config.slippageBps });
    const multiplier = instrument.contractMultiplier ?? 1;
    const tradeValue = input.quantity * price * multiplier;
    const fee = commission(tradeValue, this.config);
    if (input.side === "BUY" && portfolio.cash < tradeValue + fee) return this.reject(input, "insufficient_cash", now, { cash: portfolio.cash, required: tradeValue + fee });
    const positions = await this.repository.listPositions(portfolio.id);
    const current = positions.find((position) => position.symbol === input.symbol!.toUpperCase()) ?? null;
    let next;
    try {
      next = nextPositionAfterFill(current, { side: input.side, quantity: input.quantity, price, now });
    } catch (error) {
      return this.reject(input, error instanceof Error ? error.message : "position_check_failed", now);
    }
    const order = await this.persistOrder(input, "filled", now, { quote: safeQuote(quote), price, fee, marketStatus });
    if (next.position) {
      await this.repository.savePosition({ ...next.position, id: next.position.id || current?.id || randomUUID(), portfolioId: portfolio.id, symbol: input.symbol.toUpperCase(), assetClass: input.assetClass });
    }
    const cash = input.side === "BUY" ? portfolio.cash - tradeValue - fee : portfolio.cash + tradeValue - fee;
    await this.repository.savePortfolio({ ...portfolio, cash, updatedAt: now.toISOString() });
    const transaction: PortfolioTransaction = { id: randomUUID(), portfolioId: portfolio.id, idempotencyKey: `${input.idempotencyKey}:tx`, side: input.side, symbol: input.symbol.toUpperCase(), assetClass: input.assetClass, quantity: input.quantity, price, fee, realizedPnl: next.realizedPnl, reason: input.reason, evidence: { orderId: order.id, quoteSource: quote.source, fixture: quote.fixture, marketStatus }, executedAt: now.toISOString() };
    await this.repository.saveTransaction(transaction);
    return { ok: true as const, order, transaction, idempotent: false };
  }

  private async reject(input: { portfolioId: string; idempotencyKey: string; side: "BUY" | "SELL" | "HOLD"; symbol?: string; assetClass?: AssetClass; quantity?: number; reason: string }, reason: string, now: Date, evidence: Record<string, unknown> = {}) {
    const order = await this.persistOrder(input, "rejected", now, { reason, ...evidence });
    return { ok: false as const, reason, order };
  }

  private async persistOrder(input: { portfolioId: string; idempotencyKey: string; side: "BUY" | "SELL" | "HOLD"; symbol?: string; assetClass?: AssetClass; quantity?: number; reason: string }, status: PortfolioOrder["status"], now: Date, evidence: Record<string, unknown>) {
    const order: PortfolioOrder = { id: randomUUID(), portfolioId: input.portfolioId, idempotencyKey: input.idempotencyKey, side: input.side, symbol: input.symbol?.toUpperCase() ?? null, assetClass: input.assetClass ?? null, quantity: input.quantity ?? null, status, reason: input.reason, submittedAt: now.toISOString(), filledAt: status === "filled" ? now.toISOString() : null, evidence };
    await this.repository.saveOrder(order);
    return order;
  }
}

function safeQuote(quote: PortfolioQuote) {
  return { symbol: quote.symbol, observedAt: quote.observedAt, stale: quote.stale, source: quote.source, fixture: quote.fixture, last: quote.last, bid: quote.bid !== null ? "SET" : "EMPTY", ask: quote.ask !== null ? "SET" : "EMPTY" };
}
