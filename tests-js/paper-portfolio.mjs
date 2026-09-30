import assert from "node:assert/strict";
import {
  defaultPaperState,
  paperSnapshot,
  openPaperPosition,
  closePaperPosition,
  PAPER_POLICY,
} from "../lib/paper-portfolio.js";

const now = "2026-10-01T00:00:00.000Z";
const state = defaultPaperState(now);

let snap = paperSnapshot(state, {});
assert.equal(snap.equityPln, 200);

const opened = openPaperPosition(state, snap, {
  symbol: "TESTUSDT",
  strategyId: "breakout",
  strategyName: "Breakout",
  config: { lookback: 20, exitLookback: 10 },
  rawPrice: 100,
  atrPct: 1,
  nowIso: now,
  deepMetrics: {},
});

assert.equal(opened.opened, true);
assert.equal(state.openPositions.length, 1);
assert.ok(opened.position.notionalPln <= 100.0001);
assert.ok(opened.position.riskPln <= 1.0001);

snap = paperSnapshot(state, { TESTUSDT: 102 });
assert.ok(snap.equityPln > 200);

const closed = closePaperPosition(
  state,
  opened.position.id,
  {
    rawExitPrice: 102,
    nowIso: "2026-10-01T02:00:00.000Z",
    reason: "TEST_EXIT",
  }
);

assert.equal(closed.closed, true);
assert.equal(state.openPositions.length, 0);
assert.ok(closed.trade.pnlPln > 0);
assert.ok(state.cashPln > 200);

console.log("paper portfolio tests: OK", {
  policyRiskPct: PAPER_POLICY.riskPerTradePct,
  finalCash: state.cashPln,
  pnl: closed.trade.pnlPln,
});
