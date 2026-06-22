export class MarketDataMetrics {
  private ticksReceived = 0;
  private staleTicks = 0;
  private candlesClosed = 0;
  private strategyEvaluations = 0;
  private candidateSignals = 0;
  private paperTradesOpened = 0;
  private paperTradesClosed = 0;
  private postTradeReviews = 0;

  recordTick(stale: boolean) {
    this.ticksReceived += 1;
    if (stale) this.staleTicks += 1;
  }

  recordCandle() { this.candlesClosed += 1; }
  recordStrategyEvaluation(candidate: boolean) {
    this.strategyEvaluations += 1;
    if (candidate) this.candidateSignals += 1;
  }
  recordPaperOpen() { this.paperTradesOpened += 1; }
  recordPaperClose() { this.paperTradesClosed += 1; }
  recordReview() { this.postTradeReviews += 1; }

  snapshot() {
    return {
      ticksReceived: this.ticksReceived,
      staleTicks: this.staleTicks,
      candlesClosed: this.candlesClosed,
      strategyEvaluations: this.strategyEvaluations,
      candidateSignals: this.candidateSignals,
      paperTradesOpened: this.paperTradesOpened,
      paperTradesClosed: this.paperTradesClosed,
      postTradeReviews: this.postTradeReviews,
      productionOrdersPlaced: 0 as const,
    };
  }

  resetForTest() {
    this.ticksReceived = 0;
    this.staleTicks = 0;
    this.candlesClosed = 0;
    this.strategyEvaluations = 0;
    this.candidateSignals = 0;
    this.paperTradesOpened = 0;
    this.paperTradesClosed = 0;
    this.postTradeReviews = 0;
  }
}

export const marketDataMetrics = new MarketDataMetrics();
