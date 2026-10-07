import assert from "node:assert/strict";
import { buildOperationsMonitor } from "../lib/operations-monitor.js";

const nowMs = Date.UTC(2026, 9, 6, 20);
const good = { symbol: "BTCUSDT", forecastDiagnostics: { status: "READY", intervalMs: 3600000,
  dataQuality: { valid: true, latestClosedTime: nowMs - 3600000 }, evaluation: { brierSkillScore: 0.1 } } };
const build = (extra = {}) => buildOperationsMonitor({ nowMs, heartbeatAt: new Date(nowMs).toISOString(), forecasts: [good], expectedSymbols: 1, ...extra });
assert.equal(build().status, "OBSERVING");
assert.equal(build().execution.unknownOrders, null);
assert.equal(build().canSubmitOrders, false);
assert.equal(build().execution.liveEnabled, false);
assert.equal(build({ heartbeatAt: new Date(nowMs - 4 * 3600000).toISOString() }).status, "ATTENTION");
assert.equal(build({ heartbeatAt: new Date(nowMs + 1).toISOString() }).heartbeat.fresh, false);
assert.equal(build({ nowMs: NaN }).heartbeat.fresh, false);
assert.equal(build({ forecasts: [] }).status, "ATTENTION");
assert.ok(build({ forecasts: [good, good] }).alerts.some((x) => x.code === "INVALID_FORECAST_COVERAGE"));
assert.equal(build({ forecasts: [{ symbol: "BTCUSDT" }] }).forecasts.unavailable, 1);
const stale = structuredClone(good);
stale.forecastDiagnostics.dataQuality.latestClosedTime = nowMs - 6 * 3600000;
assert.equal(build({ forecasts: [stale] }).forecasts.ready, 0);
stale.forecastDiagnostics.dataQuality.latestClosedTime = nowMs - 2 * 3600000;
assert.equal(build({ forecasts: [stale] }).forecasts.ready, 0, "expired target hour is not current");
assert.equal(build({ nowMs: nowMs - 1, forecasts: [stale] }).forecasts.ready, 1, "valid until target closes");
const weak = structuredClone(good);
weak.forecastDiagnostics.evaluation.brierSkillScore = -0.2;
assert.equal(build({ forecasts: [weak] }).forecasts.belowBaseline, 1);
assert.equal(buildOperationsMonitor().execution.readiness, "NOT_CONNECTED");
console.log("Operations monitoring tests: OK");
