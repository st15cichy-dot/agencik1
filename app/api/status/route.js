export async function GET() {
  return Response.json({
    name: "Autonomiczny Inwestor",
    version: "0.6.0",
    mode: "AUTONOMOUS_RESEARCH_ONLY",
    marketData: "BINANCE_PUBLIC_MARKET_DATA_ONLY",
    automation: {
      engine: "GitHub Actions",
      targetCadence: "every 2 hours",
      persistenceBranch: "research-data",
      browserMayBeClosed: true,
      liveTrading: false,
    },
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
    modeledCosts: {
      feePerSidePct: 0.10,
      slippagePerSidePct: 0.03,
    },
    storagePolicy: {
      publicResearchOnly: true,
      secrets: false,
      realMoneyPositions: false,
      brokerData: false,
    },
    paperTrading: true,
    liveTrading: false,
    broker: "XTB_NOT_CONNECTED",
  });
}
