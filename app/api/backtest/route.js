import {
  maxDrawdown,
  smaAt,
} from "../../../lib/indicators.js";

const BINANCE_PUBLIC_BASE =
  "https://data-api.binance.vision";

const ALLOWED = new Set([
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
]);

export async function GET(request) {
  const { searchParams } = new URL(
    request.url
  );

  const symbol = (
    searchParams.get("symbol") ||
    "BTCUSDT"
  ).toUpperCase();

  if (!ALLOWED.has(symbol)) {
    return Response.json(
      { error: "INVALID_SYMBOL" },
      { status: 400 }
    );
  }

  try {
    const url =
      `${BINANCE_PUBLIC_BASE}/api/v3/klines?symbol=${symbol}&interval=1h&limit=500`;

    const res = await fetch(url, {
      next: { revalidate: 300 },
    });

    if (!res.ok) {
      const body = await res
        .text()
        .catch(() => "");

      throw new Error(
        `Binance public market data: ${res.status}${
          body
            ? ` — ${body.slice(0, 160)}`
            : ""
        }`
      );
    }

    const rows = await res.json();
    const closes = rows.map((r) =>
      Number(r[4])
    );

    const feePerSide = 0.001;
    let cash = 1;
    let inPos = false;
    let entry = 0;
    const trades = [];
    const equity = [1];

    for (
      let i = 55;
      i < closes.length;
      i += 1
    ) {
      const hist = closes.slice(
        0,
        i + 1
      );

      const fast = smaAt(
        hist,
        20
      );
      const slow = smaAt(
        hist,
        50
      );

      const prevHist =
        closes.slice(0, i);

      const prevFast = smaAt(
        prevHist,
        20
      );
      const prevSlow = smaAt(
        prevHist,
        50
      );
      const px = closes[i];

      if (
        !inPos &&
        prevFast <= prevSlow &&
        fast > slow
      ) {
        inPos = true;
        entry = px;
        cash *= 1 - feePerSide;
      } else if (
        inPos &&
        prevFast >= prevSlow &&
        fast < slow
      ) {
        const gross = px / entry;
        const net =
          gross * (1 - feePerSide);
        cash *= net;

        trades.push({
          entry,
          exit: px,
          returnPct:
            (net - 1) * 100,
        });

        inPos = false;
        entry = 0;
      }

      let marked = cash;
      if (inPos && entry > 0) {
        marked =
          cash * (px / entry);
      }
      equity.push(marked);
    }

    if (inPos && entry > 0) {
      const px = closes.at(-1);
      const net =
        (px / entry) *
        (1 - feePerSide);

      cash *= net;

      trades.push({
        entry,
        exit: px,
        returnPct:
          (net - 1) * 100,
      });

      equity.push(cash);
    }

    const wins =
      trades.filter(
        (t) => t.returnPct > 0
      ).length;

    return Response.json({
      source:
        "Binance public market-data endpoint — 1h klines",
      endpoint:
        "data-api.binance.vision",
      symbol,
      strategy:
        "SMA20/SMA50 long-only crossover",
      assumptions: {
        feePerSidePct:
          feePerSide * 100,
        slippagePct: 0,
        leverage: 1,
      },
      sampleBars:
        closes.length,
      trades:
        trades.length,
      winRatePct:
        trades.length
          ? (wins / trades.length) *
            100
          : 0,
      totalReturnPct:
        (cash - 1) * 100,
      maxDrawdownPct:
        maxDrawdown(equity),
      recentTrades:
        trades.slice(-5),
      warning:
        "Backtest history is limited and does not predict future results.",
    });
  } catch (error) {
    return Response.json(
      {
        error:
          "BACKTEST_UNAVAILABLE",
        detail: error.message,
      },
      { status: 502 }
    );
  }
}
