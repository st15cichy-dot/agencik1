import assert from "node:assert/strict";
import {
  buildAgentHealth,
  buildDecisionEntries,
} from "../lib/agent-health.js";

const basePaper = {
  equityPln: 200,
  cashPln: 200,
  openPositionsCount: 0,
  grossExposurePct: 0,
  dailyHalt: false,
  halted: false,
  haltReason: null,
};

{
  const health = buildAgentHealth({
    startedAt: "2026-10-01T10:00:00.000Z",
    completedAt: "2026-10-01T10:00:30.000Z",
    previousCompletedAt: "2026-10-01T08:00:00.000Z",
    expectedSymbols: 8,
    screen: Array.from({ length: 8 }, (_, i) => ({ symbol: `S${i}` })),
    deep: [],
    failures: [],
    paperPortfolio: basePaper,
  });

  assert.equal(health.score, 100);
  assert.equal(health.status, "HEALTHY");
  assert.equal(health.alerts.length, 0);
  assert.equal(health.checks.fullScreenCoverage, true);
}

{
  const health = buildAgentHealth({
    startedAt: "2026-10-01T10:00:00.000Z",
    completedAt: "2026-10-01T10:10:00.000Z",
    previousCompletedAt: "2026-10-01T04:00:00.000Z",
    expectedSymbols: 8,
    screen: [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }],
    deep: [],
    failures: [{ stage: "screen", symbol: "SOLUSDT", error: "timeout" }],
    paperPortfolio: basePaper,
  });

  assert.ok(health.score < 75);
  assert.ok(health.alerts.some((x) => x.code === "RUN_FAILURES"));
  assert.ok(health.alerts.some((x) => x.code === "SCREEN_COVERAGE"));
  assert.ok(health.alerts.some((x) => x.code === "MISSED_HEARTBEAT_WINDOW"));
}

{
  const health = buildAgentHealth({
    startedAt: "2026-10-01T10:00:00.000Z",
    completedAt: "2026-10-01T10:00:30.000Z",
    expectedSymbols: 8,
    screen: Array.from({ length: 8 }, (_, i) => ({ symbol: `S${i}` })),
    deep: [],
    failures: [],
    paperPortfolio: {
      ...basePaper,
      halted: true,
      haltReason: "HARD_DRAWDOWN_STOP",
    },
  });

  assert.equal(health.status, "CRITICAL");
  assert.ok(health.alerts.some((x) => x.code === "PAPER_HARD_HALT"));
}

{
  const entries = buildDecisionEntries({
    completedAt: "2026-10-01T10:00:30.000Z",
    screen: [{
      symbol: "BTCUSDT",
      eligible: true,
      strategy: "Breakout",
      gate: { passedCount: 7, totalChecks: 7, checks: { a: true } },
      returnPct: 5,
      excessPct: 2,
      drawdownPct: -3,
      trades: 10,
    }],
    deep: [{
      symbol: "BTCUSDT",
      eligible: true,
      paperReady: false,
      signalNow: "FLAT",
      strategy: "Breakout",
      gate: { checks: { a: true } },
      returnPct: 8,
      excessPct: 3,
      drawdownPct: -5,
      profitFactor: 1.5,
      wfPositive: 3,
      wfTotal: 5,
    }],
    events: [],
    paperPortfolio: basePaper,
    health: { status: "HEALTHY", score: 100, failureCount: 0, screenCoveragePct: 100 },
  });

  assert.ok(entries.some((x) => x.action === "SCREEN_PASS"));
  assert.ok(entries.some((x) => x.action === "WAIT_FOR_ENTRY"));
  assert.ok(entries.some((x) => x.action === "HEARTBEAT_SUMMARY"));
}

{
  const entries = buildDecisionEntries({
    completedAt: "2026-10-01T10:00:30.000Z",
    screen: [],
    deep: [],
    events: [{
      type: "GOVERNANCE_PROMOTED",
      symbol: "BTCUSDT",
      strategyVersion: "breakout@test",
      from: "SHADOW",
      to: "VALIDATED",
      message: "BTCUSDT governance promotion",
    }],
    paperPortfolio: basePaper,
    health: { status: "HEALTHY", score: 100, failureCount: 0, screenCoveragePct: 100 },
  });

  const governanceEntry = entries.find((x) => x.category === "GOVERNANCE");
  assert.ok(governanceEntry);
  assert.equal(governanceEntry.action, "GOVERNANCE_PROMOTED");
  assert.equal(governanceEntry.metrics.to, "VALIDATED");
}

{
  const entries = buildDecisionEntries({
    completedAt: "2026-10-01T10:00:30.000Z",
    screen: [],
    deep: [],
    events: [{
      type: "ALLOCATION_SHADOW_UPDATED",
      symbol: "PORTFOLIO",
      message: "Shadow allocation updated",
      selectedCandidates: 2,
      eligibleCandidates: 3,
      grossWeightPct: 100,
      maxPairCorrelation: 0.62,
    }],
    paperPortfolio: basePaper,
    health: { status: "HEALTHY", score: 100, failureCount: 0, screenCoveragePct: 100 },
  });

  const allocationEntry = entries.find((x) => x.category === "ALLOCATION");
  assert.ok(allocationEntry);
  assert.equal(allocationEntry.action, "ALLOCATION_SHADOW_UPDATED");
  assert.equal(allocationEntry.metrics.selectedCandidates, 2);
  assert.equal(allocationEntry.metrics.grossWeightPct, 100);
}

{
  const health = buildAgentHealth({
    startedAt: "2026-10-01T10:00:00.000Z",
    completedAt: "2026-10-01T10:00:30.000Z",
    expectedSymbols: 16,
    screen: Array.from({ length: 16 }, (_, i) => ({ symbol: `S${i}` })),
    deep: [],
    failures: [],
    paperPortfolio: {
      ...basePaper,
      openPositionsCount: 1,
      openPositions: [{ symbol: "AVAXUSDT" }],
    },
  });

  assert.equal(health.status, "CRITICAL");
  assert.equal(health.checks.paperUniverseIntegrity, false);
  assert.ok(
    health.alerts.some((x) => x.code === "PAPER_UNIVERSE_VIOLATION")
  );
}

{
  const entries = buildDecisionEntries({
    completedAt: "2026-10-01T10:00:30.000Z",
    screen: [],
    deep: [],
    events: [{
      type: "SHADOW_UNIVERSE_SIGNAL",
      symbol: "AVAXUSDT",
      message: "AVAXUSDT shadow signal",
      paperAuthority: false,
    }],
    paperPortfolio: basePaper,
    health: { status: "HEALTHY", score: 100, failureCount: 0, screenCoveragePct: 100 },
  });

  const universeEntry = entries.find((x) => x.category === "UNIVERSE");
  assert.ok(universeEntry);
  assert.equal(universeEntry.action, "SHADOW_UNIVERSE_SIGNAL");
  assert.equal(universeEntry.metrics.paperAuthority, false);
}

console.log("agent health tests: OK");
