import assert from "node:assert/strict";
import { buildAgentHealth } from "../lib/agent-health.js";
import { evaluateWatchdog } from "../lib/watchdog.js";

const now = "2026-10-01T10:00:00.000Z";

function healthyLatest(overrides = {}) {
  return {
    completedAt: "2026-10-01T08:34:41.610Z",
    health: {
      score: 100,
      status: "HEALTHY",
      alerts: [],
    },
    paperPortfolio: {
      halted: false,
      haltReason: null,
    },
    safeguards: {
      liveTrading: false,
      brokerConnected: false,
      paperOnly: true,
      orderSubmission: false,
    },
    shadowExecution: {
      executable: false,
      canSubmitOrders: false,
      brokerConnected: false,
    },
    ...overrides,
  };
}

{
  const r = evaluateWatchdog(healthyLatest(), now);
  assert.equal(r.status, "HEALTHY");
  assert.equal(r.alert, false);
  assert.equal(r.fingerprint, "HEALTHY");
}

{
  const r = evaluateWatchdog(
    healthyLatest({ completedAt: "2026-10-01T06:00:00.000Z" }),
    now
  );
  assert.equal(r.status, "CRITICAL");
  assert.ok(r.reasons.some((x) => x.code === "STALE_HEARTBEAT"));
}

{
  const r = evaluateWatchdog(
    healthyLatest({
      health: { score: 60, status: "DEGRADED", alerts: [] },
    }),
    now
  );
  assert.equal(r.status, "WARNING");
  assert.ok(r.reasons.some((x) => x.code === "HEALTH_DEGRADED"));
}

{
  const r = evaluateWatchdog(
    healthyLatest({
      paperPortfolio: {
        halted: true,
        haltReason: "HARD_DRAWDOWN_STOP",
      },
    }),
    now
  );
  assert.equal(r.status, "CRITICAL");
  assert.ok(r.reasons.some((x) => x.code === "PAPER_HARD_HALT"));
}

{
  const r = evaluateWatchdog(
    healthyLatest({
      safeguards: {
        liveTrading: true,
        brokerConnected: false,
        paperOnly: true,
      },
    }),
    now
  );
  assert.equal(r.status, "CRITICAL");
  assert.ok(r.reasons.some((x) => x.code === "SAFETY_INVARIANT_VIOLATION"));
}

{
  const r = evaluateWatchdog(null, now);
  assert.equal(r.status, "CRITICAL");
  assert.equal(r.fingerprint, "MISSING_HEARTBEAT");
}

{
  const r = evaluateWatchdog(
    healthyLatest({
      shadowExecution: {
        executable: true,
        canSubmitOrders: false,
        brokerConnected: false,
      },
    }),
    now
  );
  assert.equal(r.status, "CRITICAL");
  assert.ok(
    r.reasons.some(
      (x) =>
        x.code === "SAFETY_INVARIANT_VIOLATION" &&
        x.message.includes("shadowExecution.executable")
    )
  );
}

{
  const r = evaluateWatchdog(
    healthyLatest({
      safeguards: {
        liveTrading: false,
        brokerConnected: false,
        paperOnly: true,
        orderSubmission: true,
      },
    }),
    now
  );
  assert.equal(r.status, "CRITICAL");
  assert.ok(
    r.reasons.some(
      (x) =>
        x.code === "SAFETY_INVARIANT_VIOLATION" &&
        x.message.includes("orderSubmission")
    )
  );
}

// A recovered historical gap must not mask current staleness or safety faults.
const recoveredHealth = buildAgentHealth({
  startedAt: "2026-10-01T09:59:30.000Z",
  completedAt: now,
  previousCompletedAt: "2026-10-01T03:15:06.000Z",
});
const recovered = healthyLatest({ completedAt: now, health: recoveredHealth });
assert.equal(evaluateWatchdog(recovered, now).status, "HEALTHY");
for (const [at, status, code] of [
  ["2026-10-01T12:45:00.000Z", "HEALTHY", null],
  ["2026-10-01T12:45:01.000Z", "WARNING", "HEARTBEAT_LATE"],
  ["2026-10-01T13:15:00.000Z", "WARNING", "HEARTBEAT_LATE"],
  ["2026-10-01T13:15:01.000Z", "CRITICAL", "STALE_HEARTBEAT"],
]) {
  const result = evaluateWatchdog(recovered, at);
  assert.equal(result.status, status);
  if (code) assert.ok(result.reasons.some((r) => r.code === code));
}
for (const key of ["liveTrading", "brokerConnected", "orderSubmission"]) {
  const result = evaluateWatchdog({
    ...recovered,
    safeguards: { ...recovered.safeguards, [key]: true },
  }, now);
  assert.equal(result.status, "CRITICAL");
  assert.ok(result.reasons.some((r) => r.code === "SAFETY_INVARIANT_VIOLATION"));
}
assert.equal(evaluateWatchdog({
  ...recovered,
  paperPortfolio: { halted: true, haltReason: "HARD_DRAWDOWN_STOP" },
}, now).status, "CRITICAL");

console.log("watchdog tests: OK");
