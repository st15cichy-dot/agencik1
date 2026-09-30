import { maxDrawdown } from "./indicators";
import { prepareStrategy } from "./strategies";

export const DEFAULT_COSTS = {
  feePerSidePct: 0.10,
  slippagePerSidePct: 0.03,
};

function costMultiplier(costs) {
  return 1 - (costs.feePerSidePct + costs.slippagePerSidePct) / 100;
}

function calcSharpe(equity) {
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

export function runBacktest(candles, familyId, config, costs = DEFAULT_COSTS) {
  if (!candles || candles.length < 80) {
    return emptyResult("Za mało danych");
  }

  const strategy = prepareStrategy(candles, familyId, config);
  const oneSide = costMultiplier(costs);

  let cash = 1;
  let inPosition = false;
  let pending = null;
  let entryPrice = 0;
  let entryCash = 0;
  let entryTime = null;

  const trades = [];
  const equity = [1];

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];

    if (pending === "ENTER" && !inPosition) {
      entryPrice = c.open;
      entryCash = cash;
      entryTime = c.time;
      cash *= oneSide;
      inPosition = true;
      pending = null;
    } else if (pending === "EXIT" && inPosition) {
      const gross = c.open / entryPrice;
      cash *= gross * oneSide;
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
    cash *= gross * oneSide;
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

  return {
    totalReturnPct: (cash - 1) * 100,
    maxDrawdownPct: maxDrawdown(equity),
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    trades: trades.length,
    profitFactor,
    sharpe: calcSharpe(equity),
    recentTrades: trades.slice(-5),
    error: null,
  };
}

export function strategyScore(result) {
  if (!result || result.error || result.trades < 2) return -999;
  const returnTerm = result.totalReturnPct;
  const ddPenalty = Math.abs(result.maxDrawdownPct) * 0.8;
  const pfBonus = Math.min(4, result.profitFactor) * 2;
  const tradeBonus = Math.min(10, result.trades) * 0.25;
  return returnTerm - ddPenalty + pfBonus + tradeBonus;
}

export function emptyResult(error = null) {
  return {
    totalReturnPct: 0,
    maxDrawdownPct: 0,
    winRatePct: 0,
    trades: 0,
    profitFactor: 0,
    sharpe: 0,
    recentTrades: [],
    error,
  };
}
