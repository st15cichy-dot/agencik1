import { scannerScore } from "../../../lib/indicators";

export const revalidate = 60;

const BINANCE_PUBLIC_BASE = "https://data-api.binance.vision";
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"];

async function fetchJson(path, revalidate = 60) {
  const url = `${BINANCE_PUBLIC_BASE}${path}`;
  const res = await fetch(url, { next: { revalidate } });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance public market data: ${res.status}${body ? ` — ${body.slice(0, 160)}` : ""}`);
  }
  return res.json();
}

async function fetchKlines(symbol) {
  const rows = await fetchJson(`/api/v3/klines?symbol=${symbol}&interval=1h&limit=120`);
  return rows.map((r) => ({
    time: r[0],
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
}

async function fetchTicker(symbol) {
  return fetchJson(`/api/v3/ticker/24hr?symbol=${symbol}`);
}

export async function GET() {
  try {
    const data = await Promise.all(
      SYMBOLS.map(async (symbol) => {
        const [ticker, klines] = await Promise.all([
          fetchTicker(symbol),
          fetchKlines(symbol),
        ]);

        const closes = klines.map((x) => x.close);
        const scan = scannerScore(closes);

        return {
          symbol,
          price: Number(ticker.lastPrice),
          change24h: Number(ticker.priceChangePercent),
          high24h: Number(ticker.highPrice),
          low24h: Number(ticker.lowPrice),
          quoteVolume24h: Number(ticker.quoteVolume),
          ...scan,
        };
      })
    );

    data.sort((a, b) => b.score - a.score);

    return Response.json({
      source: "Binance public market-data endpoint",
      endpoint: "data-api.binance.vision",
      mode: "LIVE_MARKET_DATA_PAPER_TRADING_ONLY",
      asOf: new Date().toISOString(),
      instruments: data,
    });
  } catch (error) {
    return Response.json(
      {
        error: "MARKET_DATA_UNAVAILABLE",
        detail: error.message,
        hint: "The app uses Binance's official public market-data-only endpoint.",
      },
      { status: 502 }
    );
  }
}
