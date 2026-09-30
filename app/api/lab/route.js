import { DEFAULT_COSTS, runBacktest, strategyScore } from "../../../lib/backtest";
import { STRATEGY_FAMILIES, currentSignal } from "../../../lib/strategies";

export const maxDuration = 30;

const BASE = "https://data-api.binance.vision";
const ALLOWED = new Set([
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT",
  "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT",
]);

async function fetchBars(symbol, total = 1500) {
  const firstLimit = Math.min(1000, total);
  const firstRes = await fetch(
    `${BASE}/api/v3/klines?symbol=${symbol}&interval=1h&limit=${firstLimit}`,
    { cache: "no-store" }
  );
  if (!firstRes.ok) throw new Error(`Binance klines ${firstRes.status}`);
  let rows = await firstRes.json();

  if (total > 1000 && rows.length) {
    const earliest = rows[0][0];
    const secondLimit = total - 1000;
    const secondRes = await fetch(
      `${BASE}/api/v3/klines?symbol=${symbol}&interval=1h&limit=${secondLimit}&endTime=${earliest - 1}`,
      { cache: "no-store" }
    );
    if (!secondRes.ok) throw new Error(`Binance klines ${secondRes.status}`);
    const older = await secondRes.json();
    rows = [...older, ...rows];
  }

  const seen = new Set();
  return rows
    .map((r) => ({
      time: r[0], open: Number(r[1]), high: Number(r[2]),
      low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]),
    }))
    .filter((c) => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}

function chooseBest(train, family) {
  const tested = family.configs.map((config) => {
    const result = runBacktest(train, family.id, config, DEFAULT_COSTS);
    return { config, result, score: strategyScore(result) };
  });
  tested.sort((a, b) => b.score - a.score);
  return tested[0];
}

function walkForward(candles, family) {
  const foldSize = 250;
  const trainSize = 500;
  const folds = [];

  for (let testStart = candles.length - foldSize * 3; testStart < candles.length; testStart += foldSize) {
    const trainStart = Math.max(0, testStart - trainSize);
    const train = candles.slice(trainStart, testStart);
    const test = candles.slice(testStart, Math.min(candles.length, testStart + foldSize));
    if (train.length < 300 || test.length < 100) continue;

    const best = chooseBest(train, family);
    const testResult = runBacktest(test, family.id, best.config, DEFAULT_COSTS);
    folds.push({
      trainFrom: train[0]?.time,
      trainTo: train.at(-1)?.time,
      testFrom: test[0]?.time,
      testTo: test.at(-1)?.time,
      config: best.config,
      trainReturnPct: best.result.totalReturnPct,
      testReturnPct: testResult.totalReturnPct,
      testMaxDrawdownPct: testResult.maxDrawdownPct,
      testTrades: testResult.trades,
    });
  }

  const positive = folds.filter((f) => f.testReturnPct > 0).length;
  return {
    folds,
    positiveFolds: positive,
    totalFolds: folds.length,
    stabilityPct: folds.length ? (positive / folds.length) * 100 : 0,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "BTCUSDT").toUpperCase();

  if (!ALLOWED.has(symbol)) {
    return Response.json({ error: "INVALID_SYMBOL" }, { status: 400 });
  }

  try {
    const candles = await fetchBars(symbol, 1500);
    const split = Math.floor(candles.length * 0.70);
    const train = candles.slice(0, split);
    const test = candles.slice(split);

    const families = STRATEGY_FAMILIES.map((family) => {
      const best = chooseBest(train, family);
      const testResult = runBacktest(test, family.id, best.config, DEFAULT_COSTS);
      const wf = walkForward(candles, family);
      const signalNow = currentSignal(candles, family.id, best.config);

      const robustScore =
        testResult.totalReturnPct
        - Math.abs(testResult.maxDrawdownPct) * 0.7
        + Math.min(4, testResult.profitFactor) * 2
        + wf.stabilityPct * 0.05
        + Math.min(8, testResult.trades) * 0.2;

      return {
        id: family.id,
        name: family.name,
        bestConfig: best.config,
        train: best.result,
        test: testResult,
        walkForward: wf,
        signalNow,
        robustScore,
      };
    });

    families.sort((a, b) => b.robustScore - a.robustScore);
    const top = families[0];

    const eligible =
      top.test.totalReturnPct > 0 &&
      top.test.maxDrawdownPct > -15 &&
      top.test.trades >= 2 &&
      top.walkForward.positiveFolds >= 2;

    return Response.json({
      symbol,
      source: "Binance public market-data-only endpoint",
      bars: candles.length,
      interval: "1h",
      trainBars: train.length,
      testBars: test.length,
      costs: DEFAULT_COSTS,
      ranking: families,
      candidate: {
        eligible,
        signalNow: top.signalNow,
        strategyId: top.id,
        strategyName: top.name,
        config: top.bestConfig,
        reason: eligible
          ? "Przeszedł bramki OOS i walk-forward do dalszego paper testu."
          : "Nie przeszedł wszystkich bramek jakości do paper testu.",
      },
      generatedAt: new Date().toISOString(),
      warning: "Wyniki historyczne i paper-gating nie przewidują przyszłych wyników.",
    });
  } catch (error) {
    return Response.json(
      { error: "LAB_UNAVAILABLE", detail: error.message },
      { status: 502 }
    );
  }
}
