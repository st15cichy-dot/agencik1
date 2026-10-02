import assert from "node:assert/strict";
import {
  SHADOW_EXECUTION_POLICY,
  buildShadowExecutionIntent,
  mergeShadowExecutionIntents,
  publicShadowExecutionSummary,
} from "../lib/shadow-execution.js";

const position = {
  id: "BTCUSDT-1",
  symbol: "BTCUSDT",
  side: "LONG",
  strategyId: "breakout",
  strategyName: "Breakout",
  strategyVersion: "breakout@test",
  entrySignalAt: "2026-10-01T10:00:00.000Z",
  entryMarketPrice: 100,
  entryPrice: 100.03,
  stopPrice: 98.0294,
  stopPct: 2,
  notionalPln: 50,
  riskPln: 1,
};

{
  const intent = buildShadowExecutionIntent(
    position,
    "2026-10-01T10:00:01.000Z"
  );

  assert.ok(intent);
  assert.equal(intent.intentId, "shadow:BTCUSDT-1");
  assert.equal(intent.executable, false);
  assert.equal(intent.safety.canSubmit, false);
  assert.equal(intent.broker, "NOT_CONNECTED");
  assert.equal(intent.brokerQuantity, null);
  assert.equal(intent.requestedNotionalPln, 50);
  assert.equal(intent.plannedRiskPln, 1);
  assert.ok(intent.blockers.includes("BROKER_NOT_CONNECTED"));
  assert.ok(intent.blockers.includes("ACCOUNT_QUOTE_FX_REQUIRED"));
}

{
  const intent = buildShadowExecutionIntent(position);
  const merged = mergeShadowExecutionIntents(
    [intent],
    [intent]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].executable, false);
  assert.equal(merged[0].safety.liveTrading, false);
}

{
  const invalid = buildShadowExecutionIntent({
    id: "BROKEN",
    symbol: "BTCUSDT",
    side: "LONG",
  });
  assert.equal(invalid, null);
}

{
  const intent = buildShadowExecutionIntent(position);
  const summary = publicShadowExecutionSummary([intent]);
  assert.equal(summary.mode, "SHADOW_NON_EXECUTABLE");
  assert.equal(summary.executable, false);
  assert.equal(summary.brokerConnected, false);
  assert.equal(summary.canSubmitOrders, false);
  assert.equal(summary.totalIntents, 1);
  assert.ok(
    summary.requiredBeforeAnyExecution.includes("SEPARATE_EXECUTION_SAFETY_REVIEW")
  );
}

assert.equal(SHADOW_EXECUTION_POLICY.canSubmitOrders, false);
assert.equal(SHADOW_EXECUTION_POLICY.brokerConnected, false);

console.log("shadow execution tests: OK");
