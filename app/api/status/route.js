export async function GET() {
  return Response.json({
    name: "Autonomiczny Inwestor",
    version: "0.5.0",
    marketData: "BINANCE_PUBLIC_MARKET_DATA_ONLY",
    scannerUniverse: 8,
    strategyFamilies: 4,
    allMarketScreenBars: 3000,
    deepLabBars: 5000,
    finalOosPct: 30,
    validation: "anchored + purged walk-forward",
    purgeBars: 24,
    regimeSegments: 3,
    benchmark: "raw buy-and-hold + exposure-adjusted benchmark",
    metrics: ["Sharpe", "Calmar", "Profit Factor", "Max Drawdown", "Exposure"],
    modeledCosts: {
      feePerSidePct: 0.10,
      slippagePerSidePct: 0.03,
    },
    paperTrading: true,
    liveTrading: false,
    broker: "XTB_NOT_CONNECTED",
  });
}
