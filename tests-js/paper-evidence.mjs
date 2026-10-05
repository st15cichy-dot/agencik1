import assert from "node:assert/strict";
import { buildPaperEvidence } from "../lib/paper-evidence.js";
import { buildPortfolioAnalytics } from "../lib/portfolio-analytics.js";

const nowIso = "2026-10-05T12:00:00.000Z";
const dayMs = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.parse(nowIso) - days * dayMs).toISOString();

function trade(id, pnlPln = 1, fields = {}) {
  return {
    id,
    symbol: "BTCUSDT",
    strategyName: "Test strategy",
    openedAt: ago(1),
    closedAt: ago(0.5),
    pnlPln,
    returnPct: pnlPln,
    ...fields,
  };
}

function heartbeat(days, fields = {}) {
  return {
    at: ago(days),
    health: { status: "HEALTHY", score: 100 },
    paper: { equityPln: 200, totalPnlPln: 0, drawdownPct: 0 },
    ...fields,
  };
}

function analytics(fields = {}) {
  return buildPortfolioAnalytics({
    paperState: { startingCapitalPln: 200 },
    trades: [],
    history: [],
    nowIso,
    ...fields,
  });
}

function evidence(fields = {}) {
  return buildPaperEvidence({ nowIso, ...fields });
}

function assertDiagnosticOnly(value) {
  assert.equal(value.mode, "SHADOW_ONLY");
  for (const key of [
    "paperAuthority",
    "executable",
    "brokerConnected",
    "canSubmitOrders",
    "inferenceSupported",
    "liveReadiness",
  ]) {
    assert.equal(value[key], false, `${key} must remain false`);
  }
  assert.equal(value.brokerAdapter, "NONE");
  assert.equal(value.shadow.comparableToPaper, false);
  assert(value.windows.every((window) => window.completeCoverage === false));
  assert(Array.isArray(value.limitations));
  assert(value.limitations.length > 0);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

let checks = 0;
function check(name, run) {
  try {
    run();
    checks += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

check("empty evidence has no sample or execution authority", () => {
  const empty = evidence();
  assert.equal(empty.schemaVersion, 1);
  assert.equal(empty.generatedAt, nowIso);
  assert.equal(empty.status, "INSUFFICIENT_DATA");
  assert.equal(empty.closedTrades.retainedCount, 0);
  assert.equal(empty.closedTrades.validUniqueCount, 0);
  assert.equal(empty.history.validUniqueCount, 0);
  assert.equal(empty.shadow.simulatedFills, 0);
  assert.deepEqual(empty.windows.map((item) => item.days), [7, 30, 90]);
  for (const window of empty.windows) {
    assert.equal(window.closedTrades, 0);
    assert.equal(window.heartbeats, 0);
    assert.equal(window.equityPoints, 0);
    assert.equal(window.coverage, "NO_RETAINED_HISTORY");
  }
  assertDiagnosticOnly(empty);
  const stats = analytics().stats;
  assert.equal(stats.profitFactor, null);
  assert.equal(stats.profitFactorStatus, "NO_CLOSED_TRADES");
});

check("profit factor distinguishes no losses from measured ratios", () => {
  for (const trades of [[trade("one", 3)], [trade("a", 1), trade("b", 2)]]) {
    const report = analytics({ trades });
    assert.equal(report.stats.profitFactor, null);
    assert.equal(report.stats.profitFactorStatus, "NO_LOSING_TRADES");
    assert.equal(report.byStrategy[0].profitFactor, null);
    assert.equal(report.bySymbol[0].profitFactor, null);
    assert.equal(report.rolling[0].profitFactor, null);
    assert.equal(report.evidence.closedTrades.validUniqueCount, trades.length);
    assert.equal(report.evidence.status, "DESCRIPTIVE_ONLY");
    assertDiagnosticOnly(report.evidence);
  }
  const losses = analytics({ trades: [trade("loss-a", -1), trade("loss-b", -2)] });
  assert.equal(losses.stats.profitFactor, 0);
  assert.equal(losses.stats.profitFactorStatus, "AVAILABLE");
  const mixed = analytics({ trades: [trade("win", 4), trade("loss", -2)] });
  assert.equal(mixed.stats.profitFactor, 2);
  assert.equal(mixed.stats.profitFactorStatus, "AVAILABLE");
  const breakeven = analytics({ trades: [trade("zero", 0)] });
  assert.equal(breakeven.stats.profitFactor, null);
  assert.equal(breakeven.stats.profitFactorStatus, "NO_LOSING_TRADES");
});

check("a retained five day interval is partial in all advertised windows", () => {
  const result = evidence({
    trades: [trade("past", 2, { closedAt: ago(4), openedAt: ago(5) })],
    history: [heartbeat(0), heartbeat(5)],
  });
  assert.equal(result.history.observedSpanDays, 5);
  assert.equal(result.history.maxGapHours, 120);
  for (const window of result.windows) {
    assert.equal(window.closedTrades, 1);
    assert.equal(window.heartbeats, 2);
    assert.equal(window.equityPoints, 2);
    assert.equal(window.retainedSpanDays, 5);
    assert(Math.abs(window.spanCoveragePct - (5 / window.days) * 100) < 0.001);
    assert.equal(window.coverage, "PARTIAL_RETAINED_SPAN");
    assert.equal(window.completeCoverage, false);
  }
  assertDiagnosticOnly(result);
});

check("endpoints spanning a window cannot prove continuous coverage", () => {
  const result = evidence({ history: [heartbeat(100), heartbeat(0)] });
  for (const window of result.windows) {
    assert.equal(window.heartbeats, 1);
    assert.equal(window.retainedSpanDays, window.days);
    assert.equal(window.spanCoveragePct, 100);
    assert.equal(window.coverage, "RETAINED_SPAN_REACHES_WINDOW");
    assert.equal(window.completeCoverage, false);
  }
  assert.equal(result.history.maxGapHours, 2400);
  const stale = evidence({ history: [heartbeat(4), heartbeat(5)] });
  assert.equal(stale.windows[0].retainedSpanDays, 1);
  assert.equal(stale.windows[0].coverage, "PARTIAL_RETAINED_SPAN");
});

check("75 closures at one instant remain descriptive", () => {
  const trades = Array.from({ length: 75 }, (_, index) => trade(`one-time-${index}`));
  const report = analytics({ trades, history: [heartbeat(0.5)] });
  assert.equal(report.stats.trades, 75);
  assert.equal(report.sampleStatus, "LARGER_SAMPLE");
  assert.equal(report.evidence.closedTrades.observedSpanDays, 0);
  assert.equal(report.evidence.status, "DESCRIPTIVE_ONLY");
  assertDiagnosticOnly(report.evidence);
});

check("invalid, future and duplicate trade records do not inflate sample", () => {
  const first = trade("same", 3);
  const records = [
    first,
    trade("same", 300),
    trade("recovered", 1, { closedAt: "bad-date" }),
    trade("recovered", -1),
    trade("bad-date", 1, { closedAt: "not-a-time" }),
    trade("future", 1, { closedAt: ago(-1) }),
    trade("reverse", 1, { openedAt: nowIso, closedAt: ago(1) }),
    trade("bad-open", 1, { openedAt: null }),
    trade("bad-pnl", NaN),
    trade("bad-return", 1, { returnPct: Infinity }),
    trade(" ", 1),
    null,
    [],
  ];
  const result = evidence({ trades: records });
  assert.equal(result.closedTrades.retainedCount, 13);
  assert.equal(result.closedTrades.validUniqueCount, 2);
  assert.equal(result.closedTrades.duplicateCount, 1);
  assert.equal(result.closedTrades.invalidCount, 10);
  assert.equal(result.closedTrades.missingIdCount, 1);
  assert.equal(result.closedTrades.earliestClosedAt, first.closedAt);
  assert.equal(result.closedTrades.latestClosedAt, first.closedAt);
  assert(result.windows.every((window) => window.closedTrades === 2));
  const report = analytics({ trades: records });
  assert.equal(report.stats.trades, 2);
  assert.equal(report.stats.totalPnlPln, 2);
  assert.equal(report.stats.profitFactor, 3);
  assert.equal(report.recentTrades.length, 2);
  assert.equal(report.byStrategy[0].trades, 2);
  assert(report.rolling.every((window) => window.trades === 2));
  const noOpenTime = evidence({ trades: [{ id: "legacy", pnlPln: 1, returnPct: 1, closedAt: ago(1) }] });
  assert.equal(noOpenTime.closedTrades.validUniqueCount, 1);
  const equalTimes = evidence({ trades: [trade("same-time", 1, { openedAt: nowIso, closedAt: nowIso })] });
  assert.equal(equalTimes.closedTrades.validUniqueCount, 1);
});

check("optional metrics report missingness independently", () => {
  const result = evidence({
    trades: [
      trade("explicit", 2, {
        rMultiple: 2,
        plannedRiskPln: 1,
        holdingHours: 2,
        mfePct: 4,
        maePct: -2,
        entryFeePln: 0.1,
        exitFeePln: 0.2,
      }),
      trade("derived", -1, { plannedRiskPln: 2, holdingHours: 0, entryFeePln: 0 }),
      trade("missing", 0, { plannedRiskPln: 0, holdingHours: -1, mfePct: NaN, entryFeePln: -1, exitFeePln: 0 }),
    ],
  });
  const metrics = result.closedTrades.optionalMetrics;
  for (const key of ["rMultiple", "plannedRiskPln", "holdingHours"]) {
    assert.deepEqual(metrics[key], { availableCount: 2, missingCount: 1 });
  }
  for (const key of ["mfePct", "maePct", "fees"]) {
    assert.deepEqual(metrics[key], { availableCount: 1, missingCount: 2 });
  }
  assert.equal(result.closedTrades.validUniqueCount, 3);
  const invalidOptional = analytics({ trades: [trade("negative-optional", 1, {
    holdingHours: -4, entryFeePln: -3, exitFeePln: 0,
  })] });
  assert.equal(invalidOptional.stats.avgHoldingHours, null);
  assert.equal(invalidOptional.stats.totalFeesPln, 0);
  assert.equal(invalidOptional.evidence.closedTrades.optionalMetrics.fees.missingCount, 1);
});

check("heartbeat validity and optional data do not claim trades", () => {
  const result = evidence({
    history: [
      heartbeat(0),
      heartbeat(0),
      heartbeat(1, { health: null, paper: null }),
      heartbeat(2, { health: { status: "HEALTHY", score: "100" }, paper: { equityPln: -1 } }),
      { at: "not-a-time" },
      heartbeat(-1),
      null,
    ],
  });
  assert.equal(result.history.retainedCount, 7);
  assert.equal(result.history.validUniqueCount, 3);
  assert.equal(result.history.duplicateCount, 1);
  assert.equal(result.history.invalidCount, 3);
  assert.equal(result.history.equityPoints, 1);
  assert.equal(result.history.missingEquityCount, 2);
  assert.equal(result.history.missingHealthCount, 2);
  assert.equal(result.history.earliestAt, ago(2));
  assert.equal(result.history.latestAt, nowIso);
  assert.equal(result.closedTrades.validUniqueCount, 0);
  assert.equal(result.status, "INSUFFICIENT_DATA");
  const duplicateMissingEquity = analytics({
    history: [heartbeat(0, { paper: null }), heartbeat(0), heartbeat(-1)],
  });
  assert.equal(duplicateMissingEquity.evidence.history.validUniqueCount, 1);
  assert.equal(duplicateMissingEquity.evidence.history.equityPoints, 0);
  assert.deepEqual(duplicateMissingEquity.equityCurve, []);
});

check("repeated research heartbeats and backtest outputs cannot become closures", () => {
  const research = { ...heartbeat(0), backtest: { trades: 1000, returnPct: 300, profitFactor: 99 } };
  const history = Array.from({ length: 100 }, (_, index) => ({ ...research, at: ago(index / 24) }));
  const result = evidence({ trades: [trade("only-real-closure")], history });
  assert.equal(result.closedTrades.validUniqueCount, 1);
  assert.equal(result.history.validUniqueCount, 100);
  assert(result.windows.every((window) => window.closedTrades === 1));
  const report = analytics({ trades: [trade("only-real-closure")], history });
  assert.equal(report.stats.trades, 1);
  assert.equal(report.evidence.closedTrades.validUniqueCount, 1);
  assertDiagnosticOnly(result);
});

check("shadow fills are counted as simulations and excluded from PAPER returns", () => {
  const fill = { auditId: "quality:p1", intentId: "p1", at: ago(1), status: "SIMULATED", fillPrice: 101, quantity: 0.2 };
  const shadowAudit = [
    fill,
    { ...fill },
    { intentId: "p2", at: nowIso, status: "REJECTED" },
    { auditId: "future", at: ago(-1), status: "SIMULATED", fillPrice: 100, quantity: 1 },
    { auditId: "bad-fill", at: nowIso, status: "SIMULATED", fillPrice: 0, quantity: 1 },
    { auditId: "unknown", at: nowIso, status: "FILLED", fillPrice: 100, quantity: 1 },
    null,
  ];
  const report = analytics({ shadowAudit });
  const result = report.evidence;
  assert.equal(result.shadow.retainedCount, 7);
  assert.equal(result.shadow.simulatedFills, 1);
  assert.equal(result.shadow.rejections, 1);
  assert.equal(result.shadow.duplicateCount, 1);
  assert.equal(result.shadow.invalidCount, 4);
  assert.equal(result.shadow.earliestAt, ago(1));
  assert.equal(result.shadow.latestAt, nowIso);
  assert.equal(result.closedTrades.validUniqueCount, 0);
  assert.equal(report.stats.trades, 0);
  assert.equal(report.stats.totalPnlPln, 0);
  assert.equal(report.stats.profitFactor, null);
  assert.equal(result.shadow.comparableToPaper, false);
  assertDiagnosticOnly(result);
});

check("null and nonarray datasets fail closed without throwing", () => {
  for (const badArgument of [null, [], "invalid"]) {
    const result = buildPaperEvidence(badArgument);
    assert.equal(result.closedTrades.validUniqueCount, 0);
    assert.equal(result.history.validUniqueCount, 0);
    assertDiagnosticOnly(result);
    assert.equal(buildPortfolioAnalytics(badArgument).stats.trades, 0);
  }
  for (const bad of [null, {}, "not-an-array", 42]) {
    const result = evidence({ trades: bad, history: bad, shadowAudit: bad });
    assert.equal(result.closedTrades.validUniqueCount, 0);
    assert.equal(result.history.validUniqueCount, 0);
    assert.equal(result.shadow.simulatedFills, 0);
    assertDiagnosticOnly(result);
    const report = analytics({ trades: bad, history: bad, shadowAudit: bad });
    assert.equal(report.stats.trades, 0);
    assert.deepEqual(report.equityCurve, []);
  }
  const invalidClock = evidence({ nowIso: "invalid", trades: [trade("clock")], history: [heartbeat(0)] });
  assert.equal(invalidClock.generatedAt, null);
  assert.equal(invalidClock.closedTrades.validUniqueCount, 0);
  assert.equal(invalidClock.history.validUniqueCount, 0);
});

check("inputs remain unchanged and result is independent of input ordering", () => {
  const input = deepFreeze({
    nowIso,
    trades: [trade("older", 1, { openedAt: ago(6), closedAt: ago(5) }), trade("newer", -1)],
    history: [heartbeat(0), heartbeat(5), heartbeat(2)],
    shadowAudit: [{ intentId: "rejected", at: nowIso, status: "REJECTED" }],
  });
  const before = JSON.stringify(input);
  const report = buildPaperEvidence(input);
  analytics({ trades: input.trades, history: input.history, shadowAudit: input.shadowAudit });
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(buildPaperEvidence(input), report);
  const reordered = buildPaperEvidence({ ...input, trades: [...input.trades].reverse(), history: [...input.history].reverse() });
  assert.deepEqual(reordered, report);
  assertDiagnosticOnly(report);
});

console.log(`paper evidence tests: OK (${checks} scenarios)`);
