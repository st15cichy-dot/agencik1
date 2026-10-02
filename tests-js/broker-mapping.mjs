import assert from "node:assert/strict";
import { BROKER_MAPPING_POLICY, mapShadowInstrument, convertShadowNotional, simulateBrokerReadiness } from "../lib/broker-mapping.js";

const specs = [{
  marketSymbol: "BTCUSDT",
  brokerSymbol: "SIM_BTCUSD",
  tickSize: 0.01,
  quantityStep: 0.001,
  minQuantity: 0.001,
  quoteCurrency: "USD",
}];

{
  const mapped = mapShadowInstrument("BTCUSDT", specs);
  assert.equal(mapped.mapped, true);
  assert.equal(mapped.executable, false);
  assert.equal(mapped.quantityStep, 0.001);
}

{
  const missing = mapShadowInstrument("ETHUSDT", specs);
  assert.equal(missing.mapped, false);
  assert.equal(missing.rejectReason, "INSTRUMENT_MAPPING_MISSING_OR_INVALID");
}

{
  const mapped = mapShadowInstrument("BTCUSDT", specs);
  const converted = convertShadowNotional({ requestedNotionalPln: 1000, referencePrice: 100, plnPerQuoteUnit: 4, instrument: mapped });
  assert.equal(converted.accepted, true);
  assert.equal(converted.brokerQuantity, 2.5);
  assert.equal(converted.executable, false);
}

{
  const tinySpecs = [{ ...specs[0], quantityStep: 0.01, minQuantity: 0.1 }];
  const result = simulateBrokerReadiness({ marketSymbol: "BTCUSDT", requestedNotionalPln: 1, referenceMarketPrice: 100 }, tinySpecs, 4);
  assert.equal(result.conversion.accepted, false);
  assert.equal(result.simulatedBrokerRejection, "BELOW_MINIMUM_QUANTITY");
  assert.equal(result.canSubmitOrders, false);
  assert.equal(result.brokerAdapter, "NONE");
}

assert.equal(BROKER_MAPPING_POLICY.mode, "SHADOW_ONLY");
assert.equal(BROKER_MAPPING_POLICY.executable, false);
assert.equal(BROKER_MAPPING_POLICY.canSubmitOrders, false);
assert.equal(BROKER_MAPPING_POLICY.brokerConnected, false);

console.log("broker mapping tests: OK");
