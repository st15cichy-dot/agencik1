import { emaSeries, rsiSeries, smaAt } from "./indicators";

export const STRATEGY_FAMILIES = [
  {
    id: "sma_trend",
    name: "SMA Trend",
    configs: [
      { fast: 10, slow: 30 },
      { fast: 20, slow: 50 },
      { fast: 30, slow: 100 },
      { fast: 40, slow: 120 },
    ],
  },
  {
    id: "ema_momentum",
    name: "EMA Momentum",
    configs: [
      { fast: 8, slow: 21, rsiFloor: 50 },
      { fast: 12, slow: 26, rsiFloor: 50 },
      { fast: 20, slow: 50, rsiFloor: 52 },
      { fast: 21, slow: 55, rsiFloor: 50 },
    ],
  },
  {
    id: "rsi_mean_reversion",
    name: "RSI Mean Reversion",
    configs: [
      { entry: 25, exit: 50 },
      { entry: 30, exit: 52 },
      { entry: 35, exit: 55 },
      { entry: 38, exit: 58 },
    ],
  },
  {
    id: "breakout",
    name: "Breakout",
    configs: [
      { lookback: 20, exitLookback: 10 },
      { lookback: 40, exitLookback: 15 },
      { lookback: 55, exitLookback: 20 },
      { lookback: 72, exitLookback: 24 },
    ],
  },
];

function rollingMax(values, start, end) {
  let m = -Infinity;
  for (let i = start; i <= end; i += 1) m = Math.max(m, values[i]);
  return m;
}

function rollingMin(values, start, end) {
  let m = Infinity;
  for (let i = start; i <= end; i += 1) m = Math.min(m, values[i]);
  return m;
}

export function prepareStrategy(candles, familyId, config) {
  const closes = candles.map((x) => x.close);
  const highs = candles.map((x) => x.high);
  const lows = candles.map((x) => x.low);
  const rsi = rsiSeries(closes, 14);
  const emaFast = familyId === "ema_momentum" ? emaSeries(closes, config.fast) : null;
  const emaSlow = familyId === "ema_momentum" ? emaSeries(closes, config.slow) : null;

  function signal(i, inPosition) {
    if (i < 2) return inPosition ? "HOLD" : "FLAT";

    if (familyId === "sma_trend") {
      if (i + 1 < config.slow) return inPosition ? "HOLD" : "FLAT";
      const fast = smaAt(closes, config.fast, i);
      const slow = smaAt(closes, config.slow, i);
      const prevFast = smaAt(closes, config.fast, i - 1);
      const prevSlow = smaAt(closes, config.slow, i - 1);
      if (!inPosition && prevFast <= prevSlow && fast > slow) return "ENTER";
      if (inPosition && prevFast >= prevSlow && fast < slow) return "EXIT";
      return inPosition ? "HOLD" : "FLAT";
    }

    if (familyId === "ema_momentum") {
      if (i + 1 < Math.max(config.slow, 15)) return inPosition ? "HOLD" : "FLAT";
      const fast = emaFast[i];
      const slow = emaSlow[i];
      const prevFast = emaFast[i - 1];
      const prevSlow = emaSlow[i - 1];
      const rr = rsi[i];
      if (!inPosition && prevFast <= prevSlow && fast > slow && rr >= config.rsiFloor) return "ENTER";
      if (inPosition && ((prevFast >= prevSlow && fast < slow) || rr < 45)) return "EXIT";
      return inPosition ? "HOLD" : "FLAT";
    }

    if (familyId === "rsi_mean_reversion") {
      if (i + 1 < 25 || rsi[i] == null) return inPosition ? "HOLD" : "FLAT";
      const mean = smaAt(closes, 20, i);
      if (!inPosition && rsi[i] <= config.entry && closes[i] < mean) return "ENTER";
      if (inPosition && (rsi[i] >= config.exit || closes[i] > mean)) return "EXIT";
      return inPosition ? "HOLD" : "FLAT";
    }

    if (familyId === "breakout") {
      if (i < config.lookback + 1) return inPosition ? "HOLD" : "FLAT";
      const prevHigh = rollingMax(highs, i - config.lookback, i - 1);
      const prevLow = rollingMin(lows, i - config.exitLookback, i - 1);
      if (!inPosition && closes[i] > prevHigh) return "ENTER";
      if (inPosition && closes[i] < prevLow) return "EXIT";
      return inPosition ? "HOLD" : "FLAT";
    }

    return inPosition ? "HOLD" : "FLAT";
  }

  return { signal };
}

export function currentSignal(candles, familyId, config) {
  const strategy = prepareStrategy(candles, familyId, config);
  const i = candles.length - 1;
  return strategy.signal(i, false) === "ENTER" ? "LONG" : "FLAT";
}
