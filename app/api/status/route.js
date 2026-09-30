export async function GET() {
  return Response.json({
    name: "Autonomiczny Inwestor",
    version: "0.5.1",
    marketData: "BINANCE_PUBLIC_MARKET_DATA_ONLY",
    scannerUniverse: 8,
    strategyFamilies: 4,
    allMarketScreenBars: 3000,
    deepLabBars: 5000,
    finalOosPct: 30,
    validation: "anchored + purged walk-forward",
    purgeBars: 24,
    regimeDiagnostics: {
      scope: "full available deep history",
      windowBars: 480,
      stepBars: 240,
      types: ["BULL", "BEAR", "RANGE"],
      diagnosticOnly: true,
    },
    benchmark: "raw buy-and-hold + exposure-adjusted benchmark",
    metrics: {
      sharpe: "annualized, flagged when sample < 90d",
      calmar: "reported only when sample >= 180d",
      returnToDrawdown: true,
    },
    modeledCosts: {
      feePerSidePct: 0.10,
      slippagePerSidePct: 0.03,
    },
    paperTrading: true,
    liveTrading: false,
    broker: "XTB_NOT_CONNECTED",
  });
}
