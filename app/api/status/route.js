export async function GET() {
  return Response.json({
    name: "Autonomiczny Inwestor",
    version: "0.2.0",
    marketData: "BINANCE_PUBLIC",
    scanner: "DETERMINISTIC",
    backtest: "SMA20_SMA50_LONG_ONLY",
    paperTrading: true,
    liveTrading: false,
    broker: "XTB_NOT_CONNECTED",
  });
}
