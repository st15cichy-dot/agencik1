import assert from "node:assert/strict";
import { buildPortfolioAnalytics } from "../lib/portfolio-analytics.js";

const now = "2026-10-01T12:00:00.000Z";

const trades = [
  {
    id: "A",
    symbol: "BTCUSDT",
    strategyName: "Breakout",
    closedAt: "2026-10-01T10:00:00.000Z",
    pnlPln: 2,
    returnPct: 2,
    plannedRiskPln: 1,
    rMultiple: 2,
    holdingHours: 12,
    entryFeePln: 0.1,
    exitFeePln: 0.1,
    mfePct: 4,
    maePct: -1,
    reason: "STRATEGY_EXIT",
  },
  {
    id: "B",
    symbol: "SOLUSDT",
    strategyName: "Breakout",
    closedAt: "2026-09-30T10:00:00.000Z",
    pnlPln: -1,
    returnPct: -1,
    plannedRiskPln: 1,
    rMultiple: -1,
    holdingHours: 8,
    entryFeePln: 0.1,
    exitFeePln: 0.1,
    mfePct: 1,
    maePct: -2,
    reason: "STOP_LOSS",
  },
];

const analytics = buildPortfolioAnalytics({
  paperState: { startingCapitalPln: 200 },
  trades,
  history: [
    {
      at: "2026-10-01T08:00:00.000Z",
      paper: { equityPln: 199, totalPnlPln: -1, drawdownPct: -0.5 },
    },
    {
      at: "2026-10-01T10:00:00.000Z",
      paper: { equityPln: 201, totalPnlPln: 1, drawdownPct: 0 },
    },
  ],
  nowIso: now,
});

assert.equal(analytics.sampleStatus, "VERY_EARLY_SAMPLE");
assert.equal(analytics.stats.trades, 2);
assert.equal(analytics.stats.wins, 1);
assert.equal(analytics.stats.losses, 1);
assert.equal(analytics.stats.winRatePct, 50);
assert.equal(analytics.stats.totalPnlPln, 1);
assert.equal(analytics.stats.expectancyPln, 0.5);
assert.equal(analytics.stats.profitFactor, 2);
assert.equal(analytics.stats.avgRMultiple, 0.5);
assert.equal(analytics.stats.avgMfePct, 2.5);
assert.equal(analytics.stats.avgMaePct, -1.5);
assert.equal(analytics.stats.totalFeesPln, 0.4);
assert.equal(analytics.stats.maxObservedDrawdownPct, -0.5);
assert.equal(analytics.stats.riskBudgetUsedPln, 2);
assert.equal(analytics.stats.pnlPerRiskBudget, 0.5);
assert.equal(analytics.byStrategy[0].strategy, "Breakout");
assert.equal(analytics.bySymbol.length, 2);
assert.equal(analytics.exitReasons.length, 2);
assert.equal(analytics.rolling[0].trades, 2);
assert.equal(analytics.equityCurve.length, 2);
assert.equal(analytics.recentTrades[0].rMultiple, 2);

const empty = buildPortfolioAnalytics({
  paperState: { startingCapitalPln: 200 },
  trades: [],
  history: [],
  nowIso: now,
});
assert.equal(empty.sampleStatus, "NO_CLOSED_TRADES");
assert.equal(empty.stats.trades, 0);
assert.equal(empty.stats.profitFactor, null);
assert.deepEqual(empty.equityCurve, []);
assert.equal(empty.stats.currentEquityPln, null, "starting capital is not an observed equity value");
assert.equal(empty.stats.cashBaselinePnlPln, null);
assert.equal(empty.stats.maxObservedDrawdownPct, null);

function observed(history) {
  return buildPortfolioAnalytics({
    paperState: { startingCapitalPln: 200 }, trades: [], history, nowIso: now,
  });
}

for (const paper of [null, {}, { equityPln: -1 }, { equityPln: NaN }, { equityPln: "200" }]) {
  const report = observed([{ at: now, paper }]);
  assert.equal(report.stats.currentEquityPln, null, "invalid equity cannot become starting capital");
  assert.equal(report.stats.cashBaselinePnlPln, null);
  assert.equal(report.stats.maxObservedDrawdownPct, null);
}

for (const drawdownPct of [undefined, null, NaN, Infinity, "0", 1]) {
  const report = observed([{ at: now, paper: { equityPln: 201, drawdownPct } }]);
  assert.equal(report.stats.currentEquityPln, 201);
  assert.equal(report.stats.cashBaselinePnlPln, 1);
  assert.equal(report.stats.maxObservedDrawdownPct, null, "missing or invalid drawdown is unknown, not zero");
}

for (const drawdownPct of [0, -0.5, -10]) {
  const report = observed([{ at: now, paper: { equityPln: 200, drawdownPct } }]);
  assert.equal(report.stats.maxObservedDrawdownPct, drawdownPct);
}

const mixedObservations = observed([
  { at: "2026-10-01T11:00:00.000Z", paper: { equityPln: 203, drawdownPct: 2 } },
  { at: now, paper: null },
  { at: "2026-10-01T08:00:00.000Z", paper: { equityPln: 199, drawdownPct: -0.5 } },
  { at: "2026-10-01T09:00:00.000Z", paper: { equityPln: 200 } },
]);
assert.equal(mixedObservations.stats.currentEquityPln, 203, "use the latest valid observation regardless of input order");
assert.equal(mixedObservations.stats.cashBaselinePnlPln, 3);
assert.equal(mixedObservations.stats.maxObservedDrawdownPct, -0.5);

const zeroEquity = observed([{ at: now, paper: { equityPln: 0, drawdownPct: -100 } }]);
assert.equal(zeroEquity.stats.currentEquityPln, 0, "zero is an observed value, not missing data");
assert.equal(zeroEquity.stats.cashBaselinePnlPln, -200);
assert.equal(zeroEquity.stats.maxObservedDrawdownPct, -100);

console.log("portfolio analytics tests: OK");
