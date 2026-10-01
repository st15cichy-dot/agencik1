export const ALLOCATION_POLICY = Object.freeze({
  mode: "SHADOW_ONLY",
  paperAuthority: false,
  maxSelectedCandidates: 3,
  maxGrossWeightPct: 100,
  maxSingleWeightPct: 50,
  correlationWindowBars: 168,
  minCorrelationSamples: 48,
  correlationWarning: 0.75,
  correlationHardLimit: 0.90,
  maxSameStrategyFamily: 2,
  referenceRiskPerTradePct: 0.50,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function returnsMap(candles = [], maxBars = ALLOCATION_POLICY.correlationWindowBars) {
  const clean = candles
    .filter(
      (c) =>
        Number.isFinite(c?.time) &&
        Number.isFinite(c?.close) &&
        c.close > 0
    )
    .sort((a, b) => a.time - b.time)
    .slice(-(maxBars + 1));

  const map = new Map();
  for (let i = 1; i < clean.length; i += 1) {
    const prev = clean[i - 1];
    const curr = clean[i];
    if (prev.close <= 0) continue;
    map.set(curr.time, (curr.close / prev.close) - 1);
  }
  return map;
}

function standardDeviation(values) {
  if (!values.length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(Math.max(0, variance));
}

export function pairCorrelation(
  candlesA = [],
  candlesB = [],
  policy = ALLOCATION_POLICY
) {
  const a = returnsMap(candlesA, policy.correlationWindowBars);
  const b = returnsMap(candlesB, policy.correlationWindowBars);

  const xs = [];
  const ys = [];
  for (const [time, value] of a.entries()) {
    if (!b.has(time)) continue;
    xs.push(value);
    ys.push(b.get(time));
  }

  if (xs.length < policy.minCorrelationSamples) {
    return {
      correlation: null,
      samples: xs.length,
      sufficient: false,
    };
  }

  const meanX = xs.reduce((p, c) => p + c, 0) / xs.length;
  const meanY = ys.reduce((p, c) => p + c, 0) / ys.length;

  let covariance = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covariance += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denominator = Math.sqrt(varX * varY);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return {
      correlation: null,
      samples: xs.length,
      sufficient: false,
    };
  }

  return {
    correlation: round(clamp(covariance / denominator, -1, 1), 4),
    samples: xs.length,
    sufficient: true,
  };
}

function annualizedHourlyVolPct(candles = [], policy = ALLOCATION_POLICY) {
  const values = [...returnsMap(candles, policy.correlationWindowBars).values()];
  const sd = standardDeviation(values);
  if (!Number.isFinite(sd)) return null;
  return sd * Math.sqrt(24 * 365) * 100;
}

function lifecycleAdjustment(lifecycle) {
  return {
    ACTIVE: 14,
    VALIDATED: 9,
    SHADOW: 4,
    CANDIDATE: 0,
    DEGRADED: -18,
    RETIRED: -50,
  }[lifecycle] ?? 0;
}

function qualityScore(candidate) {
  const wfRatio =
    Number.isFinite(candidate?.wfPositive) &&
    Number.isFinite(candidate?.wfTotal) &&
    candidate.wfTotal > 0
      ? candidate.wfPositive / candidate.wfTotal
      : 0;

  const score =
    45 +
    clamp(candidate?.robustScore ?? 0, -50, 80) * 0.25 +
    clamp(candidate?.returnToDrawdown ?? 0, -3, 5) * 6 +
    clamp(candidate?.excessPct ?? 0, -20, 20) * 0.65 +
    clamp((candidate?.profitFactor ?? 1) - 1, -1, 3) * 6 +
    clamp(wfRatio - 0.5, -0.5, 0.5) * 20 -
    clamp(Math.abs(candidate?.drawdownPct ?? 0), 0, 30) * 0.35 +
    lifecycleAdjustment(candidate?.governance?.lifecycle) +
    (candidate?.paperReady ? 3 : 0);

  return round(clamp(score, 0, 100), 2);
}

function cappedInverseVolWeights(items, policy = ALLOCATION_POLICY) {
  if (!items.length) return new Map();

  if (items.length === 1) {
    return new Map([
      [items[0].symbol, Math.min(policy.maxSingleWeightPct, policy.maxGrossWeightPct)],
    ]);
  }

  const raw = items.map((item) => {
    const vol = Number.isFinite(item.realizedVolPct) && item.realizedVolPct > 0
      ? item.realizedVolPct
      : 100;
    return {
      symbol: item.symbol,
      value: 1 / Math.max(1, vol),
    };
  });

  const weights = new Map(raw.map((x) => [x.symbol, 0]));
  let remaining = policy.maxGrossWeightPct;
  let active = [...raw];

  while (active.length && remaining > 1e-8) {
    const total = active.reduce((sum, item) => sum + item.value, 0);
    if (!(total > 0)) {
      const equal = remaining / active.length;
      for (const item of active) {
        weights.set(
          item.symbol,
          weights.get(item.symbol) + Math.min(equal, policy.maxSingleWeightPct)
        );
      }
      break;
    }

    let cappedAny = false;
    const next = [];

    for (const item of active) {
      const current = weights.get(item.symbol);
      const proposal = current + remaining * (item.value / total);
      if (proposal >= policy.maxSingleWeightPct) {
        const add = Math.max(0, policy.maxSingleWeightPct - current);
        weights.set(item.symbol, current + add);
        remaining -= add;
        cappedAny = true;
      } else {
        next.push(item);
      }
    }

    if (!cappedAny) {
      for (const item of active) {
        weights.set(
          item.symbol,
          weights.get(item.symbol) + remaining * (item.value / total)
        );
      }
      remaining = 0;
      break;
    }

    active = next;
  }

  return new Map(
    [...weights.entries()].map(([symbol, weight]) => [
      symbol,
      round(Math.min(policy.maxSingleWeightPct, weight), 4),
    ])
  );
}

export function buildAllocationIntelligence({
  deep = [],
  marketBySymbol = {},
  portfolioEquityPln = 200,
  nowIso = new Date().toISOString(),
  policy = ALLOCATION_POLICY,
}) {
  const eligible = (Array.isArray(deep) ? deep : [])
    .filter((item) => item?.eligible)
    .map((item) => {
      const candles = marketBySymbol?.[item.symbol]?.candles || [];
      return {
        ...item,
        realizedVolPct: round(annualizedHourlyVolPct(candles, policy), 2),
        qualityScore: qualityScore(item),
      };
    })
    .sort(
      (a, b) =>
        (b.qualityScore ?? -1) - (a.qualityScore ?? -1) ||
        (b.returnToDrawdown ?? -999) - (a.returnToDrawdown ?? -999) ||
        String(a.symbol).localeCompare(String(b.symbol))
    );

  const pairwise = [];
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const a = eligible[i];
      const b = eligible[j];
      const corr = pairCorrelation(
        marketBySymbol?.[a.symbol]?.candles || [],
        marketBySymbol?.[b.symbol]?.candles || [],
        policy
      );
      pairwise.push({
        a: a.symbol,
        b: b.symbol,
        ...corr,
        flag:
          !corr.sufficient
            ? "INSUFFICIENT_DATA"
            : Math.abs(corr.correlation) >= policy.correlationHardLimit
              ? "HARD_CONCENTRATION"
              : Math.abs(corr.correlation) >= policy.correlationWarning
                ? "HIGH_CORRELATION"
                : "OK",
      });
    }
  }

  function correlationBetween(a, b) {
    const found = pairwise.find(
      (pair) =>
        (pair.a === a && pair.b === b) ||
        (pair.a === b && pair.b === a)
    );
    return found || null;
  }

  const selected = [];
  const decisions = new Map();
  const strategyCounts = new Map();

  for (const candidate of eligible) {
    if (selected.length >= policy.maxSelectedCandidates) {
      decisions.set(candidate.symbol, {
        selected: false,
        reason: "MAX_SELECTED_CANDIDATES",
        maxCorrelationToSelected: null,
      });
      continue;
    }

    if (candidate.governance?.lifecycle === "RETIRED") {
      decisions.set(candidate.symbol, {
        selected: false,
        reason: "SHADOW_GOVERNANCE_RETIRED",
        maxCorrelationToSelected: null,
      });
      continue;
    }

    const familyCount = strategyCounts.get(candidate.strategyId) || 0;
    if (familyCount >= policy.maxSameStrategyFamily) {
      decisions.set(candidate.symbol, {
        selected: false,
        reason: "STRATEGY_FAMILY_CONCENTRATION",
        maxCorrelationToSelected: null,
      });
      continue;
    }

    const correlations = selected
      .map((chosen) => correlationBetween(candidate.symbol, chosen.symbol))
      .filter((x) => x?.sufficient && Number.isFinite(x.correlation));

    const maxAbsCorrelation = correlations.length
      ? Math.max(...correlations.map((x) => Math.abs(x.correlation)))
      : null;

    if (
      Number.isFinite(maxAbsCorrelation) &&
      maxAbsCorrelation >= policy.correlationHardLimit
    ) {
      decisions.set(candidate.symbol, {
        selected: false,
        reason: "CORRELATION_HARD_LIMIT",
        maxCorrelationToSelected: round(maxAbsCorrelation, 4),
      });
      continue;
    }

    selected.push(candidate);
    strategyCounts.set(candidate.strategyId, familyCount + 1);
    decisions.set(candidate.symbol, {
      selected: true,
      reason:
        Number.isFinite(maxAbsCorrelation) &&
        maxAbsCorrelation >= policy.correlationWarning
          ? "SELECTED_WITH_CORRELATION_WARNING"
          : "SELECTED",
      maxCorrelationToSelected: round(maxAbsCorrelation, 4),
    });
  }

  const weights = cappedInverseVolWeights(selected, policy);
  const selectedSymbols = new Set(selected.map((x) => x.symbol));
  const referenceRiskPerTradePln =
    Number.isFinite(portfolioEquityPln) && portfolioEquityPln > 0
      ? portfolioEquityPln * (policy.referenceRiskPerTradePct / 100)
      : null;

  const rankedCandidates = eligible.map((candidate, index) => {
    const decision = decisions.get(candidate.symbol) || {
      selected: false,
      reason: "NOT_SELECTED",
      maxCorrelationToSelected: null,
    };
    const weightPct = decision.selected
      ? weights.get(candidate.symbol) || 0
      : 0;

    return {
      rank: index + 1,
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      strategyId: candidate.strategyId,
      strategyVersion: candidate.strategyVersion || null,
      lifecycle: candidate.governance?.lifecycle || "UNTRACKED",
      paperReady: Boolean(candidate.paperReady),
      qualityScore: candidate.qualityScore,
      realizedVolPct: candidate.realizedVolPct,
      returnToDrawdown: round(candidate.returnToDrawdown),
      excessPct: round(candidate.excessPct),
      drawdownPct: round(candidate.drawdownPct),
      profitFactor: round(candidate.profitFactor),
      selected: decision.selected,
      decision: decision.reason,
      maxCorrelationToSelected: decision.maxCorrelationToSelected,
      recommendedWeightPct: round(weightPct, 2),
      recommendedNotionalPln:
        Number.isFinite(portfolioEquityPln)
          ? round(portfolioEquityPln * (weightPct / 100), 2)
          : null,
      referenceRiskPerTradePln: round(referenceRiskPerTradePln, 2),
    };
  });

  const basketPairs = pairwise.filter(
    (pair) => selectedSymbols.has(pair.a) && selectedSymbols.has(pair.b)
  );
  const basketCorrelations = basketPairs
    .filter((x) => x.sufficient && Number.isFinite(x.correlation))
    .map((x) => Math.abs(x.correlation));

  const grossWeightPct = round(
    [...weights.values()].reduce((sum, value) => sum + value, 0),
    2
  );
  const cashWeightPct = round(
    Math.max(0, policy.maxGrossWeightPct - grossWeightPct),
    2
  );
  const maxPairCorrelation = basketCorrelations.length
    ? round(Math.max(...basketCorrelations), 4)
    : null;

  const warnings = [];
  if (eligible.length === 0) warnings.push("NO_DEEP_ELIGIBLE_CANDIDATES");
  if (pairwise.some((x) => x.flag === "INSUFFICIENT_DATA")) {
    warnings.push("CORRELATION_DATA_INCOMPLETE");
  }
  if (
    pairwise.some(
      (x) =>
        x.flag === "HIGH_CORRELATION" ||
        x.flag === "HARD_CONCENTRATION"
    )
  ) {
    warnings.push("CORRELATION_CONCENTRATION_PRESENT");
  }

  return {
    schemaVersion: 1,
    appVersion: "0.12.0",
    generatedAt: nowIso,
    mode: "SHADOW_ONLY",
    paperAuthority: false,
    policy,
    summary: {
      eligibleCandidates: eligible.length,
      selectedCandidates: selected.length,
      grossWeightPct,
      cashWeightPct,
      maxPairCorrelation,
      referencePortfolioEquityPln: round(portfolioEquityPln, 2),
      referenceRiskPerTradePln: round(referenceRiskPerTradePln, 2),
      warnings,
    },
    rankedCandidates,
    pairwiseCorrelations: pairwise,
    shadowBasket: rankedCandidates.filter((x) => x.selected),
  };
}
