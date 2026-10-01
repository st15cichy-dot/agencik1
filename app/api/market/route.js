import { scannerScore } from "../../../lib/indicators";
import { BASE, SYMBOLS, marketSymbolMeta } from "../../../lib/research";

export const revalidate = 60;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`, { next: { revalidate: 60 } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance public data ${res.status}${body ? ` — ${body.slice(0, 120)}` : ""}`);
  }
  return res.json();
}

async function instrument(symbol) {
  const [ticker, rows] = await Promise.all([
    fetchJson(`/api/v3/ticker/24hr?symbol=${symbol}`),
    fetchJson(`/api/v3/klines?symbol=${symbol}&interval=1h&limit=160`),
  ]);

  const candles = rows.map((r) => ({
    time: r[0],
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));

  const meta = marketSymbolMeta(symbol);

  return {
    symbol,
    universeTier: meta?.tier || "UNKNOWN",
    paperEnabled: Boolean(meta?.paperEnabled),
    liveEnabled: false,
    price: Number(ticker.lastPrice),
    change24h: Number(ticker.priceChangePercent),
    quoteVolume24h: Number(ticker.quoteVolume),
    ...scannerScore(candles),
  };
}

export async function GET() {
  try {
    const instruments = await Promise.all(SYMBOLS.map(instrument));
    instruments.sort((a, b) => b.score - a.score);

    return Response.json({
      source: "Binance public market-data-only endpoint",
      asOf: new Date().toISOString(),
      researchUniverse: instruments.length,
      paperUniverse: instruments.filter((x) => x.paperEnabled).length,
      shadowUniverse: instruments.filter((x) => !x.paperEnabled).length,
      instruments,
    });
  } catch (error) {
    return Response.json(
      { error: "MARKET_DATA_UNAVAILABLE", detail: error.message },
      { status: 502 }
    );
  }
}
