export function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  const recent = values.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const diff = recent[i] - recent[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
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

export function scannerScore(closes) {
  if (!closes || closes.length < 55) {
    return { score: 0, label: "Za mało danych", sma20: null, sma50: null, rsi14: null, momentum24h: 0, vol: 0 };
  }

  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const r = rsi(closes, 14);
  const mom = pctChange(closes[Math.max(0, closes.length - 25)], closes.at(-1));
  const vol = volatility(closes, 24);

  let score = 50;
  if (s20 > s50) score += 15;
  else score -= 15;

  if (closes.at(-1) > s20) score += 10;
  else score -= 10;

  if (r >= 50 && r <= 70) score += 10;
  if (r > 75) score -= 12;
  if (r < 30) score += 5;

  if (mom > 0) score += Math.min(10, mom);
  else score += Math.max(-10, mom);

  if (vol > 2.5) score -= 5;

  score = Math.round(Math.max(0, Math.min(100, score)));
  let label = "NEUTRAL";
  if (score >= 70) label = "MOMENTUM";
  else if (score <= 35) label = "SŁABOŚĆ";

  return {
    score,
    label,
    sma20: s20,
    sma50: s50,
    rsi14: r,
    momentum24h: mom,
    vol,
  };
}
