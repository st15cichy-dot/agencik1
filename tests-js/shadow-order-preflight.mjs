import assert from "node:assert/strict";
import {
  SHADOW_ORDER_PREFLIGHT_POLICY,
  preflightShadowOrder,
  reconcileShadowOrder,
  buildShadowPreflightAudit,
} from "../lib/shadow-order-preflight.js";

const instrument = {
  mapped: true,
  marketSymbol: "BTCUSDT",
  brokerSymbol: "SIM_BTCUSD",
  tickSize: 0.05,
  quantityStep: 0.01,
  minQuantity: 0.1,
  minNotional: 10,
};

const intent = {
  intentId: "shadow:test-1",
  marketSymbol: "BTCUSDT",
  referenceMarketPrice: 100.07,
  requestedNotionalPln: 100,
};

{
  const result = preflightShadowOrder({ intent, instrument, plnPerQuoteUnit: 4 });
  assert.equal(result.acceptedForSimulation, true);
  assert.equal(result.normalized.price, 100.05);
  assert.equal(result.normalized.quantity, 0.24);
  assert.equal(result.executable, false);
  assert.equal(result.canSubmitOrders, false);
  assert.equal(result.brokerAdapter, "NONE");

  const reconciliation = reconcileShadowOrder({
    preflight: result,
    simulatedExecution: { brokerSymbol: "SIM_BTCUSD", price: 100.05, quantity: 0.24 },
  });
  assert.equal(reconciliation.matched, true);
  assert.equal(reconciliation.status, "SIMULATED_RECONCILED");

  const audit = buildShadowPreflightAudit({
    preflight: result,
    reconciliation,
    at: "2026-10-03T00:00:00.000Z",
  });
  assert.equal(audit.at, "2026-10-03T00:00:00.000Z");
  assert.equal(audit.executable, false);
  assert.equal(audit.canSubmitOrders, false);
}

{
  const result = preflightShadowOrder({
    intent: { ...intent, requestedNotionalPln: 1 },
    instrument,
    plnPerQuoteUnit: 4,
  });
  assert.equal(result.acceptedForSimulation, false);
  assert.ok(result.rejectReasons.includes("BELOW_MINIMUM_QUANTITY"));
  assert.ok(result.rejectReasons.includes("BELOW_MINIMUM_NOTIONAL"));
}

{
  const result = preflightShadowOrder({ intent, instrument: { mapped: false }, plnPerQuoteUnit: 4 });
  assert.equal(result.acceptedForSimulation, false);
  assert.ok(result.rejectReasons.includes("INSTRUMENT_NOT_MAPPED"));
  assert.equal(result.executable, false);
}

{
  const result = preflightShadowOrder({ intent, instrument, plnPerQuoteUnit: null });
  assert.equal(result.acceptedForSimulation, false);
  assert.ok(result.rejectReasons.includes("INVALID_ACCOUNT_QUOTE_FX"));
}

{
  const result = preflightShadowOrder({ intent, instrument, plnPerQuoteUnit: 4 });
  const reconciliation = reconcileShadowOrder({
    preflight: result,
    simulatedExecution: { brokerSymbol: "SIM_BTCUSD", price: 100.10, quantity: 0.23 },
  });
  assert.equal(reconciliation.matched, false);
  assert.ok(reconciliation.rejectReasons.includes("QUANTITY_MISMATCH"));
  assert.ok(reconciliation.rejectReasons.includes("PRICE_MISMATCH"));
  assert.equal(reconciliation.canSubmitOrders, false);
}

assert.equal(SHADOW_ORDER_PREFLIGHT_POLICY.mode, "SHADOW_ONLY");
assert.equal(SHADOW_ORDER_PREFLIGHT_POLICY.appVersion, "0.16.0");
assert.equal(SHADOW_ORDER_PREFLIGHT_POLICY.executable, false);
assert.equal(SHADOW_ORDER_PREFLIGHT_POLICY.canSubmitOrders, false);
assert.equal(SHADOW_ORDER_PREFLIGHT_POLICY.brokerConnected, false);
assert.equal(SHADOW_ORDER_PREFLIGHT_POLICY.brokerAdapter, "NONE");

console.log("shadow order preflight tests: OK");
