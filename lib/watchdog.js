export const WATCHDOG_POLICY = Object.freeze({
  staleCriticalHours: 3.25,
  staleWarningHours: 2.75,
  futureToleranceMinutes: 10,
});

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function severityRank(level) {
  return { healthy: 0, warning: 1, critical: 2 }[level] ?? 0;
}

function maxSeverity(a, b) {
  return severityRank(a) >= severityRank(b) ? a : b;
}

export function evaluateWatchdog(
  latest,
  nowIso = new Date().toISOString(),
  policy = WATCHDOG_POLICY
) {
  const reasons = [];
  let severity = "healthy";

  if (!latest || typeof latest !== "object") {
    return {
      ok: false,
      alert: true,
      severity: "critical",
      status: "CRITICAL",
      fingerprint: "MISSING_HEARTBEAT",
      heartbeatAt: null,
      ageHours: null,
      healthStatus: null,
      healthScore: null,
      reasons: [{
        code: "MISSING_HEARTBEAT",
        message: "Brak poprawnego latest.json z autonomicznego heartbeat.",
      }],
    };
  }

  const heartbeatMs = Date.parse(latest.completedAt);
  const nowMs = Date.parse(nowIso);

  if (!Number.isFinite(heartbeatMs) || !Number.isFinite(nowMs)) {
    return {
      ok: false,
      alert: true,
      severity: "critical",
      status: "CRITICAL",
      fingerprint: "INVALID_HEARTBEAT_TIMESTAMP",
      heartbeatAt: latest.completedAt || null,
      ageHours: null,
      healthStatus: latest.health?.status || null,
      healthScore: latest.health?.score ?? null,
      reasons: [{
        code: "INVALID_HEARTBEAT_TIMESTAMP",
        message: "Nie można zweryfikować czasu ostatniego heartbeat.",
      }],
    };
  }

  const ageHours = (nowMs - heartbeatMs) / 3600_000;
  const futureMinutes = (heartbeatMs - nowMs) / 60_000;

  if (futureMinutes > policy.futureToleranceMinutes) {
    severity = "critical";
    reasons.push({
      code: "HEARTBEAT_FROM_FUTURE",
      message: `Heartbeat ma timestamp ${round(futureMinutes, 1)} min w przyszłości.`,
    });
  } else if (ageHours > policy.staleCriticalHours) {
    severity = "critical";
    reasons.push({
      code: "STALE_HEARTBEAT",
      message: `Brak świeżego heartbeat od ${round(ageHours, 2)} h.`,
    });
  } else if (ageHours > policy.staleWarningHours) {
    severity = maxSeverity(severity, "warning");
    reasons.push({
      code: "HEARTBEAT_LATE",
      message: `Heartbeat jest opóźniony: ${round(ageHours, 2)} h.`,
    });
  }

  const health = latest.health;
  if (!health || typeof health !== "object") {
    severity = maxSeverity(severity, "warning");
    reasons.push({
      code: "HEALTH_TELEMETRY_MISSING",
      message: "Brak health telemetry w latest.json.",
    });
  } else {
    if (health.status === "CRITICAL") {
      severity = "critical";
      reasons.push({
        code: "HEALTH_CRITICAL",
        message: `Agent health = CRITICAL (${health.score ?? "—"}/100).`,
      });
    } else if (health.status === "DEGRADED") {
      severity = maxSeverity(severity, "warning");
      reasons.push({
        code: "HEALTH_DEGRADED",
        message: `Agent health = DEGRADED (${health.score ?? "—"}/100).`,
      });
    }

    for (const alert of health.alerts || []) {
      if (alert?.severity !== "critical") continue;
      severity = "critical";
      reasons.push({
        code: alert.code || "HEALTH_ALERT",
        message: alert.message || "Krytyczny alert health.",
      });
    }
  }

  const paper = latest.paperPortfolio;
  if (paper?.halted) {
    severity = "critical";
    reasons.push({
      code: "PAPER_HARD_HALT",
      message: `Paper portfolio jest w HARD HALT: ${paper.haltReason || "unknown"}.`,
    });
  }

  const safeguards = latest.safeguards || {};
  const safetyViolations = [];
  if (safeguards.liveTrading !== false) safetyViolations.push("liveTrading");
  if (safeguards.brokerConnected !== false) safetyViolations.push("brokerConnected");
  if (safeguards.paperOnly !== true) safetyViolations.push("paperOnly");
  if (safeguards.orderSubmission === true) safetyViolations.push("orderSubmission");

  if (latest.shadowExecution) {
    if (latest.shadowExecution.executable !== false) {
      safetyViolations.push("shadowExecution.executable");
    }
    if (latest.shadowExecution.canSubmitOrders !== false) {
      safetyViolations.push("shadowExecution.canSubmitOrders");
    }
    if (latest.shadowExecution.brokerConnected !== false) {
      safetyViolations.push("shadowExecution.brokerConnected");
    }
  }

  if (safetyViolations.length) {
    severity = "critical";
    reasons.push({
      code: "SAFETY_INVARIANT_VIOLATION",
      message: `Naruszone bezpieczniki: ${safetyViolations.join(", ")}.`,
    });
  }

  const uniqueCodes = [...new Set(reasons.map((x) => x.code))].sort();
  const fingerprint = uniqueCodes.length ? uniqueCodes.join("|") : "HEALTHY";

  return {
    ok: severity === "healthy",
    alert: severity !== "healthy",
    severity,
    status:
      severity === "critical"
        ? "CRITICAL"
        : severity === "warning"
          ? "WARNING"
          : "HEALTHY",
    fingerprint,
    heartbeatAt: latest.completedAt,
    ageHours: round(Math.max(0, ageHours), 2),
    healthStatus: health?.status || null,
    healthScore: health?.score ?? null,
    paperHalted: Boolean(paper?.halted),
    reasons,
  };
}
