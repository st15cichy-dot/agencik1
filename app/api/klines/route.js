const ALLOWED = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]);
const INTERVALS = new Set(["15m", "1h", "4h", "1d"]);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "BTCUSDT").toUpperCase();
  const interval = searchParams.get("interval") || "1h";
  const limit = Math.min(500, Math.max(60, Number(searchParams.get("limit") || 240)));

  if (!ALLOWED.has(symbol) || !INTERVALS.has(interval)) {
    return Response.json({ error: "INVALID_PARAMETERS" }, { status: 400 });
  }

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`Binance: ${res.status}`);
    const rows = await res.json();
    return Response.json({
      source: "Binance",
      symbol,
      interval,
      candles: rows.map((r) => ({
        time: r[0],
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      })),
    });
  } catch (error) {
    return Response.json({ error: "KLINES_UNAVAILABLE", detail: error.message }, { status: 502 });
  }
}
