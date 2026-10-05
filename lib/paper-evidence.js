const DAY_MS = 24 * 3600_000;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const asArray = (value) => Array.isArray(value) ? value : [];
const hasId = (value) => typeof value === "string" && value.trim().length > 0;
const round = (value) => Number.isFinite(value) ? Number(value.toFixed(4)) : null;

function timestamp(value) {
  return typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
}

function bounds(times, firstKey, lastKey) {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    [firstKey]: sorted.length ? new Date(sorted[0]).toISOString() : null,
    [lastKey]: sorted.length ? new Date(sorted.at(-1)).toISOString() : null,
    observedSpanDays: sorted.length ? round((sorted.at(-1) - sorted[0]) / DAY_MS) : null,
  };
}

function inspectTrades(trades, nowMs) {
  const items = [];
  const ids = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;
  let missingIdCount = 0;
  for (const trade of asArray(trades)) {
    const identified = isObject(trade) && hasId(trade.id);
    if (isObject(trade) && !identified) missingIdCount += 1;
    const closedMs = timestamp(trade?.closedAt);
    const openedMs = timestamp(trade?.openedAt);
    const hasOpenedAt = isObject(trade) && Object.hasOwn(trade, "openedAt");
    if (!identified || !Number.isFinite(nowMs) || !Number.isFinite(closedMs) || closedMs > nowMs ||
        !Number.isFinite(trade.pnlPln) || !Number.isFinite(trade.returnPct) ||
        (hasOpenedAt && (!Number.isFinite(openedMs) || openedMs > closedMs))) {
      invalidCount += 1;
      continue;
    }
    // Keep the first valid occurrence. A malformed row cannot reserve an ID.
    if (ids.has(trade.id)) {
      duplicateCount += 1;
      continue;
    }
    ids.add(trade.id);
    items.push(trade);
  }
  return { items, invalidCount, duplicateCount, missingIdCount };
}

// Analytics and evidence must describe the same retained closed-trade sample.
export function selectValidClosedTrades(trades = [], nowIso = new Date().toISOString()) {
  return inspectTrades(trades, timestamp(nowIso)).items;
}

function inspectHistory(history, nowMs) {
  const items = [];
  const times = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;
  for (const run of asArray(history)) {
    const atMs = timestamp(run?.at);
    if (!isObject(run) || !Number.isFinite(nowMs) || !Number.isFinite(atMs) || atMs > nowMs) {
      invalidCount += 1;
    } else if (times.has(atMs)) {
      duplicateCount += 1;
    } else {
      times.add(atMs);
      items.push(run);
    }
  }
  return { items, invalidCount, duplicateCount };
}

function hasEquity(run) {
  return Number.isFinite(run?.paper?.equityPln) && run.paper.equityPln >= 0;
}

function hasHealth(run) {
  return isObject(run?.health) && hasId(run.health.status) && Number.isFinite(run.health.score);
}

function availability(trades, predicate) {
  const availableCount = trades.filter(predicate).length;
  return { availableCount, missingCount: trades.length - availableCount };
}

function inspectShadow(audit, nowMs) {
  const items = [];
  const ids = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;
  for (const row of asArray(audit)) {
    const id = hasId(row?.auditId) ? row.auditId : row?.intentId;
    const atMs = timestamp(row?.at);
    if (!isObject(row) || !hasId(id) || !Number.isFinite(nowMs) || !Number.isFinite(atMs) || atMs > nowMs ||
        !["SIMULATED", "REJECTED"].includes(row.status) ||
        (row.status === "SIMULATED" && (!(row.fillPrice > 0) || !Number.isFinite(row.fillPrice) ||
          !(row.quantity > 0) || !Number.isFinite(row.quantity)))) {
      invalidCount += 1;
    } else if (ids.has(id)) {
      duplicateCount += 1;
    } else {
      ids.add(id);
      items.push(row);
    }
  }
  return { items, invalidCount, duplicateCount };
}

export function buildPaperEvidence(options = {}) {
  const { trades = [], history = [], shadowAudit = [], nowIso = new Date().toISOString() } = isObject(options) ? options : {};
  const nowMs = timestamp(nowIso);
  const closed = inspectTrades(trades, nowMs);
  const retained = inspectHistory(history, nowMs);
  const shadow = inspectShadow(shadowAudit, nowMs);
  const times = retained.items.map((run) => timestamp(run.at)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((atMs, index) => (atMs - times[index]) / 3600_000);
  const optionalMetrics = {
    rMultiple: availability(closed.items, (trade) => Number.isFinite(trade.rMultiple) ||
      (Number.isFinite(trade.plannedRiskPln) && trade.plannedRiskPln > 0 && Number.isFinite(trade.pnlPln / trade.plannedRiskPln))),
    plannedRiskPln: availability(closed.items, (trade) => Number.isFinite(trade.plannedRiskPln) && trade.plannedRiskPln > 0),
    holdingHours: availability(closed.items, (trade) => Number.isFinite(trade.holdingHours) && trade.holdingHours >= 0),
    mfePct: availability(closed.items, (trade) => Number.isFinite(trade.mfePct)),
    maePct: availability(closed.items, (trade) => Number.isFinite(trade.maePct)),
    fees: availability(closed.items, (trade) => Number.isFinite(trade.entryFeePln) && trade.entryFeePln >= 0 &&
      Number.isFinite(trade.exitFeePln) && trade.exitFeePln >= 0),
  };
  const windows = [7, 30, 90].map((days) => {
    const cutoff = nowMs - days * DAY_MS;
    const runs = retained.items.filter((run) => timestamp(run.at) >= cutoff);
    // Endpoints describe retained time bounds, not continuous observation.
    const spanMs = times.length ? Math.max(0, times.at(-1) - Math.max(times[0], cutoff)) : 0;
    return {
      days,
      closedTrades: closed.items.filter((trade) => timestamp(trade.closedAt) >= cutoff).length,
      heartbeats: runs.length,
      equityPoints: runs.filter(hasEquity).length,
      retainedSpanDays: times.length ? round(spanMs / DAY_MS) : null,
      spanCoveragePct: times.length ? round(Math.min(100, (spanMs / (days * DAY_MS)) * 100)) : null,
      coverage: !times.length ? "NO_RETAINED_HISTORY" : spanMs >= days * DAY_MS ? "RETAINED_SPAN_REACHES_WINDOW" : "PARTIAL_RETAINED_SPAN",
      completeCoverage: false,
    };
  });
  const limitations = [
    "RETAINED_DATA_ONLY", "TIME_BOUNDS_DO_NOT_PROVE_CONTINUOUS_COVERAGE", "DESCRIPTIVE_STATISTICS_DO_NOT_ESTABLISH_EDGE",
    "TRADES_MAY_BE_DEPENDENT", "PAPER_RESULTS_ARE_SIMULATED", "SHADOW_FILLS_ARE_NOT_A_COMPARABLE_PORTFOLIO", "LIVE_READINESS_NOT_ASSESSED",
  ];
  if (!Number.isFinite(nowMs)) limitations.push("INVALID_GENERATION_TIME");
  if (![trades, history, shadowAudit].every(Array.isArray)) limitations.push("NON_ARRAY_INPUT_IGNORED");
  if (!closed.items.length) limitations.push("NO_VALID_CLOSED_TRADES");
  if (!times.length) limitations.push("NO_VALID_HEARTBEAT_HISTORY");
  if (closed.invalidCount || retained.invalidCount || shadow.invalidCount) limitations.push("INVALID_RECORDS_EXCLUDED");
  if (closed.duplicateCount || retained.duplicateCount || shadow.duplicateCount) limitations.push("DUPLICATE_RECORDS_EXCLUDED");
  if (Object.values(optionalMetrics).some((metric) => metric.missingCount)) limitations.push("OPTIONAL_TRADE_METRICS_MISSING");
  return {
    schemaVersion: 1,
    generatedAt: Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : null,
    status: closed.items.length ? "DESCRIPTIVE_ONLY" : "INSUFFICIENT_DATA",
    mode: "SHADOW_ONLY", paperAuthority: false, executable: false, brokerConnected: false,
    brokerAdapter: "NONE", canSubmitOrders: false, inferenceSupported: false, liveReadiness: false,
    closedTrades: {
      retainedCount: asArray(trades).length,
      validUniqueCount: closed.items.length,
      invalidCount: closed.invalidCount,
      duplicateCount: closed.duplicateCount,
      missingIdCount: closed.missingIdCount,
      ...bounds(closed.items.map((trade) => timestamp(trade.closedAt)), "earliestClosedAt", "latestClosedAt"),
      optionalMetrics,
    },
    history: {
      retainedCount: asArray(history).length,
      validUniqueCount: times.length,
      invalidCount: retained.invalidCount,
      duplicateCount: retained.duplicateCount,
      equityPoints: retained.items.filter(hasEquity).length,
      missingHealthCount: retained.items.filter((run) => !hasHealth(run)).length,
      missingEquityCount: retained.items.filter((run) => !hasEquity(run)).length,
      ...bounds(times, "earliestAt", "latestAt"),
      maxGapHours: gaps.length ? round(Math.max(...gaps)) : null,
      latestAgeHours: times.length ? round((nowMs - times.at(-1)) / 3600_000) : null,
    },
    windows,
    shadow: {
      retainedCount: asArray(shadowAudit).length,
      simulatedFills: shadow.items.filter((row) => row.status === "SIMULATED").length,
      rejections: shadow.items.filter((row) => row.status === "REJECTED").length,
      invalidCount: shadow.invalidCount,
      duplicateCount: shadow.duplicateCount,
      ...bounds(shadow.items.map((row) => timestamp(row.at)), "earliestAt", "latestAt"),
      comparableToPaper: false,
    },
    limitations,
  };
}
