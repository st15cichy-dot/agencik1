import { analyzeSymbol, SYMBOLS } from "../../../lib/research";

export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "BTCUSDT").toUpperCase();

  if (!SYMBOLS.includes(symbol)) {
    return Response.json({ error: "INVALID_SYMBOL" }, { status: 400 });
  }

  try {
    const result = await analyzeSymbol(symbol, 1500);
    return Response.json({
      ...result,
      source: "Binance public market-data-only endpoint",
      warning: "Wyniki historyczne i paper-gating nie przewidują przyszłych wyników.",
    });
  } catch (error) {
    return Response.json(
      { error: "LAB_UNAVAILABLE", detail: error.message },
      { status: 502 }
    );
  }
}
