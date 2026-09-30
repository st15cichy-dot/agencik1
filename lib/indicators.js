export function smaAt(values, period, endIndex = values.length - 1) {
  if (!Array.isArray(values) || endIndex + 1 < period) return null;
  let sum = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i += 1) sum += values[i];
  return sum / period;
}

export function emaSeries(values, period) {
  if (!Array.isArray(values) || !values.length) return [];
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsiSeries(values, period = 14) {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses += Math.abs(d);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    const gain = Math.max(0, d);
    const loss = Math.max(0, -d);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function trueRange(candle, prevClose) {
  if (!candle) return 0;
  if (!Number.isFinite(prevClose)) return candle.high - candle.low;
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - prevClose),
    Math.abs(candle.low - prevClose)
  );
}

export function atrSeries(candles, period = 14) {
  const out = Array(candles.length).fill(null);
  if (candles.length <= period) return out;

  const trs = candles.map((c, i) => trueRange(c, i > 0 ? candles[i - 1].close : null));
  let seed = 0;
  for (let i = 1; i <= period; i += 1) seed += trs[i];

  let atr = seed / period;
  out[period] = atr;

  for (let i = period + 1; i < candles.length; i += 1) {
    atr = (atr * (period - 1) + trs[i]) / period;
    out[i] = atr;
  }
  return out;
}

export function pctChange(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return 0;
  return ((b - a) / a) * 100;
}

export function volatility(values, lookback = 24) {
  if (!Array.isArray(values) || values.length < 3) return 0;
  const v = values.slice(-Math.min(values.length, lookback + 1));
  const returns = [];
  for (let i = 1; i < v.length; i += 1) {
    if (v[i - 1] > 0) returns.push(Math.log(v[i] / v[i - 1]));
  }
  if (!returns.length) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

export function annualizedVolatilityPct(values) {
  if (!Array.isArray(values) || values.length < 3) return 0;
  const returns = [];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1] > 0) returns.push(Math.log(values[i] / values[i - 1]));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(24 * 365) * 100;
}

export function maxDrawdown(equity) {
  if (!equity.length) return 0;
  let peak = equity[0];
  let worst = 0;
  for (const x of equity) {
    peak = Math.max(peak, x);
    if (peak > 0) worst = Math.min(worst, ((x - peak) / peak) * 100);
  }
  return worst;
}

export function scannerScore(candles) {
  if (!candles || candles.length < 60) {
    return {
      score: 0, label: "ZA MAŁO DANYCH", sma20: null, sma50: null, rsi14: null,
      momentum24h: 0, vol: 0, atrPct: null,
    };
  }

  const closes = candles.map((x) => x.close);
  const s20 = smaAt(closes, 20);
  const s50 = smaAt(closes, 50);
  const rsi = rsiSeries(closes, 14).at(-1);
  const atr = atrSeries(candles, 14).at(-1);
  const mom = pctChange(closes[Math.max(0, closes.length - 25)], closes.at(-1));
  const vol = volatility(closes, 24);
  const atrPct = atr && closes.at(-1) ? (atr / closes.at(-1)) * 100 : null;

  let score = 50;
  score += s20 > s50 ? 15 : -15;
  score += closes.at(-1) > s20 ? 10 : -10;

  if (rsi >= 50 && rsi <= 70) score += 10;
  else if (rsi > 75) score -= 12;
  else if (rsi < 30) score += 4;

  score += Math.max(-10, Math.min(10, mom));
  if (vol > 3) score -= 5;

  score = Math.round(Math.max(0, Math.min(100, score)));

  let label = "NEUTRAL";
  if (score >= 70) label = "MOMENTUM";
  else if (score <= 35) label = "SŁABOŚĆ";

  return {
    score, label, sma20: s20, sma50: s50, rsi14: rsi,
    momentum24h: mom, vol, atrPct,
  };
}
