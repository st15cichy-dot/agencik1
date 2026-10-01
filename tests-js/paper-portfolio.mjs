import assert from "node:assert/strict";
import {
  PAPER_POLICY,
  canOpenNewPosition,
  closePaperPosition,
  defaultPaperState,
  normalizePaperState,
  openPaperPosition,
  paperSnapshot,
  refreshDayState,
  updateRiskFlags,
  updatePositionExcursions,
} from "../lib/paper-portfolio.js";

function approx(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`);
}

function openTestPosition(state, now, symbol = "TESTUSDT", rawPrice = 100, atrPct = 1) {
  return openPaperPosition(state, paperSnapshot(state, {}), {
    symbol,
    strategyId: "breakout",
    strategyName: "Breakout",
    config: { lookback: 20, exitLookback: 10 },
    rawPrice,
    atrPct,
    nowIso: now,
    deepMetrics: {},
  });
}

const now = "2026-10-01T00:00:00.000Z";

{
  const state = defaultPaperState(now);
  const opened = openTestPosition(state, now);
  assert.equal(opened.opened, true);
  assert.equal(state.openPositions.length, 1);
  assert.ok(opened.position.riskPln <= 1.0001);

  const notional = opened.position.notionalPln;
  const expectedEntryPrice = 100 * (1 + PAPER_POLICY.slippagePerSidePct / 100);
  approx(opened.position.entryPrice, expectedEntryPrice);

  const closed = closePaperPosition(state, opened.position.id, {
    rawExitPrice: 102,
    nowIso: "2026-10-01T02:00:00.000Z",
    reason: "TEST_EXIT",
  });
  assert.equal(closed.closed, true);
  assert.ok(closed.trade.pnlPln > 0);

  const expectedExitPrice = 102 * (1 - PAPER_POLICY.slippagePerSidePct / 100);
  const gross = notional * (expectedExitPrice / expectedEntryPrice);
  const expectedEntryFee = notional * (PAPER_POLICY.feePerSidePct / 100);
  const expectedExitFee = gross * (PAPER_POLICY.feePerSidePct / 100);
  approx(closed.trade.pnlPln, gross - expectedExitFee - notional - expectedEntryFee);
}

{
  const state = defaultPaperState(now);
  const result = openPaperPosition(state, paperSnapshot(state, {}), {
    symbol: "BADUSDT",
    strategyId: "breakout",
    strategyName: "Breakout",
    config: {},
    rawPrice: 0,
    atrPct: 1,
    nowIso: now,
  });
  assert.deepEqual(result, { opened: false, reason: "INVALID_PRICE" });
  assert.equal(state.cashPln, 200);
}

{
  const state = defaultPaperState(now);
  state.cashPln = 195;
  const snap = paperSnapshot(state, {});
  updateRiskFlags(state, snap);
  assert.equal(state.dailyHalt, true);
  assert.equal(canOpenNewPosition(state, snap).reason, "DAILY_LOSS_HALT");
  refreshDayState(state, snap, "2026-10-02T00:01:00.000Z");
  assert.equal(state.dailyHalt, false);
}

{
  const state = defaultPaperState(now);
  state.peakEquityPln = 200;
  state.cashPln = 179;
  const snap = paperSnapshot(state, {});
  updateRiskFlags(state, snap);
  assert.equal(state.halted, true);
  assert.equal(state.haltReason, "HARD_DRAWDOWN_STOP");
}

{
  const state = defaultPaperState(now);
  state.openPositions = Array.from({ length: PAPER_POLICY.maxOpenPositions }, (_, i) => ({
    id: `P${i}`,
    symbol: `S${i}USDT`,
    side: "LONG",
    entryMarketPrice: 100,
    entryPrice: 100,
    stopPrice: 98,
    notionalPln: 10,
    riskPln: 0.2,
    entryFeePln: 0,
    lastMarketPrice: 100,
    openedAt: now,
    maxHoldUntil: "2026-10-08T00:00:00.000Z",
  }));
  const snap = paperSnapshot(state, { S0USDT: 100, S1USDT: 100, S2USDT: 100 });
  assert.equal(canOpenNewPosition(state, snap).reason, "MAX_OPEN_POSITIONS");
}

{
  const state = defaultPaperState(now);
  state.cashPln = 0;
  state.openPositions = [{
    id: "FULL",
    symbol: "FULLUSDT",
    side: "LONG",
    entryMarketPrice: 100,
    entryPrice: 100,
    stopPrice: 98,
    notionalPln: 200,
    riskPln: 4,
    entryFeePln: 0,
    lastMarketPrice: 100,
    openedAt: now,
    maxHoldUntil: "2026-10-08T00:00:00.000Z",
  }];
  const snap = paperSnapshot(state, { FULLUSDT: 100 });
  assert.equal(snap.grossExposurePct, 100);
  assert.equal(canOpenNewPosition(state, snap).reason, "MAX_GROSS_EXPOSURE");
}

{
  const state = normalizePaperState({
    startingCapitalPln: 200,
    cashPln: -500,
    totalFeesPln: -10,
    openPositions: [{
      id: "BROKEN",
      symbol: "BAD",
      side: "LONG",
      entryMarketPrice: 100,
      entryPrice: 100,
      stopPrice: 120,
      notionalPln: 50,
      riskPln: 1,
      openedAt: "invalid",
      maxHoldUntil: "invalid",
    }],
    lastUpdatedAt: "not-a-date",
  }, now);
  assert.equal(state.appVersion, "0.13.0");
  assert.equal(state.cashPln, 200);
  assert.equal(state.totalFeesPln, 0);
  assert.equal(state.openPositions.length, 0);
  assert.equal(state.lastUpdatedAt, now);
}

{
  const state = normalizePaperState({
    dayKey: "2026-10-01",
  }, now);
  assert.equal(state.dayKey, "2026-10-01");

  const invalid = normalizePaperState({
    dayKey: "not-a-day",
  }, now);
  assert.equal(invalid.dayKey, "2026-10-01");
}

{
  const state = defaultPaperState(now);
  const opened = openTestPosition(state, now, "MOVEUSDT", 100, 1);
  assert.equal(opened.opened, true);

  updatePositionExcursions(opened.position, [
    { high: 105, low: 98 },
    { high: 103, low: 99 },
  ]);

  assert.equal(opened.position.highestMarketPrice, 105);
  assert.equal(opened.position.lowestMarketPrice, 98);
  approx(opened.position.mfePct, 5);
  approx(opened.position.maePct, -2);

  const closed = closePaperPosition(state, opened.position.id, {
    rawExitPrice: 104,
    nowIso: "2026-10-01T04:00:00.000Z",
    reason: "TEST_EXIT",
  });

  assert.equal(closed.closed, true);
  approx(closed.trade.mfePct, 5);
  approx(closed.trade.maePct, -2);
  assert.ok(Number.isFinite(closed.trade.rMultiple));
}

{
  const state = defaultPaperState(now);
  const opened = openPaperPosition(state, paperSnapshot(state, {}), {
    symbol: "VERSIONUSDT",
    strategyId: "breakout",
    strategyName: "Breakout",
    strategyVersion: "breakout@abc123",
    config: { lookback: 20, exitLookback: 10 },
    rawPrice: 100,
    atrPct: 1,
    nowIso: now,
  });

  assert.equal(opened.opened, true);
  assert.equal(opened.position.strategyVersion, "breakout@abc123");

  const closed = closePaperPosition(state, opened.position.id, {
    rawExitPrice: 101,
    nowIso: "2026-10-01T02:00:00.000Z",
    reason: "TEST_EXIT",
  });

  assert.equal(closed.trade.strategyVersion, "breakout@abc123");
}

console.log("paper portfolio regression suite: OK");
