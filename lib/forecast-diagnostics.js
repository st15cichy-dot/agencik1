// Empirical diagnostic, not a calibrated forecast or an execution signal.
const MIN_SAMPLES = 24;
const WINDOW = 48;

export function buildForecastDiagnostics(candles, { nowMs = Date.now(), intervalMs = 3600000 } = {}) {
  const issues = new Set();
  const validClock = Number.isSafeInteger(nowMs) && nowMs > 0 &&
    Number.isSafeInteger(intervalMs) && intervalMs > 0;
  if (!validClock) issues.add("INVALID_CLOCK");
  if (!Array.isArray(candles)) issues.add("MALFORMED_SERIES");
  const closed = [];
  let excludedUnclosedBars = 0;
  let previous = null;
  const seen = new Set();
  for (const candle of Array.isArray(candles) ? candles : []) {
    if (!candle || ![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) ||
        !Number.isSafeInteger(candle.time) || candle.time <= 0 ||
        Math.min(candle.open, candle.high, candle.low, candle.close) <= 0 || candle.volume < 0 ||
        candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) {
      issues.add("MALFORMED_CANDLE");
      continue;
    }
    if (seen.has(candle.time)) issues.add("DUPLICATE_CANDLE");
    seen.add(candle.time);
    if (previous !== null && candle.time < previous) issues.add("UNORDERED_CANDLES");
    previous = candle.time;
    if (!validClock) continue;
    if (candle.time > nowMs) issues.add("FUTURE_CANDLE");
    if (candle.time + intervalMs > nowMs) {
      excludedUnclosedBars += 1;
      continue;
    }
    if (candle.time % intervalMs !== 0) issues.add("MISALIGNED_CANDLE");
    if (closed.length && candle.time - closed.at(-1).time !== intervalMs) issues.add("NONCONTIGUOUS_CANDLES");
    closed.push(candle);
  }
  const latestClosedTime = closed.at(-1)?.time ?? null;
  const ageMs = validClock && latestClosedTime !== null ? nowMs - (latestClosedTime + intervalMs) : null;
  // One missing completed interval is already stale for a one-bar forecast.
  if (ageMs !== null && ageMs >= intervalMs) issues.add("STALE_DATA");
  const valid = issues.size === 0;
  const predictions = [];
  const outcomes = [];
  if (valid) {
    for (let i = 1; i < closed.length; i += 1) {
      outcomes.push(closed[i].close > closed[i - 1].close ? 1 : 0);
      if (outcomes.length > WINDOW) outcomes.shift();
      if (outcomes.length < MIN_SAMPLES) continue;
      const probability = (outcomes.reduce((sum, value) => sum + value, 0) + 1) / (outcomes.length + 2);
      // Fit only through i; the target i+1 is read only for scoring, never fitting.
      predictions.push({
        asOfTime: closed[i].time + intervalMs,
        targetTime: closed[i].time + intervalMs,
        upProbability: probability,
        observedUp: i + 1 < closed.length ? Number(closed[i + 1].close > closed[i].close) : null,
      });
    }
  }
  const scored = predictions.filter((prediction) => prediction.observedUp !== null);
  const brierScore = scored.length ? scored.reduce((sum, p) => sum + (p.upProbability - p.observedUp) ** 2, 0) / scored.length : null;
  return {
    schemaVersion: 1,
    diagnosticOnly: true,
    executable: false,
    calibrated: false,
    model: "ROLLING_UP_FREQUENCY_LAPLACE",
    horizonBars: 1,
    intervalMs,
    trainingWindow: WINDOW,
    minimumTrainingSamples: MIN_SAMPLES,
    status: !valid ? "BLOCKED" : predictions.length ? "READY" : "INSUFFICIENT_DATA",
    dataQuality: { valid, issues: [...issues], closedBars: closed.length, excludedUnclosedBars, latestClosedTime, ageMs },
    next: {
      upProbability: predictions.at(-1)?.upProbability ?? null,
      trainingSamples: valid ? outcomes.length : 0,
      asOfTime: predictions.at(-1)?.asOfTime ?? null,
    },
    evaluation: {
      sampleCount: scored.length,
      brierScore,
      baselineBrierScore: scored.length ? 0.25 : null,
      brierSkillScore: brierScore === null ? null : 1 - brierScore / 0.25,
    },
    predictions,
  };
}
