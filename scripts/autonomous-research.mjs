import fs from "node:fs";
import path from "node:path";
import { analyzeSymbol, SYMBOLS } from "../lib/research.js";

const OUT_DIR = path.resolve(".auto-output");
const previousLatestPath = process.env.PREVIOUS_LATEST_PATH || "";
const previousHistoryPath = process.env.PREVIOUS_HISTORY_PATH || "";

function readJson(file, fallback) {
  try {
    if (!file || !fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function chosenFrom(result) {
  if (!result?.ranking?.length) return null;
  return result.ranking.find((x) => x.id === result.candidate?.strategyId) || result.ranking[0];
}

function summarize(result, stage) {
  const chosen = chosenFrom(result);
  if (!chosen) {
    return {
      symbol: result?.symbol || "UNKNOWN",
      stage,
      error: "NO_STRATEGY_RESULT",
    };
  }

  return {
    symbol: result.symbol,
    stage,
    strategy: chosen.name,
    config: chosen.config,
    returnPct: round(chosen.final?.totalReturnPct),
    exposureBenchmarkPct: round(chosen.final?.exposureBenchmarkPct),
    excessPct: round(chosen.final?.excessVsExposureBenchmarkPct),
    drawdownPct: round(chosen.final?.maxDrawdownPct),
    profitFactor: round(chosen.final?.profitFactor),
    sharpe: round(chosen.final?.sharpe),
    returnToDrawdown: round(chosen.final?.returnToDrawdown),
    exposurePct: round(chosen.final?.exposurePct),
    trades: chosen.final?.trades ?? 0,
    wfPositive: chosen.walkForward?.positiveFolds ?? 0,
    wfTotal: chosen.walkForward?.totalFolds ?? 0,
    parameterStabilityPct: round(chosen.walkForward?.parameterStabilityPct),
    eligible: Boolean(result.candidate?.eligible),
    paperReady: Boolean(result.candidate?.paperReady),
    signalNow: result.candidate?.signalNow || chosen.signalNow || "FLAT",
    gate: chosen.gate || result.candidate?.gate || null,
    generatedAt: result.generatedAt,
  };
}

function detectEvents(previous, current) {
  const events = [];
  const prevDeep = new Map((previous?.deep || []).map((x) => [x.symbol, x]));
  const currDeep = new Map((current?.deep || []).map((x) => [x.symbol, x]));

  for (const [symbol, now] of currDeep) {
    const before = prevDeep.get(symbol);

    if (!before && now.eligible) {
      events.push({
        type: "DEEP_PASS_NEW",
        symbol,
        message: `${symbol}: pierwszy zapisany Deep PASS`,
      });
    }

    if (before && before.eligible !== now.eligible) {
      events.push({
        type: now.eligible ? "DEEP_PASS_GAINED" : "DEEP_PASS_LOST",
        symbol,
        message: `${symbol}: Deep gate ${before.eligible ? "PASS" : "FAIL"} → ${now.eligible ? "PASS" : "FAIL"}`,
      });
    }

    if (before && before.signalNow !== now.signalNow) {
      events.push({
        type: "SIGNAL_CHANGED",
        symbol,
        message: `${symbol}: sygnał ${before.signalNow} → ${now.signalNow}`,
      });
    }

    if ((!before?.paperReady) && now.paperReady) {
      events.push({
        type: "PAPER_READY_NEW",
        symbol,
        message: `${symbol}: Deep PASS + aktywny LONG`,
      });
    }
  }

  for (const [symbol, before] of prevDeep) {
    if (!currDeep.has(symbol) && before?.eligible) {
      events.push({
        type: "CANDIDATE_NOT_RETESTED",
        symbol,
        message: `${symbol}: poprzedni Deep PASS nie był kandydatem screeningu w tym runie`,
      });
    }
  }

  return events.map((x) => ({
    ...x,
    at: new Date().toISOString(),
  }));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const previousLatest = readJson(previousLatestPath, null);
  const previousHistory = readJson(previousHistoryPath, []);

  const startedAt = new Date().toISOString();
  const screen = [];
  const deep = [];
  const failures = [];

  // Stage 1: cheaper screening for all instruments.
  for (const symbol of SYMBOLS) {
    try {
      const result = await analyzeSymbol(symbol, "screen");
      screen.push(summarize(result, "screen"));
    } catch (error) {
      failures.push({
        stage: "screen",
        symbol,
        error: error?.message || String(error),
      });
    }
  }

  const deepSymbols = screen
    .filter((x) => x.eligible)
    .map((x) => x.symbol);

  // Stage 2: expensive deep validation only for screening candidates.
  for (const symbol of deepSymbols) {
    try {
      const result = await analyzeSymbol(symbol, "deep");
      deep.push(summarize(result, "deep"));
    } catch (error) {
      failures.push({
        stage: "deep",
        symbol,
        error: error?.message || String(error),
      });
    }
  }

  const current = {
    schemaVersion: 1,
    appVersion: "0.6.0",
    mode: "AUTONOMOUS_RESEARCH_ONLY",
    startedAt,
    completedAt: new Date().toISOString(),
    source: "Binance public market-data-only endpoint",
    scheduleTarget: "every 2 hours",
    screen,
    deep,
    screenPass: screen.filter((x) => x.eligible).map((x) => x.symbol),
    deepPass: deep.filter((x) => x.eligible).map((x) => x.symbol),
    paperReady: deep.filter((x) => x.paperReady).map((x) => x.symbol),
    failures,
    safeguards: {
      liveTrading: false,
      brokerConnected: false,
      noSecretsStored: true,
      persistenceContainsPublicResearchOnly: true,
    },
  };

  const events = detectEvents(previousLatest, current);
  current.events = events;

  const runRecord = {
    at: current.completedAt,
    screenPass: current.screenPass,
    deepPass: current.deepPass,
    paperReady: current.paperReady,
    failures: current.failures,
    events,
    deep: current.deep.map((x) => ({
      symbol: x.symbol,
      strategy: x.strategy,
      eligible: x.eligible,
      paperReady: x.paperReady,
      signalNow: x.signalNow,
      returnPct: x.returnPct,
      excessPct: x.excessPct,
      drawdownPct: x.drawdownPct,
      trades: x.trades,
    })),
  };

  const history = [runRecord, ...(Array.isArray(previousHistory) ? previousHistory : [])]
    .slice(0, 240);

  fs.writeFileSync(
    path.join(OUT_DIR, "latest.json"),
    JSON.stringify(current, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "history.json"),
    JSON.stringify(history, null, 2) + "\n"
  );

  console.log(JSON.stringify({
    ok: true,
    completedAt: current.completedAt,
    screenPass: current.screenPass,
    deepPass: current.deepPass,
    paperReady: current.paperReady,
    failures: current.failures.length,
    events: current.events.map((x) => x.type),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
