import { analyzeSymbol, SYMBOLS } from "../../../lib/research";

export const maxDuration = 120;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "BTCUSDT").toUpperCase();

  if (!SYMBOLS.includes(symbol)) {
    return Response.json({ error: "INVALID_SYMBOL" }, { status: 400 });
  }

  try {
    const result = await analyzeSymbol(symbol, "deep");
    return Response.json({
      ...result,
      warning: "Final OOS, walk-forward i metryki historyczne nie gwarantują przyszłych wyników.",
    });
  } catch (error) {
    return Response.json(
      { error: "LAB_UNAVAILABLE", detail: error.message },
      { status: 502 }
    );
  }
}
