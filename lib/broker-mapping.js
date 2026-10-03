export const BROKER_MAPPING_POLICY = Object.freeze({
  appVersion: "0.16.0",
  mode: "SHADOW_ONLY",
  executable: false,
  canSubmitOrders: false,
  brokerConnected: false,
  brokerAdapter: "NONE",
  specificationSource: "INJECTED_DIAGNOSTIC_FIXTURE_ONLY",
});

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function floorToStep(value, step) {
  if (!finitePositive(value) || !finitePositive(step)) return null;
  const units = Math.floor((value + Number.EPSILON) / step);
  return Number((units * step).toPrecision(12));
}

export function validateInstrumentSpec(spec) {
  if (!spec || typeof spec.marketSymbol !== "string" || typeof spec.brokerSymbol !== "string") return false;
  return finitePositive(spec.tickSize) && finitePositive(spec.quantityStep) && finitePositive(spec.minQuantity);
}

export function mapShadowInstrument(marketSymbol, specs = []) {
  const symbol = String(marketSymbol || "").toUpperCase();
  const spec = (Array.isArray(specs) ? specs : []).find((x) => x?.marketSymbol === symbol);
  if (!validateInstrumentSpec(spec)) {
    return { mapped: false, marketSymbol: symbol, brokerSymbol: null, executable: false, rejectReason: "INSTRUMENT_MAPPING_MISSING_OR_INVALID" };
  }
  return { mapped: true, marketSymbol: symbol, brokerSymbol: spec.brokerSymbol, tickSize: spec.tickSize, quantityStep: spec.quantityStep, minQuantity: spec.minQuantity, quoteCurrency: spec.quoteCurrency || null, executable: false };
}

export function convertShadowNotional({ requestedNotionalPln, referencePrice, plnPerQuoteUnit, instrument }) {
  if (!finitePositive(requestedNotionalPln) || !finitePositive(referencePrice) || !finitePositive(plnPerQuoteUnit) || !instrument?.mapped) {
    return { accepted: false, brokerQuantity: null, executable: false, rejectReason: "INVALID_NOTIONAL_CONVERSION_INPUT" };
  }
  const quoteNotional = requestedNotionalPln / plnPerQuoteUnit;
  const rawQuantity = quoteNotional / referencePrice;
  const brokerQuantity = floorToStep(rawQuantity, instrument.quantityStep);
  if (!finitePositive(brokerQuantity) || brokerQuantity < instrument.minQuantity) {
    return { accepted: false, brokerQuantity, executable: false, rejectReason: "BELOW_MINIMUM_QUANTITY" };
  }
  return { accepted: true, brokerQuantity, quoteNotional: Number(quoteNotional.toFixed(8)), executable: false, rejectReason: null };
}

export function simulateBrokerReadiness(intent, specs = [], plnPerQuoteUnit = null) {
  const instrument = mapShadowInstrument(intent?.marketSymbol, specs);
  const conversion = convertShadowNotional({
    requestedNotionalPln: intent?.requestedNotionalPln,
    referencePrice: intent?.referenceMarketPrice,
    plnPerQuoteUnit,
    instrument,
  });
  return {
    schemaVersion: 1,
    appVersion: BROKER_MAPPING_POLICY.appVersion,
    mode: BROKER_MAPPING_POLICY.mode,
    executable: false,
    canSubmitOrders: false,
    brokerConnected: false,
    brokerAdapter: "NONE",
    instrument,
    conversion,
    simulatedBrokerRejection: conversion.accepted ? null : conversion.rejectReason,
  };
}
