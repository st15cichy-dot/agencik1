export async function GET() {
  return Response.json({
    name: "Autonomiczny Inwestor",
    mode: "PAPER_ONLY",
    liveTrading: false,
    broker: "XTB_NOT_CONNECTED",
    marketData: "DEMO",
    version: "0.1.0",
  });
}
