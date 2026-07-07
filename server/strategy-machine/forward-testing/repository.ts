import type { DemoTrade, ForwardTest } from "./contracts";

export class ForwardTestRepository {
  private readonly forwardTests = new Map<string, ForwardTest>();
  private readonly trades = new Map<string, DemoTrade>();

  saveForwardTest(forwardTest: ForwardTest) {
    this.forwardTests.set(forwardTest.forwardTestId, clone(forwardTest));
    return forwardTest;
  }

  saveTrade(trade: DemoTrade) {
    this.trades.set(trade.tradeId, clone(trade));
    return trade;
  }

  getForwardTest(id: string) {
    const item = this.forwardTests.get(id);
    return item ? clone(item) : null;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
