export const SHADOW_ORDER_PREFLIGHT_POLICY = Object.freeze({
  appVersion: "0.16.0",
  mode: "SHADOW_ONLY",
  executable: false,
  canSubmitOrders: false,
  brokerConnected: false,
  brokerAdapter: "NONE",
});

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function floorToStep(value, step) {
  if (!positive(value) || !positive(step)) return null;
  const units = Math.floor((value + Number.EPSILON) / step);
  return Number((units * step).toPrecision(12));
}

export function preflightShadowOrder({ intent, instrument, plnPerQuoteUnit }) {
  const rejectReasons = [];
  if (!intent || !instrument?.mapped) rejectReasons.push("INSTRUMENT_NOT_MAPPED");
  if (!positive(intent?.referenceMarketPrice)) rejectReasons.push("INVALID_REFERENCE_PRICE");
  if (!positive(intent?.requestedNotionalPln)) rejectReasons.push("INVALID_REQUESTED_NOTIONAL");
  if (!positive(plnPerQuoteUnit)) rejectReasons.push("INVALID_ACCOUNT_QUOTE_FX");
  if (!positive(instrument?.tickSize)) rejectReasons.push("INVALID_TICK_SIZE");
  if (!positive(instrument?.quantityStep)) rejectReasons.push("INVALID_QUANTITY_STEP");
  if (!positive(instrument?.minQuantity)) rejectReasons.push("INVALID_MIN_QUANTITY");

  let roundedPrice = null;
  let roundedQuantity = null;
  let quoteNotional = null;
  if (rejectReasons.length === 0) {
    roundedPrice = floorToStep(intent.referenceMarketPrice, instrument.tickSize);
    quoteNotional = intent.requestedNotionalPln / plnPerQuoteUnit;
    roundedQuantity = floorToStep(quoteNotional / roundedPrice, instrument.quantityStep);
    if (!positive(roundedQuantity) || roundedQuantity < instrument.minQuantity) rejectReasons.push("BELOW_MINIMUM_QUANTITY");
    if (positive(instrument.minNotional) && roundedPrice * (roundedQuantity || 0) < instrument.minNotional) rejectReasons.push("BELOW_MINIMUM_NOTIONAL");
  }

  return {
    schemaVersion: 1,
    appVersion: SHADOW_ORDER_PREFLIGHT_POLICY.appVersion,
    mode: "SHADOW_ONLY",
    executable: false,
    canSubmitOrders: false,
    brokerConnected: false,
    brokerAdapter: "NONE",
    intentId: intent?.intentId || null,
    marketSymbol: intent?.marketSymbol || null,
    brokerSymbol: instrument?.brokerSymbol || null,
    requested: { price: intent?.referenceMarketPrice ?? null, notionalPln: intent?.requestedNotionalPln ?? null },
    normalized: { price: roundedPrice, quantity: roundedQuantity, quoteNotional },
    acceptedForSimulation: rejectReasons.length === 0,
    rejectReasons,
  };
}

export function reconcileShadowOrder({ preflight, simulatedExecution }) {
  const rejectReasons = [...(preflight?.rejectReasons || [])];
  if (!preflight?.acceptedForSimulation) {
    return { matched: false, executable: false, canSubmitOrders: false, status: "PREFLIGHT_REJECTED", rejectReasons };
  }
  if (!simulatedExecution) rejectReasons.push("SIMULATED_EXECUTION_MISSING");
  if (simulatedExecution?.brokerSymbol !== preflight.brokerSymbol) rejectReasons.push("BROKER_SYMBOL_MISMATCH");
  if (simulatedExecution?.quantity !== preflight.normalized.quantity) rejectReasons.push("QUANTITY_MISMATCH");
  if (simulatedExecution?.price !== preflight.normalized.price) rejectReasons.push("PRICE_MISMATCH");
  return {
    matched: rejectReasons.length === 0,
    executable: false,
    canSubmitOrders: false,
    status: rejectReasons.length === 0 ? "SIMULATED_RECONCILED" : "SIMULATED_MISMATCH",
    rejectReasons,
  };
}

export function buildShadowPreflightAudit({ preflight, reconciliation, at = new Date().toISOString() }) {
  return {
    schemaVersion: 1,
    appVersion: SHADOW_ORDER_PREFLIGHT_POLICY.appVersion,
    at,
    mode: "SHADOW_ONLY",
    executable: false,
    canSubmitOrders: false,
    brokerAdapter: "NONE",
    intentId: preflight?.intentId || null,
    marketSymbol: preflight?.marketSymbol || null,
    preflight,
    reconciliation,
  };
}
