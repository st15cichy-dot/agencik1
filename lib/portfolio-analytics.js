import { buildPaperEvidence, selectValidClosedTrades } from "./paper-evidence.js";

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length
    ? clean.reduce((sum, value) => sum + value, 0) / clean.length
    : null;
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2
    ? clean[mid]
    : (clean[mid - 1] + clean[mid]) / 2;
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item) || "UNKNOWN";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function tradeStats(trades) {
  const valid = trades.filter(
    (trade) =>
      trade &&
      Number.isFinite(trade.pnlPln) &&
      Number.isFinite(trade.returnPct)
  );

  const wins = valid.filter((trade) => trade.pnlPln > 0);
  const losses = valid.filter((trade) => trade.pnlPln <= 0);
  const grossProfitPln = wins.reduce((sum, trade) => sum + trade.pnlPln, 0);
  const grossLossPln = Math.abs(
    losses.reduce((sum, trade) => sum + trade.pnlPln, 0)
  );

  const avgWinPln = average(wins.map((trade) => trade.pnlPln));
  const avgLossPln = average(losses.map((trade) => trade.pnlPln));
  const payoffRatio =
    Number.isFinite(avgWinPln) &&
    Number.isFinite(avgLossPln) &&
    avgLossPln !== 0
      ? avgWinPln / Math.abs(avgLossPln)
      : null;

  const profitFactor =
    grossLossPln > 0
      ? grossProfitPln / grossLossPln
      : null;
  const profitFactorStatus = !valid.length ? "NO_CLOSED_TRADES" : grossLossPln > 0 ? "AVAILABLE" : "NO_LOSING_TRADES";

  const rMultiples = valid
    .map((trade) =>
      Number.isFinite(trade.rMultiple)
        ? trade.rMultiple
        : Number.isFinite(trade.plannedRiskPln) && trade.plannedRiskPln > 0
          ? trade.pnlPln / trade.plannedRiskPln
          : null
    )
    .filter(Number.isFinite);

  return {
    trades: valid.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: valid.length ? (wins.length / valid.length) * 100 : 0,
    totalPnlPln: valid.reduce((sum, trade) => sum + trade.pnlPln, 0),
    totalReturnPct: valid.reduce((sum, trade) => sum + trade.returnPct, 0),
    expectancyPln: average(valid.map((trade) => trade.pnlPln)),
    expectancyPct: average(valid.map((trade) => trade.returnPct)),
    avgWinPln,
    avgLossPln,
    payoffRatio,
    profitFactor,
    profitFactorStatus,
    avgHoldingHours: average(valid.map((trade) =>
      Number.isFinite(trade.holdingHours) && trade.holdingHours >= 0 ? trade.holdingHours : null
    )),
    avgRMultiple: average(rMultiples),
    medianRMultiple: median(rMultiples),
    avgMfePct: average(valid.map((trade) => trade.mfePct)),
    avgMaePct: average(valid.map((trade) => trade.maePct)),
    totalFeesPln: valid.reduce(
      (sum, trade) =>
        sum +
        (Number.isFinite(trade.entryFeePln) && trade.entryFeePln >= 0 ? trade.entryFeePln : 0) +
        (Number.isFinite(trade.exitFeePln) && trade.exitFeePln >= 0 ? trade.exitFeePln : 0),
      0
    ),
  };
}

function compactStats(stats) {
  return Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [
      key,
      Number.isFinite(value) ? round(value) : value,
    ])
  );
}

function groupedStats(trades, keyFn, label) {
  return [...groupBy(trades, keyFn).entries()]
    .map(([name, items]) => ({
      [label]: name,
      ...compactStats(tradeStats(items)),
    }))
    .sort((a, b) => {
      if (b.trades !== a.trades) return b.trades - a.trades;
      return (b.totalPnlPln ?? 0) - (a.totalPnlPln ?? 0);
    });
}

function equityCurve(history = [], nowIso) {
  const nowMs = typeof nowIso === "string" ? Date.parse(nowIso) : NaN;
  const seen = new Set();
  const points = history
    .filter((run) => run && typeof run === "object" && !Array.isArray(run))
    .map((run) => ({
      at: run?.at,
      equityPln: run?.paper?.equityPln,
      totalPnlPln: run?.paper?.totalPnlPln,
      drawdownPct: run?.paper?.drawdownPct,
    }))
    .filter((point) => {
      const atMs = typeof point.at === "string" ? Date.parse(point.at) : NaN;
      if (!Number.isFinite(nowMs) || !Number.isFinite(atMs) || atMs > nowMs || seen.has(atMs)) return false;
      // Match retained-history evidence: the first valid timestamp wins,
      // including a heartbeat that did not retain an equity observation.
      seen.add(atMs);
      return true;
    })
    .filter((point) => Number.isFinite(point.equityPln) && point.equityPln >= 0)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-120);

  return points.map((point) => ({
    at: new Date(point.at).toISOString(),
    equityPln: round(point.equityPln),
    totalPnlPln: round(point.totalPnlPln),
    drawdownPct: round(point.drawdownPct),
  }));
}

function rollingStats(trades, nowIso, days) {
  const nowMs = Date.parse(nowIso);
  const cutoff = nowMs - days * 24 * 3600_000;
  const filtered = trades.filter((trade) => {
    const closedMs = Date.parse(trade?.closedAt);
    return Number.isFinite(closedMs) && closedMs >= cutoff && closedMs <= nowMs;
  });
  return {
    days,
    ...compactStats(tradeStats(filtered)),
  };
}

function sampleStatus(count) {
  if (count === 0) return "NO_CLOSED_TRADES";
  if (count < 10) return "VERY_EARLY_SAMPLE";
  if (count < 30) return "EARLY_SAMPLE";
  if (count < 75) return "BUILDING_SAMPLE";
  return "LARGER_SAMPLE";
}

export function buildPortfolioAnalytics(options = {}) {
  const { paperState, trades = [], history = [], shadowAudit = [], nowIso = new Date().toISOString() } =
    options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const validTrades = selectValidClosedTrades(trades, nowIso);
  const stats = compactStats(tradeStats(validTrades));
  const curve = equityCurve(Array.isArray(history) ? history : [], nowIso);

  const observedDrawdowns = curve
    .map((point) => point.drawdownPct)
    .filter((value) => Number.isFinite(value) && value <= 0);
  const maxObservedDrawdownPct = observedDrawdowns.length
    ? Math.min(...observedDrawdowns)
    : null;

  const exitReasons = [...groupBy(validTrades, (trade) => trade.reason).entries()]
    .map(([reason, items]) => ({
      reason,
      trades: items.length,
      pnlPln: round(
        items.reduce((sum, trade) => sum + (trade.pnlPln || 0), 0)
      ),
    }))
    .sort((a, b) => b.trades - a.trades);

  const riskBudgetUsedPln = validTrades.reduce(
    (sum, trade) =>
      sum +
      (Number.isFinite(trade.plannedRiskPln)
        ? Math.max(0, trade.plannedRiskPln)
        : 0),
    0
  );

  // Initial capital is not an observation of the current portfolio.
  const currentEquityPln = curve.at(-1)?.equityPln ?? null;
  const startingCapitalPln = paperState?.startingCapitalPln ?? null;

  return {
    schemaVersion: 1,
    generatedAt: nowIso,
    sampleStatus: sampleStatus(stats.trades),
    evidence: buildPaperEvidence({ trades, history, shadowAudit, nowIso }),
    stats: {
      ...stats,
      maxObservedDrawdownPct: round(maxObservedDrawdownPct),
      riskBudgetUsedPln: round(riskBudgetUsedPln),
      pnlPerRiskBudget:
        riskBudgetUsedPln > 0
          ? round((stats.totalPnlPln || 0) / riskBudgetUsedPln)
          : null,
      currentEquityPln: round(currentEquityPln),
      cashBaselinePnlPln:
        Number.isFinite(currentEquityPln) && Number.isFinite(startingCapitalPln)
          ? round(currentEquityPln - startingCapitalPln)
          : null,
    },
    byStrategy: groupedStats(
      validTrades,
      (trade) => trade.strategyName || trade.strategyId,
      "strategy"
    ),
    bySymbol: groupedStats(
      validTrades,
      (trade) => trade.symbol,
      "symbol"
    ),
    exitReasons,
    rolling: [7, 30, 90].map((days) =>
      rollingStats(validTrades, nowIso, days)
    ),
    equityCurve: curve,
    recentTrades: validTrades.slice(0, 20).map((trade) => ({
      id: trade.id,
      symbol: trade.symbol,
      strategy: trade.strategyName || trade.strategyId,
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      holdingHours: round(trade.holdingHours, 2),
      pnlPln: round(trade.pnlPln),
      returnPct: round(trade.returnPct),
      rMultiple: round(
        Number.isFinite(trade.rMultiple)
          ? trade.rMultiple
          : Number.isFinite(trade.plannedRiskPln) && trade.plannedRiskPln > 0
            ? trade.pnlPln / trade.plannedRiskPln
            : null
      ),
      mfePct: round(trade.mfePct),
      maePct: round(trade.maePct),
      reason: trade.reason,
    })),
  };
}
