import type { PortfolioAccount, PortfolioAccountingSnapshot, PortfolioPosition, PortfolioQuote, PortfolioTransaction } from "./domain";

export function fillPrice(input: { side: "BUY" | "SELL"; quote: PortfolioQuote; conservativeSpreadBps: number; slippageBps: number }) {
  if (input.side === "BUY" && input.quote.ask) return round(input.quote.ask * (1 + input.slippageBps / 10_000));
  if (input.side === "SELL" && input.quote.bid) return round(input.quote.bid * (1 - input.slippageBps / 10_000));
  const spreadHalf = input.conservativeSpreadBps / 20_000;
  return round(input.side === "BUY" ? input.quote.last * (1 + spreadHalf + input.slippageBps / 10_000) : input.quote.last * (1 - spreadHalf - input.slippageBps / 10_000));
}

export function commission(tradeValue: number, input: { minFee: number; feeBps: number }) {
  return round(Math.max(input.minFee, Math.abs(tradeValue) * input.feeBps / 10_000));
}

export function nextPositionAfterFill(current: PortfolioPosition | null, input: { side: "BUY" | "SELL"; quantity: number; price: number; now: Date }): { position: PortfolioPosition | null; realizedPnl: number } {
  const currentQuantity = current?.quantity ?? 0;
  if (input.side === "BUY") {
    const nextQuantity = currentQuantity + input.quantity;
    const averageCost = nextQuantity ? round(((current?.averageCost ?? 0) * currentQuantity + input.price * input.quantity) / nextQuantity) : input.price;
    return { position: { id: current?.id ?? "", portfolioId: current?.portfolioId ?? "", symbol: current?.symbol ?? "", assetClass: current?.assetClass ?? "etf", quantity: nextQuantity, averageCost, currency: "USD", updatedAt: input.now.toISOString() }, realizedPnl: 0 };
  }
  if (input.quantity > currentQuantity + 1e-8) throw new Error("portfolio_position_insufficient_quantity");
  const realizedPnl = round((input.price - (current?.averageCost ?? 0)) * input.quantity);
  const nextQuantity = round(currentQuantity - input.quantity);
  return { position: nextQuantity > 1e-8 && current ? { ...current, quantity: nextQuantity, updatedAt: input.now.toISOString() } : null, realizedPnl };
}

export function accountingSnapshot(input: {
  portfolio: PortfolioAccount;
  positions: Array<PortfolioPosition & { currentPrice: number | null }>;
  transactions: PortfolioTransaction[];
  now: Date;
}): PortfolioAccountingSnapshot {
  const marketValue = round(input.positions.reduce((sum, position) => sum + position.quantity * (position.currentPrice ?? position.averageCost), 0));
  const nav = round(input.portfolio.cash + marketValue);
  const realizedPnl = round(input.transactions.reduce((sum, transaction) => sum + transaction.realizedPnl, 0));
  const fees = round(input.transactions.reduce((sum, transaction) => sum + transaction.fee, 0));
  const unrealizedPnl = round(input.positions.reduce((sum, position) => sum + ((position.currentPrice ?? position.averageCost) - position.averageCost) * position.quantity, 0));
  const totalPnl = round(nav - input.portfolio.startingCapital);
  const dailyPnl = isWeekend(input.now) ? 0 : totalPnl;
  const monthlyPnl = totalPnl;
  const weeklyPnl = totalPnl;
  const turnover = round(input.transactions.reduce((sum, transaction) => sum + transaction.quantity * transaction.price, 0));
  return { portfolioId: input.portfolio.id, cash: round(input.portfolio.cash), marketValue, nav, realizedPnl, unrealizedPnl, totalPnl, dailyPnl, weeklyPnl, monthlyPnl, allTimePnl: totalPnl, dailyPct: pct(dailyPnl, input.portfolio.startingCapital), weeklyPct: pct(weeklyPnl, input.portfolio.startingCapital), monthlyPct: pct(monthlyPnl, input.portfolio.startingCapital), allTimePct: pct(totalPnl, input.portfolio.startingCapital), fees, turnover, observedAt: input.now.toISOString() };
}

function pct(value: number, base: number) {
  return base ? round(value / base * 100) : 0;
}

function isWeekend(now: Date) {
  const day = now.getUTCDay();
  return day === 0 || day === 6;
}

function round(value: number) {
  return Number(value.toFixed(4));
}
