export async function GET() {
  return Response.json({
    name: "Autonomiczny Inwestor",
    version: "0.3.0",
    marketData: "BINANCE_PUBLIC_MARKET_DATA_ONLY",
    scannerUniverse: 8,
    strategyFamilies: 4,
    trainTest: "70/30",
    walkForward: "3 folds",
    modeledCosts: { feePerSidePct: 0.10, slippagePerSidePct: 0.03 },
    paperTrading: true,
    liveTrading: false,
    broker: "XTB_NOT_CONNECTED",
  });
}
