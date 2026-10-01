export const SHADOW_EXECUTION_POLICY = Object.freeze({
  appVersion: "0.14.0",
  mode: "SHADOW_NON_EXECUTABLE",
  canSubmitOrders: false,
  brokerConnected: false,
  adapter: "NONE",
  maxHistory: 500,
});

function round(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function buildShadowExecutionIntent(
  position,
  nowIso = new Date().toISOString()
) {
  if (
    !position ||
    typeof position.id !== "string" ||
    typeof position.symbol !== "string" ||
    position.side !== "LONG" ||
    !Number.isFinite(position.notionalPln) ||
    !Number.isFinite(position.riskPln) ||
    !Number.isFinite(position.entryMarketPrice) ||
    !Number.isFinite(position.entryPrice) ||
    !Number.isFinite(position.stopPrice)
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    appVersion: SHADOW_EXECUTION_POLICY.appVersion,
    intentId: `shadow:${position.id}`,
    paperPositionId: position.id,
    createdAt: nowIso,
    source: "PAPER_OPENED",
    mode: SHADOW_EXECUTION_POLICY.mode,
    executable: false,
    broker: "NOT_CONNECTED",
    brokerAdapter: SHADOW_EXECUTION_POLICY.adapter,
    action: "BUY",
    orderType: "MARKET_REFERENCE_WITH_PROTECTIVE_STOP",
    marketSymbol: position.symbol,
    brokerInstrumentId: null,
    accountCurrency: "PLN",
    marketQuoteCurrency: "USDT",
    requestedNotionalPln: round(position.notionalPln, 2),
    plannedRiskPln: round(position.riskPln, 2),
    referenceMarketPrice: round(position.entryMarketPrice),
    simulatedFillPrice: round(position.entryPrice),
    protectiveStopPrice: round(position.stopPrice),
    stopPct: round(position.stopPct, 4),
    brokerQuantity: null,
    strategyId: position.strategyId || null,
    strategyName: position.strategyName || null,
    strategyVersion: position.strategyVersion || null,
    entrySignalAt: position.entrySignalAt || null,
    blockers: [
      "LIVE_TRADING_DISABLED",
      "BROKER_NOT_CONNECTED",
      "INSTRUMENT_MAPPING_REQUIRED",
      "ACCOUNT_QUOTE_FX_REQUIRED",
      "BROKER_PRECISION_RULES_REQUIRED",
    ],
    safety: {
      canSubmit: false,
      liveTrading: false,
      brokerConnected: false,
      paperOnly: true,
    },
  };
}

export function mergeShadowExecutionIntents(
  previous = [],
  additions = [],
  maxHistory = SHADOW_EXECUTION_POLICY.maxHistory
) {
  const merged = [];
  const seen = new Set();

  for (const item of [
    ...(Array.isArray(additions) ? additions : []),
    ...(Array.isArray(previous) ? previous : []),
  ]) {
    if (!item?.intentId || seen.has(item.intentId)) continue;
    seen.add(item.intentId);
    merged.push({
      ...item,
      executable: false,
      broker: "NOT_CONNECTED",
      brokerAdapter: "NONE",
      safety: {
        ...(item.safety || {}),
        canSubmit: false,
        liveTrading: false,
        brokerConnected: false,
        paperOnly: true,
      },
    });
    if (merged.length >= maxHistory) break;
  }

  return merged;
}

export function publicShadowExecutionSummary(intents = []) {
  const clean = Array.isArray(intents) ? intents : [];
  return {
    schemaVersion: 1,
    appVersion: SHADOW_EXECUTION_POLICY.appVersion,
    mode: SHADOW_EXECUTION_POLICY.mode,
    executable: false,
    brokerConnected: false,
    canSubmitOrders: false,
    totalIntents: clean.length,
    latest: clean.slice(0, 10),
    requiredBeforeAnyExecution: [
      "BROKER_ADAPTER",
      "INSTRUMENT_MAPPING",
      "ACCOUNT_QUOTE_FX",
      "BROKER_PRECISION_RULES",
      "SEPARATE_EXECUTION_SAFETY_REVIEW",
    ],
  };
}
