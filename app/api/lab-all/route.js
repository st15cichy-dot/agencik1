import { analyzeSymbol, SYMBOLS, marketSymbolMeta } from "../../../lib/research";

export const maxDuration = 240;

export async function GET() {
  const results = [];

  for (const symbol of SYMBOLS) {
    try {
      const x = await analyzeSymbol(symbol, "screen");
      const chosen =
        x.ranking.find((r) => r.id === x.candidate.strategyId) ||
        x.ranking[0];

      const meta = marketSymbolMeta(symbol);

      results.push({
        symbol,
        universeTier: meta?.tier || "UNKNOWN",
        paperEnabled: Boolean(meta?.paperEnabled),
        strategy: chosen.name,
        config: chosen.config,
        oosReturnPct: chosen.final.totalReturnPct,
        buyHoldPct: chosen.final.benchmarkPct,
        exposureBenchmarkPct: chosen.final.exposureBenchmarkPct,
        exposureExcessPct: chosen.final.excessVsExposureBenchmarkPct,
        drawdownPct: chosen.final.maxDrawdownPct,
        profitFactor: chosen.final.profitFactor,
        sharpe: chosen.final.sharpe,
        calmar: chosen.final.calmar,
        exposurePct: chosen.final.exposurePct,
        trades: chosen.final.trades,
        wfPositive: chosen.walkForward.positiveFolds,
        wfTotal: chosen.walkForward.totalFolds,
        parameterStabilityPct: chosen.walkForward.parameterStabilityPct,
        signalNow: chosen.signalNow,
        screenPass: x.candidate.screenPass,
        gate: chosen.gate,
      });
    } catch (error) {
      results.push({
        symbol,
        error: error?.message || "Unknown error",
      });
    }
  }

  const successful = results.filter((x) => !x.error);
  successful.sort((a, b) => {
    if (a.screenPass !== b.screenPass) return a.screenPass ? -1 : 1;
    return b.exposureExcessPct - a.exposureExcessPct;
  });

  return Response.json({
    version: "0.13.0",
    profile: "screen",
    generatedAt: new Date().toISOString(),
    analyzed: results.length,
    successful: successful.length,
    paperUniverse: successful.filter((x) => x.paperEnabled).length,
    shadowUniverse: successful.filter((x) => !x.paperEnabled).length,
    deepCheckCandidates: successful.filter((x) => x.screenPass),
    ranking: successful,
    failures: results.filter((x) => x.error),
    warning: "Screen PASS oznacza tylko kandydaturę do głębokiego labu 5000 świec.",
  });
}
