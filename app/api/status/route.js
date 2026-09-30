export async function GET() {
  return Response.json({
    name: "Autonomiczny Inwestor",
    version: "0.4.0",
    marketData: "BINANCE_PUBLIC_MARKET_DATA_ONLY",
    scannerUniverse: 8,
    strategyFamilies: 4,
    trainTest: "70/30",
    walkForward: "3 folds",
    validation: {
      minOosTrades: 8,
      minPositiveWalkForwardFolds: "2/3",
      minProfitFactor: 1.15,
      maxOosDrawdownPct: -12,
      minExcessVsBenchmarkPct: 0,
    },
    modeledCosts: { feePerSidePct: 0.10, slippagePerSidePct: 0.03 },
    allMarketResearch: true,
    paperTrading: true,
    liveTrading: false,
    broker: "XTB_NOT_CONNECTED",
  });
}
