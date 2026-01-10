import { Candle, Indicators } from './utils/types';

/**
 * Calculate technical indicators (RSI, MACD, ADX, volume, momentum)
 * Based on NexusMeme patterns for consistent trading logic
 */
export class IndicatorCalculator {
  /**
   * Calculate RSI (Relative Strength Index)
   * Range: 0-100, >70 overbought, <30 oversold
   */
  static calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50; // Default neutral

    const deltas = [];
    for (let i = 1; i < closes.length; i++) {
      deltas.push(closes[i] - closes[i - 1]);
    }

    let gains = 0;
    let losses = 0;

    for (let i = 0; i < period; i++) {
      const delta = deltas[i];
      if (delta > 0) gains += delta;
      else losses += Math.abs(delta);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period; i < deltas.length; i++) {
      const delta = deltas[i];
      const gain = delta > 0 ? delta : 0;
      const loss = delta < 0 ? Math.abs(delta) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return Math.min(100, Math.max(0, rsi));
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  static calculateMACD(
    closes: number[],
    fast: number = 12,
    slow: number = 26,
    signal: number = 9
  ): { line: number; signal: number; histogram: number } {
    if (closes.length < slow + signal - 1) {
      return { line: 0, signal: 0, histogram: 0 };
    }

    // Calculate exponential moving averages
    const ema12 = this.calculateEMA(closes, fast);
    const ema26 = this.calculateEMA(closes, slow);

    const macdLine = ema12 - ema26;

    // Calculate signal line (EMA of MACD)
    const macdValues = [];
    for (let i = slow - 1; i < closes.length; i++) {
      const ema12sub = this.calculateEMA(closes.slice(0, i + 1), fast);
      const ema26sub = this.calculateEMA(closes.slice(0, i + 1), slow);
      macdValues.push(ema12sub - ema26sub);
    }

    const signalLine = this.calculateEMA(macdValues, signal);
    const histogram = macdLine - signalLine;

    return { line: macdLine, signal: signalLine, histogram };
  }

  /**
   * Calculate ADX (Average Directional Index)
   * Trend strength: <20 weak, 20-40 moderate, >40 strong
   */
  static calculateADX(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
  ): number {
    if (highs.length < period + 1) return 20; // Default weak trend

    const trueRanges = [];
    const plusDMs = [];
    const minusDMs = [];

    for (let i = 1; i < closes.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trueRanges.push(tr);

      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];

      let plusDM = 0;
      let minusDM = 0;

      if (upMove > downMove && upMove > 0) {
        plusDM = upMove;
      }
      if (downMove > upMove && downMove > 0) {
        minusDM = downMove;
      }

      plusDMs.push(plusDM);
      minusDMs.push(minusDM);
    }

    // Smooth the values
    let sumTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
    let sumPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
    let sumMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

    const adxValues = [];

    for (let i = period; i < closes.length; i++) {
      sumTR += trueRanges[i];
      sumPlusDM += plusDMs[i];
      sumMinusDM += minusDMs[i];

      const atrValue = sumTR / period;
      const plusDIValue = (sumPlusDM / atrValue) * 100;
      const minusDIValue = (sumMinusDM / atrValue) * 100;

      const diDiff = Math.abs(plusDIValue - minusDIValue);
      const diSum = plusDIValue + minusDIValue;

      const dx = diSum === 0 ? 0 : (diDiff / diSum) * 100;
      adxValues.push(dx);
    }

    if (adxValues.length === 0) return 20;

    // Calculate ADX as EMA of DX
    const adx = adxValues.slice(-period).reduce((a, b) => a + b, 0) / period;
    return Math.min(100, Math.max(0, adx));
  }

  /**
   * Calculate Exponential Moving Average
   */
  static calculateEMA(closes: number[], period: number): number {
    if (closes.length === 0) return 0;
    if (closes.length <= period) {
      return closes.reduce((a, b) => a + b) / closes.length;
    }

    const multiplier = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b) / period;

    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }

  /**
   * Calculate Simple Moving Average
   */
  static calculateSMA(values: number[], period: number): number {
    if (values.length < period) {
      return values.reduce((a, b) => a + b, 0) / values.length;
    }
    const recentValues = values.slice(-period);
    return recentValues.reduce((a, b) => a + b) / period;
  }

  /**
   * Calculate volume ratio (current vs average)
   */
  static calculateVolumeRatio(volumes: number[], period: number = 20): number {
    if (volumes.length === 0) return 1.0;

    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = this.calculateSMA(volumes, Math.min(period, volumes.length));

    return avgVolume > 0 ? currentVolume / avgVolume : 1.0;
  }

  /**
   * Calculate momentum (percentage change over period)
   */
  static calculateMomentum(closes: number[], period: number = 10): number {
    if (closes.length < period) return 0;

    const currentClose = closes[closes.length - 1];
    const previousClose = closes[closes.length - period - 1];

    return previousClose !== 0 ? ((currentClose - previousClose) / previousClose) * 100 : 0;
  }

  /**
   * Calculate all indicators from candle data
   */
  static calculateAllIndicators(candles: Candle[]): Indicators {
    if (candles.length === 0) {
      return {
        rsi: 50,
        macd: { line: 0, signal: 0, histogram: 0 },
        adx: 20,
        volumeRatio: 1.0,
        momentum1h: 0,
        momentum4h: 0,
        recentHigh: 0,
        recentLow: 0,
        ema200: 0,
      };
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);

    // Recent high/low (last 20 candles)
    const recentCandles = candles.slice(-20);
    const recentHigh = Math.max(...recentCandles.map((c) => c.high));
    const recentLow = Math.min(...recentCandles.map((c) => c.low));

    // Momentum for different periods
    const momentum1h = this.calculateMomentum(closes, Math.min(4, closes.length - 1)); // 1h = 4 x 15min
    const momentum4h = this.calculateMomentum(closes, Math.min(16, closes.length - 1)); // 4h = 16 x 15min

    return {
      rsi: this.calculateRSI(closes, 14),
      macd: this.calculateMACD(closes, 12, 26, 9),
      adx: this.calculateADX(highs, lows, closes, 14),
      volumeRatio: this.calculateVolumeRatio(volumes, 20),
      momentum1h,
      momentum4h,
      recentHigh,
      recentLow,
      ema200: this.calculateEMA(closes, 200),
    };
  }
}

export default IndicatorCalculator;
