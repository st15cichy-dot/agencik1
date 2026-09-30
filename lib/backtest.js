import { maxDrawdown } from "./indicators.js";
import { prepareStrategy } from "./strategies.js";

export const DEFAULT_COSTS = {
  feePerSidePct: 0.10,
  slippagePerSidePct: 0.03,
};

function oneSideMultiplier(costs) {
  return 1 - (costs.feePerSidePct + costs.slippagePerSidePct) / 100;
}

function annualizedSharpe(equity) {
  if (equity.length < 3) return 0;
  const returns = [];
  for (let i = 1; i < equity.length; i += 1) {
    if (equity[i - 1] > 0) returns.push(equity[i] / equity[i - 1] - 1);
  }
  if (returns.length < 2) return 0;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const sd = Math.sqrt(variance);
  if (!sd) return 0;

  return (mean / sd) * Math.sqrt(24 * 365);
}

function annualizedReturnPct(endValue, bars) {
  const durationDays = bars / 24;

  // Do not annualize short samples into a misleading "Calmar".
  if (!Number.isFinite(endValue) || endValue <= 0 || durationDays < 180) return null;

  const years = durationDays / 365;
  return (Math.pow(endValue, 1 / years) - 1) * 100;
}

export function buyAndHoldReturnPct(candles, costs = DEFAULT_COSTS) {
  if (!candles || candles.length < 2) return 0;
  const side = oneSideMultiplier(costs);
  const gross = candles.at(-1).close / candles[0].open;
  return (gross * side * side - 1) * 100;
}

export function exposureAdjustedBenchmarkPct(benchmarkPct, exposurePct) {
  const base = 1 + benchmarkPct / 100;
  if (base <= 0) return benchmarkPct * (exposurePct / 100);
  const fraction = Math.max(0, Math.min(1, exposurePct / 100));
  return (Math.pow(base, fraction) - 1) * 100;
}

export function runBacktest(candles, familyId, config, costs = DEFAULT_COSTS) {
  if (!candles || candles.length < 80) return emptyResult("Za mało danych");

  const strategy = prepareStrategy(candles, familyId, config);
  const side = oneSideMultiplier(costs);

  let cash = 1;
  let inPosition = false;
  let pending = null;
  let entryPrice = 0;
  let entryCash = 0;
  let entryTime = null;
  let barsInMarket = 0;

  const trades = [];
  const equity = [1];

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];

    if (pending === "ENTER" && !inPosition) {
      entryPrice = c.open;
      entryCash = cash;
      entryTime = c.time;
      cash *= side;
      inPosition = true;
      pending = null;
    } else if (pending === "EXIT" && inPosition) {
      const gross = c.open / entryPrice;
      cash *= gross * side;
      trades.push({
        entryTime,
        exitTime: c.time,
        entry: entryPrice,
        exit: c.open,
        returnPct: ((cash / entryCash) - 1) * 100,
      });
      inPosition = false;
      pending = null;
      entryPrice = 0;
      entryCash = 0;
      entryTime = null;
    }

    if (inPosition) barsInMarket += 1;

    const marked = inPosition && entryPrice > 0
      ? cash * (c.close / entryPrice)
      : cash;
    equity.push(marked);

    if (i < candles.length - 1) {
      const sig = strategy.signal(i, inPosition);
      if (!inPosition && sig === "ENTER") pending = "ENTER";
      if (inPosition && sig === "EXIT") pending = "EXIT";
    }
  }

  if (inPosition && entryPrice > 0) {
    const last = candles.at(-1);
    const gross = last.close / entryPrice;
    cash *= gross * side;
    trades.push({
      entryTime,
      exitTime: last.time,
      entry: entryPrice,
      exit: last.close,
      returnPct: ((cash / entryCash) - 1) * 100,
    });
    equity.push(cash);
  }

  const wins = trades.filter((t) => t.returnPct > 0);
  const losses = trades.filter((t) => t.returnPct <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.returnPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.returnPct, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);

  const totalReturnPct = (cash - 1) * 100;
  const benchmarkPct = buyAndHoldReturnPct(candles, costs);
  const exposurePct = (barsInMarket / candles.length) * 100;
  const exposureBenchmarkPct = exposureAdjustedBenchmarkPct(benchmarkPct, exposurePct);
  const dd = maxDrawdown(equity);
  const durationDays = candles.length / 24;

  const annReturn = annualizedReturnPct(cash, candles.length);
  const calmar = annReturn != null && dd < 0
    ? annReturn / Math.abs(dd)
    : null;

  const returnToDrawdown = dd < 0
    ? totalReturnPct / Math.abs(dd)
    : (totalReturnPct > 0 ? 99 : 0);

  const sharpe = annualizedSharpe(equity);

  return {
    totalReturnPct,
    benchmarkPct,
    exposureBenchmarkPct,
    excessVsExposureBenchmarkPct: totalReturnPct - exposureBenchmarkPct,
    rawExcessVsBuyHoldPct: totalReturnPct - benchmarkPct,
    maxDrawdownPct: dd,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    trades: trades.length,
    profitFactor,
    sharpe,
    sharpeShortSample: durationDays < 90,
    calmar,
    annualizedReturnPct: annReturn,
    returnToDrawdown,
    exposurePct,
    durationDays,
    recentTrades: trades.slice(-5),
    error: null,
  };
}

export function strategyScore(result, minTrades = 8) {
  if (!result || result.error) return -999;

  const smallSamplePenalty = result.trades < minTrades
    ? (minTrades - result.trades) * 4
    : 0;

  const zeroTradePenalty = result.trades === 0 ? 100 : 0;
  const pfBonus = Math.min(3, result.profitFactor) * 2.5;
  const ddPenalty = Math.abs(result.maxDrawdownPct) * 0.85;
  const exposureExcessBonus = result.excessVsExposureBenchmarkPct * 0.55;

  // Cap Sharpe influence because annualized Sharpe is noisy on shorter windows.
  const sharpeBonus = Math.max(-1.5, Math.min(2.0, result.sharpe)) * 1.2;

  return (
    result.totalReturnPct
    - ddPenalty
    + pfBonus
    + exposureExcessBonus
    + sharpeBonus
    - smallSamplePenalty
    - zeroTradePenalty
  );
}

export function emptyResult(error = null) {
  return {
    totalReturnPct: 0,
    benchmarkPct: 0,
    exposureBenchmarkPct: 0,
    excessVsExposureBenchmarkPct: 0,
    rawExcessVsBuyHoldPct: 0,
    maxDrawdownPct: 0,
    winRatePct: 0,
    trades: 0,
    profitFactor: 0,
    sharpe: 0,
    sharpeShortSample: true,
    calmar: null,
    annualizedReturnPct: null,
    returnToDrawdown: 0,
    exposurePct: 0,
    durationDays: 0,
    recentTrades: [],
    error,
  };
}
