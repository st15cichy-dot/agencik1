export const PAPER_POLICY = Object.freeze({
  startingCapitalPln: 200,
  riskPerTradePct: 0.50,
  maxOpenPositions: 3,
  maxGrossExposurePct: 100,
  maxSinglePositionPct: 50,
  hardDrawdownStopPct: 10,
  dailyLossLimitPct: 2,
  maxHoldingHours: 168,
  atrMultiple: 2,
  minStopPct: 1,
  maxStopPct: 5,
  minPositionPln: 10,
  feePerSidePct: 0.10,
  slippagePerSidePct: 0.03,
});

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function utcDayKey(iso = new Date().toISOString()) {
  return String(iso).slice(0, 10);
}

export function defaultPaperState(nowIso = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    appVersion: "0.13.0",
    currency: "PLN",
    startingCapitalPln: PAPER_POLICY.startingCapitalPln,
    cashPln: PAPER_POLICY.startingCapitalPln,
    realizedPnlPln: 0,
    totalFeesPln: 0,
    openPositions: [],
    peakEquityPln: PAPER_POLICY.startingCapitalPln,
    dayKey: utcDayKey(nowIso),
    dayStartEquityPln: PAPER_POLICY.startingCapitalPln,
    dailyHalt: false,
    halted: false,
    haltReason: null,
    lastUpdatedAt: nowIso,
  };
}

function isValidPaperPosition(position) {
  if (!position || typeof position !== "object") return false;

  const positiveNumbers = [
    position.entryMarketPrice,
    position.entryPrice,
    position.stopPrice,
    position.notionalPln,
    position.riskPln,
  ];

  return (
    typeof position.id === "string" &&
    position.id.length > 0 &&
    typeof position.symbol === "string" &&
    position.symbol.length > 0 &&
    position.side === "LONG" &&
    positiveNumbers.every((value) => Number.isFinite(value) && value > 0) &&
    position.stopPrice < position.entryPrice &&
    Number.isFinite(Date.parse(position.openedAt)) &&
    Number.isFinite(Date.parse(position.maxHoldUntil))
  );
}

export function normalizePaperState(input, nowIso = new Date().toISOString()) {
  const base = defaultPaperState(nowIso);
  if (!input || typeof input !== "object") return base;

  const startingCapitalPln =
    Number.isFinite(input.startingCapitalPln) && input.startingCapitalPln > 0
      ? input.startingCapitalPln
      : base.startingCapitalPln;

  return {
    ...base,
    ...input,
    schemaVersion: 1,
    appVersion: "0.13.0",
    currency: "PLN",
    startingCapitalPln,
    cashPln:
      Number.isFinite(input.cashPln) && input.cashPln >= 0
        ? input.cashPln
        : base.cashPln,
    realizedPnlPln: Number.isFinite(input.realizedPnlPln)
      ? input.realizedPnlPln
      : 0,
    totalFeesPln:
      Number.isFinite(input.totalFeesPln) && input.totalFeesPln >= 0
        ? input.totalFeesPln
        : 0,
    openPositions: Array.isArray(input.openPositions)
      ? input.openPositions.filter(isValidPaperPosition)
      : [],
    peakEquityPln:
      Number.isFinite(input.peakEquityPln) && input.peakEquityPln > 0
        ? Math.max(input.peakEquityPln, startingCapitalPln)
        : startingCapitalPln,
    dayKey:
      typeof input.dayKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.dayKey)
        ? input.dayKey
        : utcDayKey(nowIso),
    dayStartEquityPln:
      Number.isFinite(input.dayStartEquityPln) && input.dayStartEquityPln > 0
        ? input.dayStartEquityPln
        : startingCapitalPln,
    dailyHalt: Boolean(input.dailyHalt),
    halted: Boolean(input.halted),
    haltReason: typeof input.haltReason === "string" ? input.haltReason : null,
    lastUpdatedAt:
      Number.isFinite(Date.parse(input.lastUpdatedAt))
        ? input.lastUpdatedAt
        : nowIso,
  };
}

export function estimateStopPct(atrPct) {
  const raw = Number.isFinite(atrPct)
    ? atrPct * PAPER_POLICY.atrMultiple
    : PAPER_POLICY.minStopPct;
  return clamp(raw, PAPER_POLICY.minStopPct, PAPER_POLICY.maxStopPct);
}

export function positionMarketValuePln(position, rawPrice) {
  if (!position || !Number.isFinite(rawPrice) || rawPrice <= 0) {
    return position?.notionalPln || 0;
  }
  return position.notionalPln * (rawPrice / position.entryPrice);
}

export function paperSnapshot(state, priceMap = {}) {
  const positions = (state.openPositions || []).map((p) => {
    const currentPrice = Number(
      priceMap[p.symbol] ?? p.lastMarketPrice ?? p.entryMarketPrice
    );
    const marketValuePln = positionMarketValuePln(p, currentPrice);
    const unrealizedPnlPln =
      marketValuePln - p.notionalPln - (p.entryFeePln || 0);

    return {
      ...p,
      currentPrice,
      marketValuePln,
      unrealizedPnlPln,
      pnlPct:
        p.notionalPln > 0
          ? (unrealizedPnlPln / p.notionalPln) * 100
          : 0,
    };
  });

  const grossExposurePln = positions.reduce(
    (s, p) => s + p.marketValuePln,
    0
  );
  const unrealizedPnlPln = positions.reduce(
    (s, p) => s + p.unrealizedPnlPln,
    0
  );
  const equityPln = state.cashPln + grossExposurePln;
  const peak = Math.max(
    state.peakEquityPln || state.startingCapitalPln || 0,
    equityPln
  );
  const drawdownPct =
    peak > 0 ? ((equityPln / peak) - 1) * 100 : 0;
  const dayStart = state.dayStartEquityPln || equityPln;
  const dailyPnlPct =
    dayStart > 0 ? ((equityPln / dayStart) - 1) * 100 : 0;

  return {
    equityPln,
    cashPln: state.cashPln,
    grossExposurePln,
    grossExposurePct:
      equityPln > 0 ? (grossExposurePln / equityPln) * 100 : 0,
    unrealizedPnlPln,
    realizedPnlPln: state.realizedPnlPln || 0,
    drawdownPct,
    dailyPnlPct,
    positions,
  };
}

export function refreshDayState(state, snapshot, nowIso) {
  const key = utcDayKey(nowIso);
  if (state.dayKey !== key) {
    state.dayKey = key;
    state.dayStartEquityPln = snapshot.equityPln;
    state.dailyHalt = false;
  }
}

export function updateRiskFlags(state, snapshot) {
  if (
    !state.halted &&
    snapshot.drawdownPct <= -PAPER_POLICY.hardDrawdownStopPct
  ) {
    state.halted = true;
    state.haltReason = "HARD_DRAWDOWN_STOP";
  }

  if (
    !state.dailyHalt &&
    snapshot.dailyPnlPct <= -PAPER_POLICY.dailyLossLimitPct
  ) {
    state.dailyHalt = true;
  }
}

export function canOpenNewPosition(state, snapshot) {
  if (state.halted) {
    return {
      allowed: false,
      reason: state.haltReason || "PORTFOLIO_HALTED",
    };
  }

  if (state.dailyHalt) {
    return { allowed: false, reason: "DAILY_LOSS_HALT" };
  }

  if ((state.openPositions || []).length >= PAPER_POLICY.maxOpenPositions) {
    return { allowed: false, reason: "MAX_OPEN_POSITIONS" };
  }

  if (
    snapshot.grossExposurePct >=
    PAPER_POLICY.maxGrossExposurePct - 0.01
  ) {
    return { allowed: false, reason: "MAX_GROSS_EXPOSURE" };
  }

  return { allowed: true, reason: null };
}

export function openPaperPosition(
  state,
  snapshot,
  {
    symbol,
    strategyId,
    strategyName,
    strategyVersion = null,
    config,
    rawPrice,
    atrPct,
    nowIso,
    deepMetrics = {},
    entrySignalAt = null,
  }
) {
  const permission = canOpenNewPosition(state, snapshot);
  if (!permission.allowed) {
    return { opened: false, reason: permission.reason };
  }

  if ((state.openPositions || []).some((p) => p.symbol === symbol)) {
    return { opened: false, reason: "SYMBOL_ALREADY_OPEN" };
  }

  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    return { opened: false, reason: "INVALID_PRICE" };
  }

  const stopPct = estimateStopPct(atrPct);
  const riskBudgetPln =
    snapshot.equityPln * (PAPER_POLICY.riskPerTradePct / 100);
  const riskBasedNotional = riskBudgetPln / (stopPct / 100);
  const singleCap =
    snapshot.equityPln * (PAPER_POLICY.maxSinglePositionPct / 100);
  const remainingGross = Math.max(
    0,
    snapshot.equityPln *
      (PAPER_POLICY.maxGrossExposurePct / 100) -
      snapshot.grossExposurePln
  );
  const feeRate = PAPER_POLICY.feePerSidePct / 100;
  const cashCap = Math.max(0, state.cashPln / (1 + feeRate));

  const notionalPln = Math.max(
    0,
    Math.min(
      riskBasedNotional,
      singleCap,
      remainingGross,
      cashCap
    )
  );

  if (notionalPln < PAPER_POLICY.minPositionPln) {
    return { opened: false, reason: "POSITION_TOO_SMALL" };
  }

  const slip = PAPER_POLICY.slippagePerSidePct / 100;
  const entryPrice = rawPrice * (1 + slip);
  const entryFeePln = notionalPln * feeRate;
  const riskPln = notionalPln * (stopPct / 100);
  const stopPrice = entryPrice * (1 - stopPct / 100);

  const position = {
    id: `${symbol}-${Date.parse(nowIso)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    symbol,
    side: "LONG",
    strategyId,
    strategyName,
    strategyVersion,
    config,
    openedAt: nowIso,
    entrySignalAt,
    lastCheckedAt: nowIso,
    entryMarketPrice: rawPrice,
    entryPrice,
    lastMarketPrice: rawPrice,
    stopPrice,
    stopPct,
    notionalPln,
    riskPln,
    entryFeePln,
    deepMetrics,
    highestMarketPrice: rawPrice,
    lowestMarketPrice: rawPrice,
    maxHoldUntil: new Date(
      Date.parse(nowIso) +
        PAPER_POLICY.maxHoldingHours * 3600_000
    ).toISOString(),
  };

  state.cashPln -= notionalPln + entryFeePln;
  state.totalFeesPln += entryFeePln;
  state.openPositions.push(position);

  return { opened: true, position };
}

export function updatePositionExcursions(position, candles = []) {
  if (!position || !Array.isArray(candles) || !candles.length) {
    return position;
  }

  const entry = Number(position.entryMarketPrice || position.entryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return position;

  let highest = Number.isFinite(position.highestMarketPrice)
    ? position.highestMarketPrice
    : entry;
  let lowest = Number.isFinite(position.lowestMarketPrice)
    ? position.lowestMarketPrice
    : entry;

  for (const candle of candles) {
    if (Number.isFinite(candle?.high) && candle.high > 0) {
      highest = Math.max(highest, candle.high);
    }
    if (Number.isFinite(candle?.low) && candle.low > 0) {
      lowest = Math.min(lowest, candle.low);
    }
  }

  position.highestMarketPrice = highest;
  position.lowestMarketPrice = lowest;
  position.mfePct = ((highest / entry) - 1) * 100;
  position.maePct = ((lowest / entry) - 1) * 100;
  position.mfePln = position.notionalPln * (position.mfePct / 100);
  position.maePln = position.notionalPln * (position.maePct / 100);
  return position;
}

export function closePaperPosition(
  state,
  positionId,
  { rawExitPrice, nowIso, reason }
) {
  const index = (state.openPositions || []).findIndex(
    (p) => p.id === positionId
  );
  if (index < 0) {
    return { closed: false, reason: "POSITION_NOT_FOUND" };
  }

  const position = state.openPositions[index];

  if (!Number.isFinite(rawExitPrice) || rawExitPrice <= 0) {
    return { closed: false, reason: "INVALID_EXIT_PRICE" };
  }

  const slip = PAPER_POLICY.slippagePerSidePct / 100;
  const feeRate = PAPER_POLICY.feePerSidePct / 100;
  const exitPrice = rawExitPrice * (1 - slip);
  const grossProceedsPln =
    position.notionalPln * (exitPrice / position.entryPrice);
  const exitFeePln = grossProceedsPln * feeRate;
  const netProceedsPln = grossProceedsPln - exitFeePln;
  const pnlPln =
    netProceedsPln -
    position.notionalPln -
    (position.entryFeePln || 0);
  const returnPct =
    position.notionalPln > 0
      ? (pnlPln / position.notionalPln) * 100
      : 0;

  state.cashPln += netProceedsPln;
  state.realizedPnlPln += pnlPln;
  state.totalFeesPln += exitFeePln;
  state.openPositions.splice(index, 1);

  const trade = {
    id: position.id,
    symbol: position.symbol,
    side: position.side,
    strategyId: position.strategyId,
    strategyName: position.strategyName,
    strategyVersion: position.strategyVersion || null,
    config: position.config,
    openedAt: position.openedAt,
    closedAt: nowIso,
    holdingHours:
      (Date.parse(nowIso) - Date.parse(position.openedAt)) /
      3600_000,
    entryMarketPrice: position.entryMarketPrice,
    entryPrice: position.entryPrice,
    stopPrice: position.stopPrice,
    exitMarketPrice: rawExitPrice,
    exitPrice,
    notionalPln: position.notionalPln,
    plannedRiskPln: position.riskPln,
    entryFeePln: position.entryFeePln || 0,
    exitFeePln,
    pnlPln,
    returnPct,
    reason,
    mfePct: Number.isFinite(position.mfePct) ? position.mfePct : 0,
    maePct: Number.isFinite(position.maePct) ? position.maePct : 0,
    mfePln: Number.isFinite(position.mfePln) ? position.mfePln : 0,
    maePln: Number.isFinite(position.maePln) ? position.maePln : 0,
    rMultiple:
      Number.isFinite(position.riskPln) && position.riskPln > 0
        ? pnlPln / position.riskPln
        : null,
    reason,
    deepMetricsAtEntry: position.deepMetrics,
  };

  return { closed: true, trade };
}

export function publicPaperSummary(
  state,
  trades,
  priceMap = {},
  nowIso = new Date().toISOString()
) {
  const snap = paperSnapshot(state, priceMap);
  const closed = Array.isArray(trades) ? trades : [];
  const wins = closed.filter((t) => t.pnlPln > 0).length;
  const losses = closed.filter((t) => t.pnlPln <= 0).length;

  return {
    mode: "AUTONOMOUS_PAPER_ONLY",
    currency: "PLN",
    startingCapitalPln: state.startingCapitalPln,
    equityPln: round(snap.equityPln),
    cashPln: round(snap.cashPln),
    grossExposurePln: round(snap.grossExposurePln),
    grossExposurePct: round(snap.grossExposurePct),
    realizedPnlPln: round(snap.realizedPnlPln),
    unrealizedPnlPln: round(snap.unrealizedPnlPln),
    totalPnlPln: round(
      snap.equityPln - state.startingCapitalPln
    ),
    totalReturnPct: round(
      ((snap.equityPln / state.startingCapitalPln) - 1) * 100
    ),
    drawdownPct: round(snap.drawdownPct),
    dailyPnlPct: round(snap.dailyPnlPct),
    openPositionsCount: state.openPositions.length,
    closedTradesCount: closed.length,
    wins,
    losses,
    winRatePct: closed.length
      ? round((wins / closed.length) * 100)
      : 0,
    dailyHalt: Boolean(state.dailyHalt),
    halted: Boolean(state.halted),
    haltReason: state.haltReason,
    policy: PAPER_POLICY,
    openPositions: snap.positions.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      strategy: p.strategyName,
      strategyVersion: p.strategyVersion || null,
      openedAt: p.openedAt,
      entryPrice: round(p.entryPrice, 8),
      currentPrice: round(p.currentPrice, 8),
      stopPrice: round(p.stopPrice, 8),
      stopPct: round(p.stopPct),
      notionalPln: round(p.notionalPln),
      riskPln: round(p.riskPln),
      unrealizedPnlPln: round(p.unrealizedPnlPln),
      pnlPct: round(p.pnlPct),
      mfePct: round(p.mfePct ?? 0),
      maePct: round(p.maePct ?? 0),
      maxHoldUntil: p.maxHoldUntil,
    })),
    recentClosedTrades: closed.slice(0, 10).map((t) => ({
      symbol: t.symbol,
      strategy: t.strategyName,
      strategyVersion: t.strategyVersion || null,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      holdingHours: round(t.holdingHours, 1),
      pnlPln: round(t.pnlPln),
      returnPct: round(t.returnPct),
      rMultiple: round(t.rMultiple),
      mfePct: round(t.mfePct),
      maePct: round(t.maePct),
      reason: t.reason,
    })),
    updatedAt: nowIso,
  };
}
