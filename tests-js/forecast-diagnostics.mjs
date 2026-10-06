import assert from "node:assert/strict";
import { buildForecastDiagnostics } from "../lib/forecast-diagnostics.js";
import { normalizeClosedKlines } from "../lib/research.js";

const HOUR = 3600000;
const start = 1700002800000; // UTC hour boundary
const series = (count) => Array.from({ length: count }, (_, i) => ({
  time: start + i * HOUR, open: 100 + i, high: 102 + i,
  low: 99 + i, close: 101 + i, volume: 5,
}));
const bars = series(90);
const clock = (xs) => xs.at(-1).time + HOUR;
const build = (xs) => buildForecastDiagnostics(xs, { nowMs: clock(xs) });
const full = build(bars);
assert.equal(full.status, "READY");
assert.equal(full.executable, false);
assert.equal(full.calibrated, false);
assert.equal(full.next.upProbability, 49 / 50);
assert.equal(full.evaluation.sampleCount, 65);
assert.equal(full.evaluation.baselineBrierScore, 0.25);
assert.ok(full.evaluation.brierScore < 0.002);
assert.ok(full.evaluation.brierSkillScore > 0);
assert.equal(full.predictions.at(-1).observedUp, null);
assert.equal(full.predictions[0].upProbability, 25 / 26);
const expectedBrier = full.predictions.slice(0, -1)
  .reduce((sum, p) => sum + (1 - p.upProbability) ** 2, 0) / 65;
assert.equal(full.evaluation.brierScore, expectedBrier);
const flat = bars.map((bar) => ({ ...bar, open: 100, high: 100, low: 100, close: 100 }));
assert.equal(build(flat).next.upProbability, 1 / 50); // flat is not an up move
assert.ok(build(flat).predictions.slice(0, -1).every((p) => p.observedUp === 0));
// Prefix invariance compares forecast values, not later-observed targets.
for (const count of [25, 26, 40, 60]) {
  const prefix = build(bars.slice(0, count));
  for (const p of prefix.predictions) {
    assert.equal(p.upProbability, full.predictions.find((x) => x.asOfTime === p.asOfTime).upProbability);
  }
}
const perturbed = bars.map((bar, i) => i < 50 ? bar : { ...bar, open: 500, high: 501, low: 499, close: 500 });
assert.deepEqual(build(perturbed).predictions.slice(0, 25), full.predictions.slice(0, 25));
const small = build(bars.slice(0, 24));
assert.equal(small.status, "INSUFFICIENT_DATA");
assert.equal(small.next.upProbability, null);
assert.equal(small.evaluation.brierScore, null);
const minimal = build(bars.slice(0, 25));
assert.equal(minimal.evaluation.sampleCount, 0);
assert.equal(minimal.evaluation.baselineBrierScore, null);
assert.equal(buildForecastDiagnostics([], { nowMs: clock(bars) }).next.upProbability, null);

for (const [xs, issue] of [
  [bars.filter((_, i) => i !== 10), "NONCONTIGUOUS_CANDLES"],
  [[...bars.slice(0, 10), bars[9], ...bars.slice(10)], "DUPLICATE_CANDLE"],
  [[bars[1], bars[0], ...bars.slice(2)], "UNORDERED_CANDLES"],
  [bars.map((bar, i) => i === 10 ? { ...bar, close: NaN } : bar), "MALFORMED_CANDLE"],
  [bars.map((bar, i) => i === 10 ? { ...bar, volume: -1 } : bar), "MALFORMED_CANDLE"],
]) {
  const result = buildForecastDiagnostics(xs, { nowMs: clock(bars) });
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.dataQuality.issues.includes(issue));
  assert.equal(result.next.upProbability, null);
  assert.equal(result.evaluation.brierScore, null);
}
assert.equal(buildForecastDiagnostics(bars, { nowMs: clock(bars) + HOUR }).status, "BLOCKED");
assert.equal(buildForecastDiagnostics(bars, { nowMs: NaN }).status, "BLOCKED");
assert.equal(buildForecastDiagnostics(bars, { intervalMs: 0 }).status, "BLOCKED");
const unclosed = { ...bars.at(-1), time: clock(bars) };
const filtered = buildForecastDiagnostics([...bars, unclosed], { nowMs: clock(bars) + 100 });
assert.equal(filtered.status, "READY");
assert.equal(filtered.dataQuality.excludedUnclosedBars, 1);
assert.equal(filtered.next.upProbability, full.next.upProbability);
const future = buildForecastDiagnostics([...bars, { ...unclosed, time: unclosed.time + HOUR }], { nowMs: clock(bars) });
assert.equal(future.status, "BLOCKED");
assert.ok(future.dataQuality.issues.includes("FUTURE_CANDLE"));
const klines = [...bars, unclosed].map((bar) => [bar.time, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume)]);
assert.deepEqual(normalizeClosedKlines(klines, { nowMs: clock(bars) + 100 }), bars);
assert.throws(() => normalizeClosedKlines([...klines, klines.at(-1)], { nowMs: clock(bars) + 100 }), /DUPLICATE/);
assert.throws(() => normalizeClosedKlines([[bars[0].time, 1, 1, 1, 1, null]], { nowMs: clock(bars) }), /pola/);
assert.throws(() => normalizeClosedKlines(klines, { nowMs: clock(bars), total: 0 }), /liczba/);
console.log("forecast diagnostics: PASS (causality, scoring, quality and closed klines)");
