import { DEFAULT_COSTS, runBacktest, strategyScore } from "./backtest";
import { STRATEGY_FAMILIES, currentSignal } from "./strategies";

export const BASE = "https://data-api.binance.vision";
export const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT",
  "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT",
];

export const GATES = {
  minOosTrades: 8,
  minPositiveFolds: 2,
  minTotalFolds: 3,
  minProfitFactor: 1.15,
  minOosReturnPct: 0,
  maxDrawdownPct: -12,
  minExcessReturnPct: 0,
};

export async function fetchBars(symbol, total = 1500) {
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
      config: best.config,
      testReturnPct: testResult.totalReturnPct,
      testBenchmarkPct: testResult.benchmarkPct,
      testExcessReturnPct: testResult.excessReturnPct,
      testMaxDrawdownPct: testResult.maxDrawdownPct,
      testTrades: testResult.trades,
      testProfitFactor: testResult.profitFactor,
    });
  }

  const positive = folds.filter((f) => f.testReturnPct > 0).length;
  const beatBenchmark = folds.filter((f) => f.testExcessReturnPct >= 0).length;

  return {
    folds,
    positiveFolds: positive,
    beatBenchmarkFolds: beatBenchmark,
    totalFolds: folds.length,
    stabilityPct: folds.length ? (positive / folds.length) * 100 : 0,
    benchmarkBeatPct: folds.length ? (beatBenchmark / folds.length) * 100 : 0,
  };
}

function gateResult(top) {
  const checks = {
    oosReturnPositive: top.test.totalReturnPct > GATES.minOosReturnPct,
    enoughTrades: top.test.trades >= GATES.minOosTrades,
    drawdownWithinLimit: top.test.maxDrawdownPct >= GATES.maxDrawdownPct,
    profitFactor: top.test.profitFactor >= GATES.minProfitFactor,
    walkForward: (
      top.walkForward.totalFolds >= GATES.minTotalFolds &&
      top.walkForward.positiveFolds >= GATES.minPositiveFolds
    ),
    beatsBenchmark: top.test.excessReturnPct >= GATES.minExcessReturnPct,
  };

  return {
    checks,
    passed: Object.values(checks).every(Boolean),
    passedCount: Object.values(checks).filter(Boolean).length,
    totalChecks: Object.keys(checks).length,
  };
}

export async function analyzeSymbol(symbol, bars = 1500) {
  const candles = await fetchBars(symbol, bars);
  const split = Math.floor(candles.length * 0.70);
  const train = candles.slice(0, split);
  const test = candles.slice(split);

  const ranking = STRATEGY_FAMILIES.map((family) => {
    const best = chooseBest(train, family);
    const testResult = runBacktest(test, family.id, best.config, DEFAULT_COSTS);
    const wf = walkForward(candles, family);
    const signalNow = currentSignal(candles, family.id, best.config);

    const lowTradePenalty = testResult.trades < GATES.minOosTrades
      ? (GATES.minOosTrades - testResult.trades) * 5
      : 0;

    const robustScore =
      testResult.totalReturnPct
      + testResult.excessReturnPct * 0.45
      - Math.abs(testResult.maxDrawdownPct) * 0.85
      + Math.min(3, testResult.profitFactor) * 2
      + wf.stabilityPct * 0.06
      + wf.benchmarkBeatPct * 0.04
      - lowTradePenalty;

    const row = {
      id: family.id,
      name: family.name,
      bestConfig: best.config,
      train: best.result,
      test: testResult,
      walkForward: wf,
      signalNow,
      robustScore,
    };

    const gate = gateResult(row);
    return {
      ...row,
      gate,
      eligible: gate.passed,
    };
  });

  ranking.sort((a, b) => b.robustScore - a.robustScore);

  // A lower-ranked strategy may pass all hard gates even if the raw-score leader does not.
  // Prefer the highest-scoring strategy that actually passes validation.
  const validated = ranking.filter((row) => row.eligible);
  const chosen = validated[0] || ranking[0];

  return {
    symbol,
    bars: candles.length,
    interval: "1h",
    trainBars: train.length,
    testBars: test.length,
    costs: DEFAULT_COSTS,
    gates: GATES,
    ranking,
    candidate: {
      eligible: validated.length > 0,
      signalNow: chosen.signalNow,
      strategyId: chosen.id,
      strategyName: chosen.name,
      config: chosen.bestConfig,
      gate: chosen.gate,
      paperReady: validated.length > 0 && chosen.signalNow === "LONG",
      usedFallbackTopStrategy: validated.length === 0,
    },
    generatedAt: new Date().toISOString(),
  };
}
