// Public research telemetry only. This report never authorizes an order.
export function buildOperationsMonitor({ nowMs = Date.now(), heartbeatAt, forecasts = [], expectedSymbols = 16 } = {}) {
  const heartbeatMs = typeof heartbeatAt === "string" ? Date.parse(heartbeatAt) : NaN;
  const ageMs = Number.isFinite(nowMs) && Number.isFinite(heartbeatMs) ? nowMs - heartbeatMs : null;
  const heartbeatFresh = ageMs !== null && ageMs >= 0 && ageMs <= 3.25 * 3600000;
  const rows = Array.isArray(forecasts) ? forecasts : [];
  const seen = new Set();
  const alerts = [];
  if (!heartbeatFresh) alerts.push({ code: "HEARTBEAT_UNAVAILABLE_OR_STALE", severity: "warning" });
  let ready = 0;
  let unavailable = 0;
  let degraded = 0;
  for (const row of rows) {
    if (typeof row?.symbol !== "string" || seen.has(row.symbol)) {
      alerts.push({ code: "INVALID_FORECAST_COVERAGE", severity: "warning" });
      continue;
    }
    seen.add(row.symbol);
    const f = row.forecastDiagnostics;
    const intervalMs = f?.intervalMs;
    const last = f?.dataQuality?.latestClosedTime;
    const fresh = Number.isFinite(nowMs) && Number.isFinite(last) && Number.isFinite(intervalMs)
      && intervalMs > 0 && last + intervalMs <= nowMs && nowMs - (last + intervalMs) < intervalMs;
    if (f?.status === "READY" && f?.dataQuality?.valid === true && fresh) {
      ready += 1;
      if (Number.isFinite(f.evaluation?.brierSkillScore) && f.evaluation.brierSkillScore < 0) degraded += 1;
    } else unavailable += 1;
  }
  if (!Number.isSafeInteger(expectedSymbols) || expectedSymbols < 1 || seen.size !== expectedSymbols) {
    alerts.push({ code: "FORECAST_COVERAGE_INCOMPLETE", severity: "warning" });
  }
  if (unavailable) alerts.push({ code: "FORECAST_DATA_UNAVAILABLE", severity: "warning" });
  if (degraded) alerts.push({ code: "FORECAST_BELOW_BASELINE", severity: "info" });
  return {
    schemaVersion: 1,
    diagnosticOnly: true,
    canSubmitOrders: false,
    status: alerts.some((x) => x.severity === "warning") ? "ATTENTION" : "OBSERVING",
    heartbeat: { fresh: heartbeatFresh, ageMs },
    forecasts: { expected: expectedSymbols, observed: seen.size, ready, unavailable, belowBaseline: degraded },
    alerts,
    execution: {
      connected: false,
      liveEnabled: false,
      pendingOrders: null,
      unknownOrders: null,
      readiness: "NOT_CONNECTED",
      blockers: ["BROKER_NOT_CONNECTED", "DURABLE_WORKER_NOT_DEPLOYED", "LIVE_RISK_GATE_NOT_INTEGRATED"],
    },
  };
}
