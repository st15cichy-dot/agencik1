import assert from "node:assert/strict";
import {
  STRATEGY_GOVERNANCE_POLICY,
  strategyVersion,
  updateStrategyGovernance,
} from "../lib/strategy-governance.js";

function deepItem(overrides = {}) {
  return {
    symbol: "BTCUSDT",
    strategyId: "breakout",
    strategy: "Breakout",
    config: { lookback: 20, exitLookback: 10 },
    robustScore: 20,
    returnPct: 12,
    excessPct: 5,
    drawdownPct: -8,
    profitFactor: 1.8,
    wfPositive: 4,
    wfTotal: 5,
    parameterStabilityPct: 80,
    eligible: true,
    ...overrides,
  };
}

{
  const a = strategyVersion("breakout", { lookback: 20, exitLookback: 10 });
  const b = strategyVersion("breakout", { exitLookback: 10, lookback: 20 });
  const c = strategyVersion("breakout", { lookback: 40, exitLookback: 15 });
  assert.equal(a, b);
  assert.notEqual(a, c);
}

{
  let previous = null;
  let result;

  for (let i = 1; i <= 5; i += 1) {
    result = updateStrategyGovernance({
      previous,
      deep: [deepItem()],
      nowIso: `2026-10-01T0${i}:00:00.000Z`,
    });
    previous = result.governance;

    const record = result.governance.records[0];
    if (i === 1) assert.equal(record.lifecycle, "SHADOW");
    if (i === 3) assert.equal(record.lifecycle, "VALIDATED");
    if (i === 5) assert.equal(record.lifecycle, "ACTIVE");
  }

  assert.equal(result.governance.paperAuthority, false);
  assert.equal(result.governance.mode, "SHADOW_ONLY");
  assert.equal(result.governance.records[0].observations, 5);
  assert.equal(result.governance.records[0].passes, 5);
  assert.equal(result.governance.champions[0].champion.lifecycle, "ACTIVE");

  result = updateStrategyGovernance({
    previous,
    deep: [deepItem({ eligible: false })],
    nowIso: "2026-10-01T06:00:00.000Z",
  });
  previous = result.governance;
  assert.equal(result.governance.records[0].lifecycle, "ACTIVE");

  result = updateStrategyGovernance({
    previous,
    deep: [deepItem({ eligible: false })],
    nowIso: "2026-10-01T07:00:00.000Z",
  });
  previous = result.governance;
  assert.equal(result.governance.records[0].lifecycle, "DEGRADED");
  assert.ok(result.events.some((event) => event.type === "GOVERNANCE_DEGRADED"));

  result = updateStrategyGovernance({
    previous,
    deep: [deepItem({ eligible: false })],
    nowIso: "2026-10-01T08:00:00.000Z",
  });
  previous = result.governance;

  result = updateStrategyGovernance({
    previous,
    deep: [deepItem({ eligible: false })],
    nowIso: "2026-10-01T09:00:00.000Z",
  });
  assert.equal(result.governance.records[0].lifecycle, "RETIRED");
  assert.ok(result.events.some((event) => event.type === "GOVERNANCE_RETIRED"));
}

{
  let previous = null;

  for (let i = 0; i < 5; i += 1) {
    previous = updateStrategyGovernance({
      previous,
      deep: [deepItem()],
      nowIso: `2026-10-02T0${i}:00:00.000Z`,
    }).governance;
  }

  const challenger = deepItem({
    config: { lookback: 40, exitLookback: 15 },
    robustScore: 10,
  });

  const result = updateStrategyGovernance({
    previous,
    deep: [challenger],
    nowIso: "2026-10-02T06:00:00.000Z",
  });

  const champion = result.governance.champions[0];
  assert.equal(champion.champion.lifecycle, "ACTIVE");
  assert.equal(champion.challengers.length, 1);
  assert.equal(champion.challengers[0].lifecycle, "SHADOW");
}

{
  assert.equal(STRATEGY_GOVERNANCE_POLICY.paperAuthority, false);
}

console.log("strategy governance tests: OK");
