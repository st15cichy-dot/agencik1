import assert from "node:assert/strict";
import { buildShadowExecutionIntent } from "../lib/shadow-execution.js";
import { mapShadowInstrument } from "../lib/broker-mapping.js";
import {
  preflightShadowOrder,
  reconcileShadowOrder,
  buildShadowPreflightAudit,
} from "../lib/shadow-order-preflight.js";
import {
  simulateShadowFill,
  buildExecutionQualityMetrics,
  mergeExecutionQualityAudit,
} from "../lib/execution-quality.js";
import {
  SHADOW_DIAGNOSTIC_POLICY,
  DIAGNOSTIC_INSTRUMENT_SPECS,
  publicMarketExecutionInputs,
} from "../lib/shadow-diagnostic-fixtures.js";

const position = {
  id: "BTCUSDT-test-1",
  symbol: "BTCUSDT",
  side: "LONG",
  notionalPln: 100,
  riskPln: 1,
  entryMarketPrice: 100,
  entryPrice: 100.03,
  stopPrice: 99,
  stopPct: 1,
  strategyId: "breakout",
  strategyName: "Breakout",
  strategyVersion: "breakout@test",
  entrySignalAt: "2026-10-04T08:00:00.000Z",
};

const intent = buildShadowExecutionIntent(
  position,
  "2026-10-04T08:01:00.000Z"
);
assert.ok(intent);
assert.equal(intent.executable, false);

const instrument = mapShadowInstrument(
  intent.marketSymbol,
  DIAGNOSTIC_INSTRUMENT_SPECS
);
assert.equal(instrument.mapped, true);
assert.equal(instrument.executable, false);

const preflight = preflightShadowOrder({
  intent,
  instrument,
  plnPerQuoteUnit: SHADOW_DIAGNOSTIC_POLICY.plnPerQuoteUnit,
});
assert.equal(preflight.acceptedForSimulation, true);
assert.equal(preflight.executable, false);
assert.equal(preflight.canSubmitOrders, false);

const reconciliation = reconcileShadowOrder({
  preflight,
  simulatedExecution: {
    brokerSymbol: preflight.brokerSymbol,
    price: preflight.normalized.price,
    quantity: preflight.normalized.quantity,
  },
});
assert.equal(reconciliation.status, "SIMULATED_RECONCILED");
assert.equal(reconciliation.canSubmitOrders, false);

const audit = buildShadowPreflightAudit({
  preflight,
  reconciliation,
  at: "2026-10-04T08:02:00.000Z",
});
assert.equal(audit.executable, false);
assert.equal(audit.brokerAdapter, "NONE");

const candles = Array.from({ length: 50 }, (_, i) => {
  const close = 100 + Math.sin(i / 4) * 2 + i * 0.03;
  return {
    time: 1_700_000_000_000 + i * 3600_000,
    open: close,
    high: close * 1.003,
    low: close * 0.997,
    close,
    volume: 1000,
  };
});

const market = publicMarketExecutionInputs(candles);
assert.equal(market.source, "PUBLIC_OHLCV_PROXY");
assert.ok(market.samples > 0);

const fill = simulateShadowFill({
  preflight,
  strategyId: position.strategyId,
  market,
});
assert.equal(fill.status, "SIMULATED");
assert.equal(fill.executable, false);
assert.equal(fill.canSubmitOrders, false);
assert.equal(fill.brokerAdapter, "NONE");

const merged = mergeExecutionQualityAudit([], [{
  ...fill,
  auditId: "quality:shadow:BTCUSDT-test-1",
}]);
assert.equal(merged.length, 1);
assert.equal(merged[0].executable, false);

const metrics = buildExecutionQualityMetrics(merged);
assert.equal(metrics.fills, 1);
assert.equal(metrics.rejections, 0);
assert.equal(metrics.bySymbol.BTCUSDT.fills, 1);
assert.equal(metrics.byStrategy.breakout.fills, 1);

assert.equal(SHADOW_DIAGNOSTIC_POLICY.mode, "SHADOW_ONLY");
assert.equal(SHADOW_DIAGNOSTIC_POLICY.canSubmitOrders, false);
assert.equal(SHADOW_DIAGNOSTIC_POLICY.brokerAdapter, "NONE");

console.log("execution quality integration tests: OK");
