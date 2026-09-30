import {
  DEFAULT_COSTS,
  runBacktest,
  strategyScore,
} from "./backtest";
import {
  annualizedVolatilityPct,
} from "./indicators";
import {
  STRATEGY_FAMILIES,
  currentSignal,
} from "./strategies";

export const BASE = "https://data-api.binance.vision";
export const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT",
  "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT",
];

export const PROFILES = {
  screen: {
    bars: 3000,
    finalOosPct: 0.30,
    minOosTrades: 5,
    minPositiveWfPct: 50,
    minParameterStabilityPct: 25,
    minProfitFactor: 1.05,
    maxDrawdownPct: -15,
    minExposureExcessPct: -2,
    purgeBars: 24,
    foldTestBars: 300,
    minTrainBars: 900,
  },
  deep: {
    bars: 5000,
    finalOosPct: 0.30,
    minOosTrades: 8,
    minPositiveWfPct: 60,
    minParameterStabilityPct: 40,
    minProfitFactor: 1.15,
    maxDrawdownPct: -12,
    minExposureExcessPct: 0,
    purgeBars: 24,
    foldTestBars: 400,
    minTrainBars: 1200,
  },
};

function configKey(config) {
  return JSON.stringify(config);
}

export async function fetchBars(symbol, total = 5000) {
  let rows = [];
  let endTime = null;

  while (rows.length < total) {
    const limit = Math.min(1000, total - rows.length);
    const suffix = endTime ? `&endTime=${endTime}` : "";
    const res = await fetch(
      `${BASE}/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit}${suffix}`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Binance klines ${res.status}${body ? ` — ${body.slice(0, 120)}` : ""}`);
    }

    const batch = await res.json();
    if (!batch.length) break;

    rows = [...batch, ...rows];
    endTime = batch[0][0] - 1;

    if (batch.length < limit) break;
  }

  const seen = new Set();
  const candles = rows
    .map((r) => ({
      time: r[0],
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .filter((c) => {
      if (seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    })
    .sort((a, b) => a.time - b.time);

  return candles.slice(-total);
}

function bestConfigOnTrain(train, family, minTrades) {
  const candidates = family.configs.map((config) => {
    const result = runBacktest(train, family.id, config, DEFAULT_COSTS);
    return {
      config,
      result,
      score: strategyScore(result, minTrades),
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function anchoredPurgedWalkForward(dev, family, profile) {
  const folds = [];
  const selections = new Map();

  let trainEnd = profile.minTrainBars;

  while (true) {
    const testStart = trainEnd + profile.purgeBars;
    const testEnd = testStart + profile.foldTestBars;
    if (testEnd > dev.length) break;

    const train = dev.slice(0, trainEnd);
    const test = dev.slice(testStart, testEnd);
    const best = bestConfigOnTrain(train, family, Math.max(4, Math.floor(profile.minOosTrades / 2)));
    const testResult = runBacktest(test, family.id, best.config, DEFAULT_COSTS);

    const key = configKey(best.config);
    selections.set(key, (selections.get(key) || 0) + 1);

    folds.push({
      trainBars: train.length,
      purgeBars: profile.purgeBars,
      testBars: test.length,
      config: best.config,
      trainScore: best.score,
      test: testResult,
    });

    trainEnd += profile.foldTestBars;
  }

  if (!folds.length) {
    const fallback = bestConfigOnTrain(dev, family, profile.minOosTrades);
    return {
      folds: [],
      chosenConfig: fallback.config,
      parameterStabilityPct: 0,
      positiveFolds: 0,
      beatExposureBenchmarkFolds: 0,
      totalFolds: 0,
    };
  }

  const sortedSelections = [...selections.entries()].sort((a, b) => b[1] - a[1]);
  const chosenKey = sortedSelections[0][0];
  const chosenCount = sortedSelections[0][1];
  const chosenConfig = JSON.parse(chosenKey);

  const positiveFolds = folds.filter((f) => f.test.totalReturnPct > 0).length;
  const beatExposureBenchmarkFolds = folds.filter(
    (f) => f.test.excessVsExposureBenchmarkPct >= 0
  ).length;

  return {
    folds,
    chosenConfig,
    parameterStabilityPct: (chosenCount / folds.length) * 100,
    positiveFolds,
    beatExposureBenchmarkFolds,
    totalFolds: folds.length,
  };
}


function windowRegime(candles) {
  if (!candles.length) {
    return {
      regime: "UNKNOWN",
      volatility: "UNKNOWN",
      benchmarkPct: 0,
      volPct: 0,
    };
  }

  const first = candles[0].open;
  const last = candles.at(-1).close;
  const benchmarkPct = first > 0 ? ((last / first) - 1) * 100 : 0;
  const volPct = annualizedVolatilityPct(candles.map((c) => c.close));

  // 20-day windows. +/-5% separates directional moves from range.
  let regime = "RANGE";
  if (benchmarkPct >= 5) regime = "BULL";
  else if (benchmarkPct <= -5) regime = "BEAR";

  const volatility = volPct >= 75 ? "HIGH VOL" : "NORMAL VOL";

  return {
    regime,
    volatility,
    benchmarkPct,
    volPct,
  };
}

function historicalRegimeRobustness(candles, familyId, config) {
  const windowBars = 24 * 20; // 20 days
  const stepBars = 24 * 10;   // 10-day step
  const windows = [];

  for (let start = 0; start + windowBars <= candles.length; start += stepBars) {
    const slice = candles.slice(start, start + windowBars);
    const label = windowRegime(slice);
    const result = runBacktest(slice, familyId, config, DEFAULT_COSTS);

    windows.push({
      startTime: slice[0]?.time,
      endTime: slice.at(-1)?.time,
      ...label,
      result,
    });
  }

  const order = ["BULL", "BEAR", "RANGE"];
  const summary = order.map((regime) => {
    const xs = windows.filter((x) => x.regime === regime);

    if (!xs.length) {
      return {
        regime,
        windows: 0,
        avgMarketPct: null,
        avgStrategyPct: null,
        avgExcessPct: null,
        worstDrawdownPct: null,
        positiveWindows: 0,
        positivePct: null,
      };
    }

    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
      regime,
      windows: xs.length,
      avgMarketPct: avg(xs.map((x) => x.benchmarkPct)),
      avgStrategyPct: avg(xs.map((x) => x.result.totalReturnPct)),
      avgExcessPct: avg(xs.map((x) => x.result.excessVsExposureBenchmarkPct)),
      worstDrawdownPct: Math.min(...xs.map((x) => x.result.maxDrawdownPct)),
      positiveWindows: xs.filter((x) => x.result.totalReturnPct > 0).length,
      positivePct: (xs.filter((x) => x.result.totalReturnPct > 0).length / xs.length) * 100,
    };
  });

  return {
    diagnosticOnly: true,
    windowBars,
    stepBars,
    totalWindows: windows.length,
    summary,
  };
}

function buildGate(finalResult, wf, profile) {
  const requiredPositiveFolds = Math.max(
    1,
    Math.ceil(wf.totalFolds * profile.minPositiveWfPct / 100)
  );

  const checks = {
    oosReturnPositive: finalResult.totalReturnPct > 0,
    enoughOosTrades: finalResult.trades >= profile.minOosTrades,
    drawdownWithinLimit: finalResult.maxDrawdownPct >= profile.maxDrawdownPct,
    profitFactor: finalResult.profitFactor >= profile.minProfitFactor,
    exposureAdjustedEdge:
      finalResult.excessVsExposureBenchmarkPct >= profile.minExposureExcessPct,
    purgedWalkForward:
      wf.totalFolds >= 2 && wf.positiveFolds >= requiredPositiveFolds,
    parameterStability:
      wf.parameterStabilityPct >= profile.minParameterStabilityPct,
  };

  return {
    checks,
    passed: Object.values(checks).every(Boolean),
    passedCount: Object.values(checks).filter(Boolean).length,
    totalChecks: Object.keys(checks).length,
    requiredPositiveFolds,
  };
}

export async function analyzeSymbol(symbol, profileName = "deep") {
  const profile = PROFILES[profileName] || PROFILES.deep;
  const candles = await fetchBars(symbol, profile.bars);

  if (candles.length < Math.min(1500, profile.bars * 0.75)) {
    throw new Error(`Za mało danych: ${candles.length}/${profile.bars}`);
  }

  const finalBars = Math.max(600, Math.floor(candles.length * profile.finalOosPct));
  const dev = candles.slice(0, candles.length - finalBars);
  const finalOos = candles.slice(candles.length - finalBars);

  const ranking = STRATEGY_FAMILIES.map((family) => {
    const wf = anchoredPurgedWalkForward(dev, family, profile);
    const finalResult = runBacktest(
      finalOos,
      family.id,
      wf.chosenConfig,
      DEFAULT_COSTS
    );
    const regimeRobustness = historicalRegimeRobustness(
      candles,
      family.id,
      wf.chosenConfig
    );
    const signalNow = currentSignal(candles, family.id, wf.chosenConfig);
    const gate = buildGate(finalResult, wf, profile);

    const lowTradePenalty = finalResult.trades < profile.minOosTrades
      ? (profile.minOosTrades - finalResult.trades) * 5
      : 0;

    const robustScore =
      finalResult.totalReturnPct
      + finalResult.excessVsExposureBenchmarkPct * 0.65
      - Math.abs(finalResult.maxDrawdownPct) * 0.85
      + Math.min(3, finalResult.profitFactor) * 2
      + Math.max(-2, Math.min(3, finalResult.sharpe)) * 1.5
      + wf.parameterStabilityPct * 0.04
      + (wf.totalFolds ? (wf.positiveFolds / wf.totalFolds) * 6 : 0)
      - lowTradePenalty;

    return {
      id: family.id,
      name: family.name,
      config: wf.chosenConfig,
      final: finalResult,
      walkForward: wf,
      regimeRobustness,
      signalNow,
      gate,
      eligible: gate.passed,
      robustScore,
    };
  });

  ranking.sort((a, b) => b.robustScore - a.robustScore);

  const validated = ranking.filter((x) => x.eligible);
  const chosen = validated[0] || ranking[0];

  return {
    version: "0.5.1",
    profile: profileName,
    symbol,
    source: "Binance public market-data-only endpoint",
    bars: candles.length,
    developmentBars: dev.length,
    finalOosBars: finalOos.length,
    interval: "1h",
    costs: DEFAULT_COSTS,
    profileConfig: profile,
    ranking,
    candidate: {
      eligible: validated.length > 0,
      paperReady: profileName === "deep" && validated.length > 0 && chosen.signalNow === "LONG",
      screenPass: profileName === "screen" && validated.length > 0,
      signalNow: chosen.signalNow,
      strategyId: chosen.id,
      strategyName: chosen.name,
      config: chosen.config,
      gate: chosen.gate,
      usedFallbackTopStrategy: validated.length === 0,
    },
    generatedAt: new Date().toISOString(),
  };
}
