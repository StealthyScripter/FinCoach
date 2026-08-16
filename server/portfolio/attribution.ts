import type { PortfolioPosition, PortfolioTransaction } from "./domain";

export function performanceAttribution(input: { positions: Array<PortfolioPosition & { currentPrice: number | null; sector?: string | null }>; transactions: PortfolioTransaction[] }) {
  const byPosition = input.positions.map((position) => {
    const price = position.currentPrice ?? position.averageCost;
    const pnl = (price - position.averageCost) * position.quantity;
    return { symbol: position.symbol, pnl: round(pnl), marketValue: round(price * position.quantity), assetClass: position.assetClass };
  });
  const byAssetClass = group(byPosition, "assetClass");
  const costDrag = round(input.transactions.reduce((sum, transaction) => sum + transaction.fee, 0));
  return { byPosition, byAssetClass, costDrag, winners: byPosition.filter((item) => item.pnl > 0), losers: byPosition.filter((item) => item.pnl < 0) };
}

function group(rows: Array<Record<string, unknown> & { pnl: number }>, key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const groupKey = String(row[key] ?? "unknown");
    acc[groupKey] = round((acc[groupKey] ?? 0) + row.pnl);
    return acc;
  }, {});
}

function round(value: number) {
  return Number(value.toFixed(4));
}
