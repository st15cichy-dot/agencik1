import { analyzeSymbol, SYMBOLS } from "../../../lib/research";

export const maxDuration = 120;

export async function GET() {
  try {
    const settled = await Promise.allSettled(
      SYMBOLS.map((symbol) => analyzeSymbol(symbol, 1200))
    );

    const results = settled.map((item, index) => {
      const symbol = SYMBOLS[index];
      if (item.status === "rejected") {
        return { symbol, error: item.reason?.message || "Unknown error" };
      }

      const x = item.value;
      const top = x.ranking[0];
      const chosen = x.ranking.find((r) => r.id === x.candidate.strategyId) || top;
      return {
        symbol,
        generatedAt: x.generatedAt,
        strategy: chosen.name,
        config: chosen.bestConfig,
        oosReturnPct: chosen.test.totalReturnPct,
        benchmarkPct: chosen.test.benchmarkPct,
        excessReturnPct: chosen.test.excessReturnPct,
        drawdownPct: chosen.test.maxDrawdownPct,
        profitFactor: chosen.test.profitFactor,
        trades: chosen.test.trades,
        wfPositive: chosen.walkForward.positiveFolds,
        wfTotal: chosen.walkForward.totalFolds,
        wfStabilityPct: chosen.walkForward.stabilityPct,
        signalNow: chosen.signalNow,
        eligible: x.candidate.eligible,
        paperReady: x.candidate.paperReady,
        gate: x.candidate.gate,
        rawScoreLeader: top.name,
      };
    });

    const successful = results.filter((x) => !x.error);
    successful.sort((a, b) => {
      if (a.paperReady !== b.paperReady) return a.paperReady ? -1 : 1;
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.excessReturnPct - a.excessReturnPct;
    });

    return Response.json({
      version: "0.4.0",
      generatedAt: new Date().toISOString(),
      analyzed: results.length,
      successful: successful.length,
      candidates: successful.filter((x) => x.paperReady),
      ranking: successful,
      failures: results.filter((x) => x.error),
      warning: "Ranking służy wyłącznie do researchu i paper tradingu.",
    });
  } catch (error) {
    return Response.json(
      { error: "LAB_ALL_UNAVAILABLE", detail: error.message },
      { status: 502 }
    );
  }
}
