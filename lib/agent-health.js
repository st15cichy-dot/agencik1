const SCHEDULE_HOURS = 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function hoursBetween(a, b) {
  const start = Date.parse(a);
  const end = Date.parse(b);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (end - start) / 3600_000;
}

function failedGateChecks(item) {
  const checks = item?.gate?.checks || {};
  return Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
}

export function buildAgentHealth({
  startedAt,
  completedAt,
  previousCompletedAt = null,
  expectedSymbols = 0,
  screen = [],
  deep = [],
  failures = [],
  paperPortfolio = null,
}) {
  const alerts = [];
  const durationSeconds = Math.max(
    0,
    (Date.parse(completedAt) - Date.parse(startedAt)) / 1000
  );
  const coveragePct =
    expectedSymbols > 0
      ? (screen.length / expectedSymbols) * 100
      : 100;
  const previousGapHours = previousCompletedAt
    ? hoursBetween(previousCompletedAt, startedAt)
    : null;

  let score = 100;

  if (failures.length) {
    score -= Math.min(40, failures.length * 10);
    alerts.push({
      severity: failures.length >= 3 ? "critical" : "warning",
      code: "RUN_FAILURES",
      message: `${failures.length} błąd/błędy w bieżącym heartbeat.`,
      detail: failures.slice(0, 3).map((x) => `${x.stage}:${x.symbol || "GLOBAL"}`).join(", "),
    });
  }

  if (coveragePct < 100) {
    score -= Math.min(
      30,
      Math.round(((100 - coveragePct) / 100) * 30)
    );
    alerts.push({
      severity: coveragePct < 70 ? "critical" : "warning",
      code: "SCREEN_COVERAGE",
      message: `Screening pokrył ${round(coveragePct, 1)}% uniwersum.`,
      detail: `${screen.length}/${expectedSymbols} instrumentów`,
    });
  }

  if (durationSeconds > 15 * 60) {
    score -= 20;
    alerts.push({
      severity: "warning",
      code: "HEARTBEAT_SLOW",
      message: "Heartbeat trwał ponad 15 minut.",
      detail: `${round(durationSeconds / 60, 1)} min`,
    });
  } else if (durationSeconds > 8 * 60) {
    score -= 10;
  } else if (durationSeconds > 4 * 60) {
    score -= 5;
  }

  if (Number.isFinite(previousGapHours) && previousGapHours > 4.5) {
    score -= 15;
    alerts.push({
      severity: previousGapHours > 6 ? "critical" : "warning",
      code: "MISSED_HEARTBEAT_WINDOW",
      message: "Przerwa między heartbeatami była zbyt długa.",
      detail: `${round(previousGapHours, 2)} h`,
    });
  } else if (Number.isFinite(previousGapHours) && previousGapHours > 3) {
    score -= 8;
    alerts.push({
      severity: "warning",
      code: "HEARTBEAT_LATE",
      message: "Heartbeat uruchomił się później niż oczekiwano.",
      detail: `${round(previousGapHours, 2)} h`,
    });
  }

  const paperIssues = [];
  if (paperPortfolio) {
    if (!Number.isFinite(paperPortfolio.equityPln) || paperPortfolio.equityPln < 0) {
      paperIssues.push("invalid_equity");
    }
    if (!Number.isFinite(paperPortfolio.cashPln) || paperPortfolio.cashPln < 0) {
      paperIssues.push("invalid_cash");
    }
    if ((paperPortfolio.openPositionsCount || 0) > 3) {
      paperIssues.push("too_many_positions");
    }
    if ((paperPortfolio.grossExposurePct || 0) > 100.5) {
      paperIssues.push("gross_exposure");
    }

    if (paperPortfolio.halted) {
      score -= 10;
      alerts.push({
        severity: "critical",
        code: "PAPER_HARD_HALT",
        message: "Paper portfolio jest w stanie HARD HALT.",
        detail: paperPortfolio.haltReason || "HARD_DRAWDOWN_STOP",
      });
    } else if (paperPortfolio.dailyHalt) {
      score -= 5;
      alerts.push({
        severity: "warning",
        code: "PAPER_DAILY_HALT",
        message: "Aktywny dzienny halt paper portfolio.",
        detail: "Nowe wejścia są czasowo zablokowane.",
      });
    }
  }

  if (paperIssues.length) {
    score -= 40;
    alerts.push({
      severity: "critical",
      code: "PAPER_STATE_INTEGRITY",
      message: "Wykryto niespójność stanu paper portfolio.",
      detail: paperIssues.join(", "),
    });
  }

  score = clamp(Math.round(score), 0, 100);

  let status = "HEALTHY";
  if (score < 50) status = "CRITICAL";
  else if (score < 75) status = "DEGRADED";
  else if (score < 90) status = "WATCH";

  if (paperPortfolio?.halted || paperIssues.length) {
    status = "CRITICAL";
  }

  const completedMs = Date.parse(completedAt);
  const expectedNextHeartbeatAt = Number.isFinite(completedMs)
    ? new Date(completedMs + SCHEDULE_HOURS * 3600_000).toISOString()
    : null;

  return {
    score,
    status,
    durationSeconds: round(durationSeconds, 1),
    screenCoveragePct: round(coveragePct, 1),
    screenCount: screen.length,
    expectedSymbols,
    deepCount: deep.length,
    failureCount: failures.length,
    previousHeartbeatGapHours: round(previousGapHours, 2),
    expectedNextHeartbeatAt,
    checks: {
      runCompleted: Number.isFinite(Date.parse(completedAt)),
      fullScreenCoverage: coveragePct >= 100,
      noRunFailures: failures.length === 0,
      heartbeatDurationOk: durationSeconds <= 8 * 60,
      scheduleContinuity:
        previousGapHours == null || previousGapHours <= 3,
      paperStateIntegrity: paperIssues.length === 0,
      riskEngineNotHardHalted: !paperPortfolio?.halted,
    },
    alerts,
  };
}

export function buildDecisionEntries({
  completedAt,
  screen = [],
  deep = [],
  events = [],
  paperPortfolio = null,
  health = null,
}) {
  const entries = [];

  for (const item of screen) {
    const failed = failedGateChecks(item);
    entries.push({
      at: completedAt,
      category: "SCREEN",
      symbol: item.symbol,
      action: item.eligible ? "SCREEN_PASS" : "SCREEN_REJECT",
      strategy: item.strategy,
      reason: item.eligible
        ? `Gate ${item.gate?.passedCount || 0}/${item.gate?.totalChecks || 0}`
        : `Niespełnione: ${failed.join(", ") || "unknown"}`,
      metrics: {
        returnPct: item.returnPct,
        excessPct: item.excessPct,
        drawdownPct: item.drawdownPct,
        trades: item.trades,
      },
    });
  }

  for (const item of deep) {
    const failed = failedGateChecks(item);
    let action = "DEEP_REJECT";
    let reason = `Niespełnione: ${failed.join(", ") || "unknown"}`;

    if (item.eligible && item.paperReady) {
      action = "PAPER_ENTRY_CANDIDATE";
      reason = `Deep PASS + aktywne wejście; sygnał ${item.signalNow}`;
    } else if (item.eligible) {
      action = "WAIT_FOR_ENTRY";
      reason = `Deep PASS, brak aktywnego wejścia; sygnał ${item.signalNow}`;
    }

    entries.push({
      at: completedAt,
      category: "DEEP",
      symbol: item.symbol,
      action,
      strategy: item.strategy,
      reason,
      metrics: {
        returnPct: item.returnPct,
        excessPct: item.excessPct,
        drawdownPct: item.drawdownPct,
        profitFactor: item.profitFactor,
        wfPositive: item.wfPositive,
        wfTotal: item.wfTotal,
      },
    });
  }

  for (const event of events) {
    if (!String(event.type || "").startsWith("PAPER_")) continue;
    entries.push({
      at: completedAt,
      category: "PAPER",
      symbol: event.symbol,
      action: event.type,
      strategy: null,
      reason: event.message,
      metrics: null,
    });
  }

  entries.push({
    at: completedAt,
    category: "SYSTEM",
    symbol: "AGENT",
    action: "HEARTBEAT_SUMMARY",
    strategy: null,
    reason: `Health ${health?.status || "UNKNOWN"} ${health?.score ?? "—"}/100; ${paperPortfolio?.openPositionsCount || 0} otwartych paper`,
    metrics: {
      healthScore: health?.score ?? null,
      failures: health?.failureCount ?? null,
      screenCoveragePct: health?.screenCoveragePct ?? null,
      paperEquityPln: paperPortfolio?.equityPln ?? null,
      paperDrawdownPct: paperPortfolio?.drawdownPct ?? null,
    },
  });

  return entries;
}
