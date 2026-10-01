import assert from "node:assert/strict";
import {
  ALLOCATION_POLICY,
  pairCorrelation,
  buildAllocationIntelligence,
} from "../lib/allocation-intelligence.js";

function candlesFromReturns(symbolOffset, returns, start = 1_700_000_000_000) {
  let close = 100 + symbolOffset;
  const candles = [{
    time: start,
    open: close,
    high: close,
    low: close,
    close,
    volume: 100,
  }];

  for (let i = 0; i < returns.length; i += 1) {
    close *= 1 + returns[i];
    candles.push({
      time: start + (i + 1) * 3600_000,
      open: close,
      high: close * 1.002,
      low: close * 0.998,
      close,
      volume: 100,
    });
  }
  return candles;
}

const wave = Array.from({ length: 120 }, (_, i) =>
  Math.sin(i / 7) * 0.008 + Math.cos(i / 5) * 0.003
);
const sameWave = wave.map((x) => x);
const differentWave = Array.from({ length: 120 }, (_, i) =>
  Math.sin(i / 3 + 1.7) * 0.007 + Math.cos(i / 11) * 0.004
);

{
  const corr = pairCorrelation(
    candlesFromReturns(0, wave),
    candlesFromReturns(10, sameWave)
  );
  assert.equal(corr.sufficient, true);
  assert.ok(corr.correlation > 0.999);
}

function candidate(symbol, overrides = {}) {
  return {
    symbol,
    strategyId: "breakout",
    strategy: "Breakout",
    strategyVersion: `breakout@${symbol}`,
    robustScore: 25,
    returnToDrawdown: 1.5,
    excessPct: 6,
    drawdownPct: -7,
    profitFactor: 1.8,
    wfPositive: 4,
    wfTotal: 5,
    parameterStabilityPct: 80,
    eligible: true,
    paperReady: false,
    governance: {
      lifecycle: "SHADOW",
    },
    ...overrides,
  };
}

{
  const result = buildAllocationIntelligence({
    deep: [
      candidate("BTCUSDT", { robustScore: 40 }),
      candidate("ETHUSDT", { robustScore: 30 }),
      candidate("SOLUSDT", {
        robustScore: 20,
        strategyId: "rsi_mean_reversion",
        strategy: "RSI Mean Reversion",
      }),
    ],
    marketBySymbol: {
      BTCUSDT: { candles: candlesFromReturns(0, wave) },
      ETHUSDT: { candles: candlesFromReturns(5, sameWave) },
      SOLUSDT: { candles: candlesFromReturns(10, differentWave) },
    },
    portfolioEquityPln: 200,
    nowIso: "2026-10-01T12:00:00.000Z",
  });

  assert.equal(result.mode, "SHADOW_ONLY");
  assert.equal(result.paperAuthority, false);
  assert.ok(result.summary.selectedCandidates >= 1);
  assert.ok(result.summary.selectedCandidates <= 3);
  assert.ok(result.summary.grossWeightPct <= 100.0001);
  assert.ok(result.shadowBasket.every((x) => x.recommendedWeightPct <= 50.0001));

  const eth = result.rankedCandidates.find((x) => x.symbol === "ETHUSDT");
  assert.equal(eth.selected, false);
  assert.equal(eth.decision, "CORRELATION_HARD_LIMIT");

  const btcEth = result.pairwiseCorrelations.find(
    (x) =>
      (x.a === "BTCUSDT" && x.b === "ETHUSDT") ||
      (x.a === "ETHUSDT" && x.b === "BTCUSDT")
  );
  assert.equal(btcEth.flag, "HARD_CONCENTRATION");
}

{
  const result = buildAllocationIntelligence({
    deep: [candidate("BTCUSDT")],
    marketBySymbol: {
      BTCUSDT: { candles: candlesFromReturns(0, wave) },
    },
    portfolioEquityPln: 200,
  });

  assert.equal(result.summary.selectedCandidates, 1);
  assert.equal(result.shadowBasket[0].recommendedWeightPct, 50);
  assert.equal(result.shadowBasket[0].recommendedNotionalPln, 100);
  assert.equal(result.summary.cashWeightPct, 50);
  assert.equal(result.summary.referenceRiskPerTradePln, 1);
}

{
  const result = buildAllocationIntelligence({
    deep: [
      candidate("OLDUSDT", {
        governance: { lifecycle: "RETIRED" },
      }),
    ],
    marketBySymbol: {
      OLDUSDT: { candles: candlesFromReturns(0, wave) },
    },
    portfolioEquityPln: 200,
  });

  assert.equal(result.shadowBasket.length, 0);
  assert.equal(
    result.rankedCandidates[0].decision,
    "SHADOW_GOVERNANCE_RETIRED"
  );
  assert.equal(result.paperAuthority, false);
}

{
  const result = buildAllocationIntelligence({
    deep: [],
    marketBySymbol: {},
    portfolioEquityPln: 200,
  });
  assert.equal(result.summary.eligibleCandidates, 0);
  assert.ok(result.summary.warnings.includes("NO_DEEP_ELIGIBLE_CANDIDATES"));
  assert.equal(ALLOCATION_POLICY.paperAuthority, false);
}

console.log("allocation intelligence tests: OK");
