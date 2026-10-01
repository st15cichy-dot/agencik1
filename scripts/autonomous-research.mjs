import fs from "node:fs";
import path from "node:path";
import {
  analyzeSymbol,
  fetchBars,
  SYMBOLS,
} from "../lib/research.js";
import { atrSeries } from "../lib/indicators.js";
import { prepareStrategy } from "../lib/strategies.js";
import {
  PAPER_POLICY,
  normalizePaperState,
  paperSnapshot,
  refreshDayState,
  updateRiskFlags,
  openPaperPosition,
  closePaperPosition,
  publicPaperSummary,
  updatePositionExcursions,
} from "../lib/paper-portfolio.js";
import {
  buildAgentHealth,
  buildDecisionEntries,
} from "../lib/agent-health.js";
import {
  buildPortfolioAnalytics,
} from "../lib/portfolio-analytics.js";
import {
  strategyVersion,
  updateStrategyGovernance,
} from "../lib/strategy-governance.js";
import {
  buildAllocationIntelligence,
} from "../lib/allocation-intelligence.js";

const OUT_DIR = path.resolve(".auto-output");
const previousLatestPath =
  process.env.PREVIOUS_LATEST_PATH || "";
const previousHistoryPath =
  process.env.PREVIOUS_HISTORY_PATH || "";
const previousPaperPath =
  process.env.PREVIOUS_PAPER_PATH || "";
const previousTradesPath =
  process.env.PREVIOUS_TRADES_PATH || "";
const previousJournalPath =
  process.env.PREVIOUS_JOURNAL_PATH || "";
const previousGovernancePath =
  process.env.PREVIOUS_GOVERNANCE_PATH || "";

function readJson(file, fallback) {
  try {
    if (!file || !fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function round(value, digits = 4) {
  return Number.isFinite(value)
    ? Number(value.toFixed(digits))
    : null;
}

function chosenFrom(result) {
  if (!result?.ranking?.length) return null;
  return (
    result.ranking.find(
      (x) => x.id === result.candidate?.strategyId
    ) || result.ranking[0]
  );
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
    strategyId: chosen.id,
    strategy: chosen.name,
    strategyVersion: strategyVersion(chosen.id, chosen.config),
    config: chosen.config,
    robustScore: round(chosen.robustScore),
    returnPct: round(chosen.final?.totalReturnPct),
    exposureBenchmarkPct: round(
      chosen.final?.exposureBenchmarkPct
    ),
    excessPct: round(
      chosen.final?.excessVsExposureBenchmarkPct
    ),
    drawdownPct: round(chosen.final?.maxDrawdownPct),
    profitFactor: round(chosen.final?.profitFactor),
    sharpe: round(chosen.final?.sharpe),
    returnToDrawdown: round(
      chosen.final?.returnToDrawdown
    ),
    exposurePct: round(chosen.final?.exposurePct),
    trades: chosen.final?.trades ?? 0,
    wfPositive:
      chosen.walkForward?.positiveFolds ?? 0,
    wfTotal: chosen.walkForward?.totalFolds ?? 0,
    parameterStabilityPct: round(
      chosen.walkForward?.parameterStabilityPct
    ),
    eligible: Boolean(result.candidate?.eligible),
    paperReady: false,
    signalNow:
      result.candidate?.signalNow ||
      chosen.signalNow ||
      "FLAT",
    entryWindowLong: false,
    entrySignalAt: null,
    gate:
      chosen.gate ||
      result.candidate?.gate ||
      null,
    generatedAt: result.generatedAt,
  };
}

function sameConfig(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function recentEntryState(
  candles,
  strategyId,
  config,
  sinceMs
) {
  const strategy = prepareStrategy(
    candles,
    strategyId,
    config
  );

  let start = candles.findIndex(
    (c) => c.time > sinceMs
  );
  if (start < 0) start = candles.length;
  start = Math.max(1, start);

  let inPosition = false;
  let entrySignalAt = null;

  for (let i = start; i < candles.length; i += 1) {
    const signal = strategy.signal(i, inPosition);

    if (!inPosition && signal === "ENTER") {
      inPosition = true;
      entrySignalAt = new Date(
        candles[i].time
      ).toISOString();
    } else if (
      inPosition &&
      signal === "EXIT"
    ) {
      inPosition = false;
      entrySignalAt = null;
    }
  }

  return {
    active: inPosition,
    entrySignalAt,
  };
}

function detectResearchEvents(previous, current) {
  const events = [];
  const prevDeep = new Map(
    (previous?.deep || []).map((x) => [
      x.symbol,
      x,
    ])
  );
  const currDeep = new Map(
    (current?.deep || []).map((x) => [
      x.symbol,
      x,
    ])
  );

  for (const [symbol, now] of currDeep) {
    const before = prevDeep.get(symbol);

    if (!before && now.eligible) {
      events.push({
        type: "DEEP_PASS_NEW",
        symbol,
        message: `${symbol}: pierwszy zapisany Deep PASS`,
      });
    }

    if (
      before &&
      before.eligible !== now.eligible
    ) {
      events.push({
        type: now.eligible
          ? "DEEP_PASS_GAINED"
          : "DEEP_PASS_LOST",
        symbol,
        message: `${symbol}: Deep gate ${
          before.eligible ? "PASS" : "FAIL"
        } → ${now.eligible ? "PASS" : "FAIL"}`,
      });
    }

    if (
      before &&
      before.signalNow !== now.signalNow
    ) {
      events.push({
        type: "SIGNAL_CHANGED",
        symbol,
        message: `${symbol}: sygnał ${before.signalNow} → ${now.signalNow}`,
      });
    }

    if (
      !before?.paperReady &&
      now.paperReady
    ) {
      events.push({
        type: "PAPER_READY_NEW",
        symbol,
        message: `${symbol}: Deep PASS + aktywne wejście LONG w oknie heartbeat`,
      });
    }
  }

  return events;
}

async function getMarketContext(
  symbol,
  cache
) {
  if (cache.has(symbol)) {
    return cache.get(symbol);
  }

  const candles = await fetchBars(symbol, 240);
  const last = candles.at(-1);
  const atr = atrSeries(candles, 14).at(-1);
  const atrPct =
    atr && last?.close
      ? (atr / last.close) * 100
      : null;

  const context = {
    candles,
    price: last?.close,
    atrPct,
    asOf: last?.time
      ? new Date(last.time).toISOString()
      : new Date().toISOString(),
  };

  cache.set(symbol, context);
  return context;
}

async function main() {
  fs.mkdirSync(OUT_DIR, {
    recursive: true,
  });

  const previousLatest = readJson(
    previousLatestPath,
    null
  );
  const previousHistory = readJson(
    previousHistoryPath,
    []
  );
  const previousPaper = readJson(
    previousPaperPath,
    null
  );
  const previousTrades = readJson(
    previousTradesPath,
    []
  );
  const previousJournal = readJson(
    previousJournalPath,
    []
  );
  const previousGovernance = readJson(
    previousGovernancePath,
    null
  );

  const nowIso = new Date().toISOString();
  const startedAt = nowIso;
  const screen = [];
  const deep = [];
  const failures = [];
  const paperEvents = [];
  const marketCache = new Map();

  let paperState = normalizePaperState(
    previousPaper,
    nowIso
  );
  let paperTrades = Array.isArray(
    previousTrades
  )
    ? previousTrades
    : [];

  for (const symbol of SYMBOLS) {
    try {
      const result = await analyzeSymbol(
        symbol,
        "screen"
      );
      screen.push(
        summarize(result, "screen")
      );
    } catch (error) {
      failures.push({
        stage: "screen",
        symbol,
        error:
          error?.message ||
          String(error),
      });
    }
  }

  const deepSymbols = [
    ...new Set([
      ...screen
        .filter((x) => x.eligible)
        .map((x) => x.symbol),
      ...(paperState.openPositions || []).map(
        (x) => x.symbol
      ),
    ]),
  ];

  for (const symbol of deepSymbols) {
    try {
      const result = await analyzeSymbol(
        symbol,
        "deep"
      );
      deep.push(
        summarize(result, "deep")
      );
    } catch (error) {
      failures.push({
        stage: "deep",
        symbol,
        error:
          error?.message ||
          String(error),
      });
    }
  }

  const previousHeartbeatMs =
    previousLatest?.completedAt
      ? Date.parse(
          previousLatest.completedAt
        )
      : Date.now() - 3 * 3600_000;

  for (const item of deep) {
    if (!item.eligible) continue;

    try {
      const market = await getMarketContext(
        item.symbol,
        marketCache
      );

      const entry = recentEntryState(
        market.candles,
        item.strategyId,
        item.config,
        previousHeartbeatMs
      );

      item.entryWindowLong = entry.active;
      item.entrySignalAt =
        entry.entrySignalAt;
      item.paperReady =
        item.eligible &&
        entry.active;
    } catch (error) {
      failures.push({
        stage: "entry-window",
        symbol: item.symbol,
        error:
          error?.message ||
          String(error),
      });
    }
  }

  const deepBySymbol = new Map(
    deep.map((x) => [x.symbol, x])
  );

  for (const position of
    paperState.openPositions || []) {
    try {
      await getMarketContext(
        position.symbol,
        marketCache
      );
    } catch (error) {
      failures.push({
        stage: "paper-market",
        symbol: position.symbol,
        error:
          error?.message ||
          String(error),
      });
    }
  }

  const priceMap = {};
  for (const [symbol, ctx] of
    marketCache.entries()) {
    if (Number.isFinite(ctx.price)) {
      priceMap[symbol] = ctx.price;
    }
  }

  let snapshot = paperSnapshot(
    paperState,
    priceMap
  );

  refreshDayState(
    paperState,
    snapshot,
    nowIso
  );

  snapshot = paperSnapshot(
    paperState,
    priceMap
  );

  for (const position of [
    ...paperState.openPositions,
  ]) {
    const market = marketCache.get(
      position.symbol
    );

    if (
      !market?.candles?.length ||
      !Number.isFinite(market.price)
    ) {
      continue;
    }

    const lastCheckedMs = Date.parse(
      position.lastCheckedAt ||
        position.openedAt
    );

    const freshBars =
      market.candles.filter(
        (c) => c.time > lastCheckedMs
      );

    const stopIndex = freshBars.findIndex(
      (c) => c.low <= position.stopPrice
    );
    const stopHit =
      stopIndex >= 0 ? freshBars[stopIndex] : null;

    if (stopHit) {
      updatePositionExcursions(
        position,
        freshBars.slice(0, stopIndex)
      );
      updatePositionExcursions(
        position,
        [{
          high: position.stopPrice,
          low: position.stopPrice,
        }]
      );
      const result =
        closePaperPosition(
          paperState,
          position.id,
          {
            rawExitPrice:
              position.stopPrice,
            nowIso,
            reason: "STOP_LOSS",
          }
        );

      if (result.closed) {
        paperTrades.unshift(
          result.trade
        );
        paperEvents.push({
          type: "PAPER_STOP",
          symbol: position.symbol,
          message: `${position.symbol}: paper stop-loss, P/L ${round(result.trade.pnlPln, 2)} PLN`,
        });
      }
      continue;
    }

    updatePositionExcursions(
      position,
      freshBars
    );

    const deepNow = deepBySymbol.get(
      position.symbol
    );

    if (
      deepNow &&
      !deepNow.eligible
    ) {
      const result =
        closePaperPosition(
          paperState,
          position.id,
          {
            rawExitPrice: market.price,
            nowIso,
            reason: "DEEP_GATE_LOST",
          }
        );

      if (result.closed) {
        paperTrades.unshift(
          result.trade
        );
        paperEvents.push({
          type: "PAPER_GATE_EXIT",
          symbol: position.symbol,
          message: `${position.symbol}: zamknięcie paper — Deep PASS utracony`,
        });
      }
      continue;
    }

    if (
      deepNow &&
      (
        deepNow.strategyId !==
          position.strategyId ||
        !sameConfig(
          deepNow.config,
          position.config
        )
      )
    ) {
      const result =
        closePaperPosition(
          paperState,
          position.id,
          {
            rawExitPrice: market.price,
            nowIso,
            reason:
              "VALIDATED_STRATEGY_CHANGED",
          }
        );

      if (result.closed) {
        paperTrades.unshift(
          result.trade
        );
        paperEvents.push({
          type: "PAPER_STRATEGY_EXIT",
          symbol: position.symbol,
          message: `${position.symbol}: zamknięcie paper — zmieniła się walidowana strategia`,
        });
      }
      continue;
    }

    const strategy = prepareStrategy(
      market.candles,
      position.strategyId,
      position.config
    );

    const exitSignal = strategy.signal(
      market.candles.length - 1,
      true
    );

    if (exitSignal === "EXIT") {
      const result =
        closePaperPosition(
          paperState,
          position.id,
          {
            rawExitPrice: market.price,
            nowIso,
            reason: "STRATEGY_EXIT",
          }
        );

      if (result.closed) {
        paperTrades.unshift(
          result.trade
        );
        paperEvents.push({
          type: "PAPER_SIGNAL_EXIT",
          symbol: position.symbol,
          message: `${position.symbol}: zamknięcie paper — sygnał EXIT`,
        });
      }
      continue;
    }

    if (
      Date.parse(nowIso) >=
      Date.parse(
        position.maxHoldUntil
      )
    ) {
      const result =
        closePaperPosition(
          paperState,
          position.id,
          {
            rawExitPrice: market.price,
            nowIso,
            reason: "MAX_HOLD_7D",
          }
        );

      if (result.closed) {
        paperTrades.unshift(
          result.trade
        );
        paperEvents.push({
          type: "PAPER_TIME_EXIT",
          symbol: position.symbol,
          message: `${position.symbol}: zamknięcie paper po maks. 7 dniach`,
        });
      }
      continue;
    }

    const livePosition =
      paperState.openPositions.find(
        (p) => p.id === position.id
      );

    if (livePosition) {
      livePosition.lastCheckedAt =
        nowIso;
      livePosition.lastMarketPrice =
        market.price;
    }
  }

  snapshot = paperSnapshot(
    paperState,
    priceMap
  );

  updateRiskFlags(
    paperState,
    snapshot
  );

  if (
    paperState.halted &&
    paperState.openPositions.length
  ) {
    for (const position of [
      ...paperState.openPositions,
    ]) {
      const market = marketCache.get(
        position.symbol
      );

      if (
        !Number.isFinite(
          market?.price
        )
      ) {
        continue;
      }

      const result =
        closePaperPosition(
          paperState,
          position.id,
          {
            rawExitPrice: market.price,
            nowIso,
            reason:
              "HARD_DRAWDOWN_HALT",
          }
        );

      if (result.closed) {
        paperTrades.unshift(
          result.trade
        );
      }
    }

    paperEvents.push({
      type: "PAPER_HARD_HALT",
      symbol: "PORTFOLIO",
      message: `Paper portfolio: hard drawdown stop ${PAPER_POLICY.hardDrawdownStopPct}% — nowe wejścia zablokowane`,
    });
  }

  snapshot = paperSnapshot(
    paperState,
    priceMap
  );

  if (paperState.dailyHalt) {
    paperEvents.push({
      type: "PAPER_DAILY_HALT",
      symbol: "PORTFOLIO",
      message: `Paper portfolio: dzienny limit straty ${PAPER_POLICY.dailyLossLimitPct}% — brak nowych wejść do kolejnego dnia UTC`,
    });
  }

  const candidates = deep
    .filter((x) => x.paperReady)
    .filter(
      (x) =>
        !paperState.openPositions.some(
          (p) => p.symbol === x.symbol
        )
    )
    .sort(
      (a, b) =>
        (b.returnToDrawdown ?? -999) -
          (a.returnToDrawdown ?? -999) ||
        (b.excessPct ?? -999) -
          (a.excessPct ?? -999)
    );

  for (const candidate of candidates) {
    snapshot = paperSnapshot(
      paperState,
      priceMap
    );

    if (
      paperState.halted ||
      paperState.dailyHalt
    ) {
      break;
    }

    if (
      paperState.openPositions.length >=
      PAPER_POLICY.maxOpenPositions
    ) {
      break;
    }

    try {
      const market = await getMarketContext(
        candidate.symbol,
        marketCache
      );

      priceMap[candidate.symbol] =
        market.price;

      const opened = openPaperPosition(
        paperState,
        snapshot,
        {
          symbol: candidate.symbol,
          strategyId:
            candidate.strategyId,
          strategyName:
            candidate.strategy,
          strategyVersion:
            candidate.strategyVersion,
          config: candidate.config,
          rawPrice: market.price,
          atrPct: market.atrPct,
          nowIso,
          entrySignalAt:
            candidate.entrySignalAt,
          deepMetrics: {
            returnPct:
              candidate.returnPct,
            excessPct:
              candidate.excessPct,
            drawdownPct:
              candidate.drawdownPct,
            profitFactor:
              candidate.profitFactor,
            wfPositive:
              candidate.wfPositive,
            wfTotal:
              candidate.wfTotal,
            parameterStabilityPct:
              candidate.parameterStabilityPct,
          },
        }
      );

      if (opened.opened) {
        paperEvents.push({
          type: "PAPER_OPENED",
          symbol:
            candidate.symbol,
          message: `${candidate.symbol}: otwarto paper LONG, notional ${round(opened.position.notionalPln, 2)} PLN, ryzyko ${round(opened.position.riskPln, 2)} PLN`,
        });
      }
    } catch (error) {
      failures.push({
        stage: "paper-open",
        symbol: candidate.symbol,
        error:
          error?.message ||
          String(error),
      });
    }
  }

  snapshot = paperSnapshot(
    paperState,
    priceMap
  );

  paperState.peakEquityPln =
    Math.max(
      paperState.peakEquityPln || 0,
      snapshot.equityPln
    );

  paperState.lastUpdatedAt = nowIso;
  paperTrades =
    paperTrades.slice(0, 500);

  const current = {
    schemaVersion: 2,
    appVersion: "0.12.0",
    mode:
      "AUTONOMOUS_RESEARCH_AND_PAPER",
    startedAt,
    completedAt:
      new Date().toISOString(),
    source:
      "Binance public market-data-only endpoint",
    scheduleTarget: "every 2 hours",
    screen,
    deep,
    screenPass: screen
      .filter((x) => x.eligible)
      .map((x) => x.symbol),
    deepPass: deep
      .filter((x) => x.eligible)
      .map((x) => x.symbol),
    paperReady: deep
      .filter((x) => x.paperReady)
      .map((x) => x.symbol),
    failures,
    safeguards: {
      liveTrading: false,
      brokerConnected: false,
      noSecretsStored: true,
      paperOnly: true,
      persistenceContainsOnlyPublicResearchAndSimulatedPositions:
        true,
    },
  };

  const governanceUpdate =
    updateStrategyGovernance({
      previous: previousGovernance,
      deep: current.deep,
      nowIso: current.completedAt,
    });

  const strategyGovernance =
    governanceUpdate.governance;

  for (const item of current.deep) {
    const id = `${item.symbol}|${item.strategyVersion}`;
    const annotation =
      governanceUpdate.annotations[id];

    if (annotation) {
      item.governance = annotation;
    }
  }

  current.strategyGovernance =
    strategyGovernance;

  const marketBySymbol = Object.fromEntries(
    [...marketCache.entries()]
  );

  current.allocationIntelligence =
    buildAllocationIntelligence({
      deep: current.deep,
      marketBySymbol,
      portfolioEquityPln:
        snapshot.equityPln,
      nowIso: current.completedAt,
    });

  const allocationEvents = [{
    type: "ALLOCATION_SHADOW_UPDATED",
    symbol: "PORTFOLIO",
    message:
      `Shadow allocation: ${current.allocationIntelligence.summary.selectedCandidates}/${current.allocationIntelligence.summary.eligibleCandidates} kandydatów, gross ${current.allocationIntelligence.summary.grossWeightPct}%`,
    selectedCandidates:
      current.allocationIntelligence.summary.selectedCandidates,
    eligibleCandidates:
      current.allocationIntelligence.summary.eligibleCandidates,
    grossWeightPct:
      current.allocationIntelligence.summary.grossWeightPct,
    maxPairCorrelation:
      current.allocationIntelligence.summary.maxPairCorrelation,
  }];

  const researchEvents =
    detectResearchEvents(
      previousLatest,
      current
    );

  current.events = [
    ...researchEvents,
    ...governanceUpdate.events,
    ...allocationEvents,
    ...paperEvents,
  ].map((x) => ({
    ...x,
    at: current.completedAt,
  }));

  current.paperPortfolio =
    publicPaperSummary(
      paperState,
      paperTrades,
      priceMap,
      current.completedAt
    );

  current.portfolioAnalytics =
    buildPortfolioAnalytics({
      paperState,
      trades: paperTrades,
      history: [
        {
          at: current.completedAt,
          paper: {
            equityPln:
              current.paperPortfolio.equityPln,
            totalPnlPln:
              current.paperPortfolio.totalPnlPln,
            drawdownPct:
              current.paperPortfolio.drawdownPct,
          },
        },
        ...(Array.isArray(previousHistory)
          ? previousHistory
          : []),
      ],
      nowIso: current.completedAt,
    });

  current.health = buildAgentHealth({
    startedAt: current.startedAt,
    completedAt: current.completedAt,
    previousCompletedAt:
      previousLatest?.completedAt || null,
    expectedSymbols: SYMBOLS.length,
    screen: current.screen,
    deep: current.deep,
    failures: current.failures,
    paperPortfolio: current.paperPortfolio,
  });

  const newDecisionEntries =
    buildDecisionEntries({
      completedAt: current.completedAt,
      screen: current.screen,
      deep: current.deep,
      events: current.events,
      paperPortfolio: current.paperPortfolio,
      health: current.health,
    });

  const decisionJournal = [
    ...newDecisionEntries,
    ...(Array.isArray(previousJournal)
      ? previousJournal
      : []),
  ].slice(0, 1500);

  current.decisionJournal = {
    entriesAdded: newDecisionEntries.length,
    totalEntries: decisionJournal.length,
    latest: decisionJournal.slice(0, 12),
  };

  const runRecord = {
    at: current.completedAt,
    screenPass:
      current.screenPass,
    deepPass:
      current.deepPass,
    paperReady:
      current.paperReady,
    failures:
      current.failures,
    events:
      current.events,
    health: current.health,
    journalEntriesAdded:
      current.decisionJournal.entriesAdded,
    governance: {
      mode:
        current.strategyGovernance.mode,
      paperAuthority:
        current.strategyGovernance.paperAuthority,
      counts:
        current.strategyGovernance.counts,
      champions:
        current.strategyGovernance.champions,
    },
    allocation: {
      mode:
        current.allocationIntelligence.mode,
      paperAuthority:
        current.allocationIntelligence.paperAuthority,
      summary:
        current.allocationIntelligence.summary,
      shadowBasket:
        current.allocationIntelligence.shadowBasket,
    },
    analytics: {
      sampleStatus:
        current.portfolioAnalytics.sampleStatus,
      trades:
        current.portfolioAnalytics.stats.trades,
      expectancyPln:
        current.portfolioAnalytics.stats.expectancyPln,
      profitFactor:
        current.portfolioAnalytics.stats.profitFactor,
      avgRMultiple:
        current.portfolioAnalytics.stats.avgRMultiple,
      maxObservedDrawdownPct:
        current.portfolioAnalytics.stats.maxObservedDrawdownPct,
    },
    paper: {
      equityPln:
        current.paperPortfolio
          .equityPln,
      totalPnlPln:
        current.paperPortfolio
          .totalPnlPln,
      openPositionsCount:
        current.paperPortfolio
          .openPositionsCount,
      closedTradesCount:
        current.paperPortfolio
          .closedTradesCount,
      drawdownPct:
        current.paperPortfolio
          .drawdownPct,
      dailyHalt:
        current.paperPortfolio
          .dailyHalt,
      halted:
        current.paperPortfolio
          .halted,
    },
    deep: current.deep.map((x) => ({
      symbol: x.symbol,
      strategy: x.strategy,
      strategyVersion:
        x.strategyVersion,
      governanceLifecycle:
        x.governance?.lifecycle || null,
      eligible: x.eligible,
      paperReady: x.paperReady,
      signalNow: x.signalNow,
      returnPct: x.returnPct,
      excessPct: x.excessPct,
      drawdownPct:
        x.drawdownPct,
      trades: x.trades,
    })),
  };

  const history = [
    runRecord,
    ...(Array.isArray(previousHistory)
      ? previousHistory
      : []),
  ].slice(0, 240);

  fs.writeFileSync(
    path.join(
      OUT_DIR,
      "latest.json"
    ),
    JSON.stringify(
      current,
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(
      OUT_DIR,
      "history.json"
    ),
    JSON.stringify(
      history,
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(
      OUT_DIR,
      "paper.json"
    ),
    JSON.stringify(
      paperState,
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(
      OUT_DIR,
      "paper-trades.json"
    ),
    JSON.stringify(
      paperTrades,
      null,
      2
    ) + "\n"
  );


  fs.writeFileSync(
    path.join(
      OUT_DIR,
      "allocation.json"
    ),
    JSON.stringify(
      current.allocationIntelligence,
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(
      OUT_DIR,
      "governance.json"
    ),
    JSON.stringify(
      strategyGovernance,
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(
      OUT_DIR,
      "analytics.json"
    ),
    JSON.stringify(
      current.portfolioAnalytics,
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(
      OUT_DIR,
      "journal.json"
    ),
    JSON.stringify(
      decisionJournal,
      null,
      2
    ) + "\n"
  );

  fs.writeFileSync(
    path.join(
      OUT_DIR,
      "health.json"
    ),
    JSON.stringify(
      {
        schemaVersion: 1,
        appVersion: "0.12.0",
        current: current.health,
        recent: history.slice(0, 48).map((run) => ({
          at: run.at,
          health: run.health || null,
        })),
      },
      null,
      2
    ) + "\n"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        completedAt:
          current.completedAt,
        screenPass:
          current.screenPass,
        deepPass:
          current.deepPass,
        paperReady:
          current.paperReady,
        paper: {
          equityPln:
            current.paperPortfolio
              .equityPln,
          open:
            current.paperPortfolio
              .openPositionsCount,
          closed:
            current.paperPortfolio
              .closedTradesCount,
          halted:
            current.paperPortfolio
              .halted,
        },
        failures:
          current.failures.length,
        health: {
          score: current.health.score,
          status: current.health.status,
          alerts: current.health.alerts.map((x) => x.code),
        },
        journalEntriesAdded:
          current.decisionJournal.entriesAdded,
        allocation: {
          selected:
            current.allocationIntelligence.summary.selectedCandidates,
          eligible:
            current.allocationIntelligence.summary.eligibleCandidates,
          grossWeightPct:
            current.allocationIntelligence.summary.grossWeightPct,
          maxPairCorrelation:
            current.allocationIntelligence.summary.maxPairCorrelation,
        },
        analytics: {
          sampleStatus:
            current.portfolioAnalytics.sampleStatus,
          trades:
            current.portfolioAnalytics.stats.trades,
          expectancyPln:
            current.portfolioAnalytics.stats.expectancyPln,
          avgRMultiple:
            current.portfolioAnalytics.stats.avgRMultiple,
        },
        events:
          current.events.map(
            (x) => x.type
          ),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
