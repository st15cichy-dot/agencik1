export const SHADOW_DIAGNOSTIC_POLICY = Object.freeze({
  appVersion: "0.17.0",
  mode: "SHADOW_ONLY",
  executable: false,
  canSubmitOrders: false,
  brokerConnected: false,
  brokerAdapter: "NONE",
  instrumentSpecSource: "STATIC_DIAGNOSTIC_FIXTURE_ONLY",
  fxSource: "STATIC_DIAGNOSTIC_FIXTURE_ONLY",
  plnPerQuoteUnit: 4,
});

const PAPER_CORE = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "LINKUSDT",
];

export const DIAGNOSTIC_INSTRUMENT_SPECS = Object.freeze(
  PAPER_CORE.map((marketSymbol) =>
    Object.freeze({
      marketSymbol,
      brokerSymbol: `SIM_${marketSymbol}`,
      tickSize: 0.01,
      quantityStep: 0.000001,
      minQuantity: 0.000001,
      minNotional: 0.01,
      quoteCurrency: "USDT",
      diagnosticOnly: true,
    })
  )
);

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function publicMarketExecutionInputs(candles = []) {
  const clean = (Array.isArray(candles) ? candles : [])
    .filter(
      (c) =>
        Number.isFinite(c?.close) &&
        c.close > 0 &&
        Number.isFinite(c?.high) &&
        Number.isFinite(c?.low)
    )
    .slice(-48);

  if (clean.length < 3) {
    return {
      spreadBps: 0,
      volatilityBps: 0,
      liquidityBps: 0,
      samples: clean.length,
      source: "PUBLIC_OHLCV_PROXY",
    };
  }

  const absReturnsBps = [];
  const rangeBps = [];

  for (let i = 1; i < clean.length; i += 1) {
    const prev = clean[i - 1];
    const curr = clean[i];
    absReturnsBps.push(
      Math.abs((curr.close / prev.close - 1) * 10000)
    );
    rangeBps.push(
      Math.max(0, ((curr.high - curr.low) / curr.close) * 10000)
    );
  }

  const mean = (xs) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

  return {
    spreadBps: round(mean(rangeBps) * 0.05, 4),
    volatilityBps: round(mean(absReturnsBps), 4),
    liquidityBps: 0,
    samples: absReturnsBps.length,
    source: "PUBLIC_OHLCV_PROXY",
  };
}
