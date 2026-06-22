export type AnalysisCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  session?: string;
  spread?: number;
};

export type AnalysisToolReport = {
  symbol?: string;
  timestamp: string;
  movingAverages: {
    sma20: number | null;
    sma50: number | null;
  };
  momentum: {
    rsi14: number | null;
    macd: number | null;
    signal: number | null;
    histogram: number | null;
  };
  volatility: {
    atr14: number | null;
    bollingerUpper: number | null;
    bollingerMiddle: number | null;
    bollingerLower: number | null;
    breakout: "none" | "upside" | "downside";
  };
  structure: {
    trend: "uptrend" | "downtrend" | "range";
    support: number | null;
    resistance: number | null;
    sessionAllowed: boolean;
    spreadLiquidity: "good" | "watch" | "poor";
  };
};

export class AnalysisToolService {
  movingAverage(values: number[], period: number) {
    if (period <= 0 || values.length < period) return null;
    const window = values.slice(-period);
    return round(window.reduce((sum, value) => sum + value, 0) / period);
  }

  rsi(closes: number[], period = 14) {
    if (closes.length <= period) return null;
    let gains = 0;
    let losses = 0;
    for (let index = closes.length - period; index < closes.length; index += 1) {
      const delta = closes[index] - closes[index - 1];
      if (delta > 0) gains += delta;
      else losses += Math.abs(delta);
    }
    if (gains === 0 && losses === 0) return 50;
    const rs = losses === 0 ? Infinity : gains / losses;
    return round(100 - 100 / (1 + rs));
  }

  ema(values: number[], period: number) {
    if (values.length < period) return null;
    const multiplier = 2 / (period + 1);
    let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    for (const value of values.slice(period)) {
      result = (value - result) * multiplier + result;
    }
    return round(result);
  }

  macd(closes: number[]) {
    const fast = this.ema(closes, 12);
    const slow = this.ema(closes, 26);
    if (fast === null || slow === null) return { macd: null, signal: null, histogram: null };
    const macd = round(fast - slow);
    const signal = this.ema([...closes.slice(0, Math.max(0, closes.length - 1)), macd], 9);
    const histogram = signal === null ? null : round(macd - signal);
    return { macd, signal, histogram };
  }

  atr(candles: AnalysisCandle[], period = 14) {
    if (candles.length <= period) return null;
    const trueRanges = candles.slice(-period - 1).slice(1).map((candle, index) => {
      const previousClose = candles[candles.length - period - 1 + index].close;
      return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      );
    });
    return round(trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length);
  }

  bollingerBands(closes: number[], period = 20, deviationMultiplier = 2) {
    if (closes.length < period) return { upper: null, middle: null, lower: null };
    const window = closes.slice(-period);
    const middle = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period;
    const deviation = Math.sqrt(variance);
    return {
      upper: round(middle + deviationMultiplier * deviation),
      middle: round(middle),
      lower: round(middle - deviationMultiplier * deviation),
    };
  }

  volatilityBreakout(candles: AnalysisCandle[]) {
    if (candles.length < 2) return "none" as const;
    const latest = candles[candles.length - 1];
    const previous = candles[candles.length - 2];
    if (latest.close > previous.high) return "upside" as const;
    if (latest.close < previous.low) return "downside" as const;
    return "none" as const;
  }

  supportResistance(candles: AnalysisCandle[]) {
    if (candles.length === 0) return { support: null, resistance: null };
    const lows = candles.map((candle) => candle.low);
    const highs = candles.map((candle) => candle.high);
    return {
      support: round(Math.min(...lows)),
      resistance: round(Math.max(...highs)),
    };
  }

  trendClassification(candles: AnalysisCandle[]) {
    if (candles.length < 3) return "range" as const;
    const closes = candles.map((candle) => candle.close);
    const start = closes[0];
    const end = closes[closes.length - 1];
    const slope = (end - start) / start * 100;
    if (slope > 1) return "uptrend" as const;
    if (slope < -1) return "downtrend" as const;
    return "range" as const;
  }

  sessionFilter(candle: AnalysisCandle, allowedSessions: string[] = []) {
    if (allowedSessions.length === 0) return true;
    const session = candle.session?.trim().toLowerCase();
    return session ? allowedSessions.some((allowed) => allowed.toLowerCase() === session) : false;
  }

  spreadLiquidityCheck(candles: AnalysisCandle[], spreadPct?: number) {
    const atr = this.atr(candles);
    if (spreadPct === undefined || atr === null) return "watch" as const;
    const score = spreadPct / Math.max(atr, 0.0001);
    if (score < 0.08) return "good" as const;
    if (score < 0.15) return "watch" as const;
    return "poor" as const;
  }

  analyze(symbol: string | undefined, candles: AnalysisCandle[], options: { allowedSessions?: string[]; spreadPct?: number } = {}): AnalysisToolReport {
    const closes = candles.map((candle) => candle.close);
    const movingAverages = {
      sma20: this.movingAverage(closes, 20),
      sma50: this.movingAverage(closes, 50),
    };
    const momentum = {
      rsi14: this.rsi(closes, 14),
      ...this.macd(closes),
    };
    const bollinger = this.bollingerBands(closes);
    const atr14 = this.atr(candles);
    return {
      symbol,
      timestamp: new Date().toISOString(),
      movingAverages,
      momentum,
      volatility: {
        atr14,
        bollingerUpper: bollinger.upper,
        bollingerMiddle: bollinger.middle,
        bollingerLower: bollinger.lower,
        breakout: this.volatilityBreakout(candles),
      },
      structure: {
        trend: this.trendClassification(candles),
        ...this.supportResistance(candles),
        sessionAllowed: this.sessionFilter(candles[candles.length - 1] ?? { timestamp: "", open: 0, high: 0, low: 0, close: 0 }, options.allowedSessions),
        spreadLiquidity: this.spreadLiquidityCheck(candles, options.spreadPct),
      },
    };
  }
}

export const analysisToolService = new AnalysisToolService();

function round(value: number) {
  return Number(value.toFixed(6));
}
