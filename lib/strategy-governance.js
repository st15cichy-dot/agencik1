export const STRATEGY_GOVERNANCE_POLICY = Object.freeze({
  mode: "SHADOW_ONLY",
  paperAuthority: false,
  validatedMinObservations: 3,
  validatedMinPassRatePct: 66.67,
  activeMinObservations: 5,
  activeMinPassRatePct: 80,
  recoveryConsecutivePasses: 2,
  degradeConsecutiveFails: 2,
  retireConsecutiveFails: 4,
  maxScoreHistory: 24,
});

const LIFECYCLE_WEIGHT = Object.freeze({
  ACTIVE: 500,
  VALIDATED: 400,
  SHADOW: 300,
  CANDIDATE: 150,
  DEGRADED: 75,
  RETIRED: 0,
});

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableObject(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableObject(value));
}

function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

export function strategyVersion(strategyId, config = {}) {
  const family = String(strategyId || "unknown");
  return `${family}@${fnv1a(`${family}:${stableStringify(config)}`)}`;
}

function lifecycleFor(previousLifecycle, record) {
  const policy = STRATEGY_GOVERNANCE_POLICY;

  if (previousLifecycle === "RETIRED") return "RETIRED";

  if (record.consecutiveFails >= policy.retireConsecutiveFails) {
    return "RETIRED";
  }

  if (
    record.consecutiveFails >= policy.degradeConsecutiveFails &&
    ["VALIDATED", "ACTIVE", "DEGRADED"].includes(previousLifecycle)
  ) {
    return "DEGRADED";
  }

  if (previousLifecycle === "DEGRADED") {
    if (
      record.lastEligible &&
      record.consecutivePasses >= policy.recoveryConsecutivePasses
    ) {
      return "SHADOW";
    }
    return "DEGRADED";
  }

  if (record.lastEligible) {
    if (
      record.observations >= policy.activeMinObservations &&
      record.passRatePct >= policy.activeMinPassRatePct &&
      record.consecutivePasses >= 2
    ) {
      return "ACTIVE";
    }

    if (
      record.observations >= policy.validatedMinObservations &&
      record.passRatePct >= policy.validatedMinPassRatePct
    ) {
      return "VALIDATED";
    }

    return "SHADOW";
  }

  return previousLifecycle === "SHADOW"
    ? "SHADOW"
    : previousLifecycle === "VALIDATED" || previousLifecycle === "ACTIVE"
      ? previousLifecycle
      : "CANDIDATE";
}

function governanceScore(record) {
  const lifecycle = LIFECYCLE_WEIGHT[record.lifecycle] ?? 0;
  const passRate = Number.isFinite(record.passRatePct) ? record.passRatePct : 0;
  const robust = Number.isFinite(record.lastMetrics?.robustScore)
    ? Math.max(-100, Math.min(100, record.lastMetrics.robustScore))
    : 0;
  const excess = Number.isFinite(record.lastMetrics?.excessPct)
    ? Math.max(-50, Math.min(50, record.lastMetrics.excessPct))
    : 0;
  const drawdown = Number.isFinite(record.lastMetrics?.drawdownPct)
    ? Math.abs(record.lastMetrics.drawdownPct)
    : 0;

  return round(
    lifecycle +
      passRate +
      robust * 0.1 +
      excess * 0.2 -
      drawdown * 0.05,
    4
  );
}

function transitionEvent(before, after) {
  if (!before) {
    return {
      type: "GOVERNANCE_OBSERVED",
      symbol: after.symbol,
      message: `${after.symbol}: nowa wersja ${after.version} → ${after.lifecycle} (shadow only)`,
      strategyVersion: after.version,
      from: null,
      to: after.lifecycle,
    };
  }

  if (before.lifecycle === after.lifecycle) return null;

  let type = "GOVERNANCE_TRANSITION";
  if (after.lifecycle === "RETIRED") type = "GOVERNANCE_RETIRED";
  else if (after.lifecycle === "DEGRADED") type = "GOVERNANCE_DEGRADED";
  else if (
    ["VALIDATED", "ACTIVE"].includes(after.lifecycle) &&
    !["VALIDATED", "ACTIVE"].includes(before.lifecycle)
  ) {
    type = "GOVERNANCE_PROMOTED";
  } else if (
    before.lifecycle === "DEGRADED" &&
    after.lifecycle === "SHADOW"
  ) {
    type = "GOVERNANCE_RECOVERY";
  }

  return {
    type,
    symbol: after.symbol,
    message: `${after.symbol}: ${after.version} ${before.lifecycle} → ${after.lifecycle} (shadow only)`,
    strategyVersion: after.version,
    from: before.lifecycle,
    to: after.lifecycle,
  };
}

function normalizeRecord(input) {
  if (!input || typeof input !== "object") return null;
  if (!input.id || !input.symbol || !input.version) return null;

  return {
    ...input,
    observations: Number.isFinite(input.observations) ? Math.max(0, input.observations) : 0,
    passes: Number.isFinite(input.passes) ? Math.max(0, input.passes) : 0,
    fails: Number.isFinite(input.fails) ? Math.max(0, input.fails) : 0,
    consecutivePasses: Number.isFinite(input.consecutivePasses)
      ? Math.max(0, input.consecutivePasses)
      : 0,
    consecutiveFails: Number.isFinite(input.consecutiveFails)
      ? Math.max(0, input.consecutiveFails)
      : 0,
    scoreHistory: Array.isArray(input.scoreHistory)
      ? input.scoreHistory.slice(-STRATEGY_GOVERNANCE_POLICY.maxScoreHistory)
      : [],
    lifecycle: LIFECYCLE_WEIGHT[input.lifecycle] == null
      ? "CANDIDATE"
      : input.lifecycle,
    paperAuthority: false,
  };
}

function normalizePrevious(previous) {
  const records = Array.isArray(previous?.records)
    ? previous.records.map(normalizeRecord).filter(Boolean)
    : [];

  return {
    schemaVersion: 1,
    appVersion: "0.12.0",
    mode: "SHADOW_ONLY",
    paperAuthority: false,
    records,
  };
}

function compactRecord(record) {
  return {
    id: record.id,
    symbol: record.symbol,
    strategyId: record.strategyId,
    strategyName: record.strategyName,
    config: record.config,
    version: record.version,
    lifecycle: record.lifecycle,
    observations: record.observations,
    passes: record.passes,
    fails: record.fails,
    passRatePct: record.passRatePct,
    consecutivePasses: record.consecutivePasses,
    consecutiveFails: record.consecutiveFails,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    lastEligible: record.lastEligible,
    lastMetrics: record.lastMetrics,
    governanceScore: record.governanceScore,
    paperAuthority: false,
  };
}

export function updateStrategyGovernance({
  previous = null,
  deep = [],
  nowIso = new Date().toISOString(),
}) {
  const normalized = normalizePrevious(previous);
  const records = new Map(
    normalized.records.map((record) => [record.id, record])
  );
  const events = [];
  const annotations = {};

  for (const item of Array.isArray(deep) ? deep : []) {
    if (!item?.symbol || !item?.strategyId) continue;

    const version = item.strategyVersion || strategyVersion(item.strategyId, item.config);
    const id = `${item.symbol}|${version}`;
    const before = records.get(id) || null;
    const eligible = Boolean(item.eligible);

    const observations = (before?.observations || 0) + 1;
    const passes = (before?.passes || 0) + (eligible ? 1 : 0);
    const fails = (before?.fails || 0) + (eligible ? 0 : 1);
    const scoreHistory = [
      ...(before?.scoreHistory || []),
      {
        at: nowIso,
        robustScore: round(item.robustScore),
        returnPct: round(item.returnPct),
        excessPct: round(item.excessPct),
        drawdownPct: round(item.drawdownPct),
        eligible,
      },
    ].slice(-STRATEGY_GOVERNANCE_POLICY.maxScoreHistory);

    const record = {
      id,
      symbol: item.symbol,
      strategyId: item.strategyId,
      strategyName: item.strategy,
      config: item.config || {},
      version,
      lifecycle: before?.lifecycle || "CANDIDATE",
      observations,
      passes,
      fails,
      passRatePct: round((passes / observations) * 100, 2),
      consecutivePasses: eligible
        ? (before?.consecutivePasses || 0) + 1
        : 0,
      consecutiveFails: eligible
        ? 0
        : (before?.consecutiveFails || 0) + 1,
      firstSeenAt: before?.firstSeenAt || nowIso,
      lastSeenAt: nowIso,
      lastEligible: eligible,
      lastMetrics: {
        robustScore: round(item.robustScore),
        returnPct: round(item.returnPct),
        excessPct: round(item.excessPct),
        drawdownPct: round(item.drawdownPct),
        profitFactor: round(item.profitFactor),
        wfPositive: item.wfPositive ?? null,
        wfTotal: item.wfTotal ?? null,
        parameterStabilityPct: round(item.parameterStabilityPct),
      },
      scoreHistory,
      paperAuthority: false,
    };

    record.lifecycle = lifecycleFor(before?.lifecycle || "CANDIDATE", record);
    record.governanceScore = governanceScore(record);
    records.set(id, record);

    const event = transitionEvent(before, record);
    if (event) events.push(event);

    annotations[id] = {
      version,
      lifecycle: record.lifecycle,
      observations: record.observations,
      passRatePct: record.passRatePct,
      governanceScore: record.governanceScore,
      paperAuthority: false,
    };
  }

  const allRecords = [...records.values()]
    .map((record) => ({
      ...record,
      governanceScore: governanceScore(record),
      paperAuthority: false,
    }))
    .sort((a, b) => {
      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
      return (b.governanceScore || 0) - (a.governanceScore || 0);
    });

  const symbols = [...new Set(allRecords.map((record) => record.symbol))];
  const champions = symbols.map((symbol) => {
    const eligible = allRecords
      .filter(
        (record) =>
          record.symbol === symbol &&
          record.lifecycle !== "RETIRED"
      )
      .sort(
        (a, b) =>
          (b.governanceScore || 0) - (a.governanceScore || 0)
      );

    const champion = eligible[0] || null;
    const challengers = eligible.slice(1, 4);

    return {
      symbol,
      champion: champion
        ? {
            version: champion.version,
            strategy: champion.strategyName,
            lifecycle: champion.lifecycle,
            passRatePct: champion.passRatePct,
            observations: champion.observations,
            governanceScore: champion.governanceScore,
          }
        : null,
      challengers: challengers.map((record) => ({
        version: record.version,
        strategy: record.strategyName,
        lifecycle: record.lifecycle,
        passRatePct: record.passRatePct,
        observations: record.observations,
        governanceScore: record.governanceScore,
      })),
      paperAuthority: false,
    };
  });

  const counts = allRecords.reduce(
    (acc, record) => {
      acc[record.lifecycle] = (acc[record.lifecycle] || 0) + 1;
      return acc;
    },
    {
      CANDIDATE: 0,
      SHADOW: 0,
      VALIDATED: 0,
      ACTIVE: 0,
      DEGRADED: 0,
      RETIRED: 0,
    }
  );

  return {
    governance: {
      schemaVersion: 1,
      appVersion: "0.12.0",
      mode: "SHADOW_ONLY",
      paperAuthority: false,
      generatedAt: nowIso,
      policy: STRATEGY_GOVERNANCE_POLICY,
      counts,
      records: allRecords.map(compactRecord),
      champions,
      recentEvents: events.slice(-30),
    },
    annotations,
    events,
  };
}
