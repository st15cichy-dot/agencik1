import assert from "node:assert/strict";
import { GET } from "../app/api/status/route.js";
import { PAPER_POLICY, estimateStopPct } from "../lib/paper-portfolio.js";
import { SHADOW_EXECUTION_POLICY, publicShadowExecutionSummary } from "../lib/shadow-execution.js";
import { BROKER_MAPPING_POLICY } from "../lib/broker-mapping.js";
import { SHADOW_ORDER_PREFLIGHT_POLICY } from "../lib/shadow-order-preflight.js";
import { EXECUTION_QUALITY_POLICY } from "../lib/execution-quality.js";
import { SHADOW_DIAGNOSTIC_POLICY } from "../lib/shadow-diagnostic-fixtures.js";
import { STRATEGY_GOVERNANCE_POLICY } from "../lib/strategy-governance.js";
import { ALLOCATION_POLICY } from "../lib/allocation-intelligence.js";
import {
  MARKET_UNIVERSE_POLICY, MARKET_UNIVERSE, RESEARCH_SYMBOLS, PAPER_SYMBOLS,
  SHADOW_SYMBOLS, isPaperEligibleSymbol, splitPaperReadyCandidates,
} from "../lib/market-universe.js";
import { buildAgentHealth } from "../lib/agent-health.js";
import { evaluateWatchdog } from "../lib/watchdog.js";

// Protect the operational safety contract independently of UI labels and version strings.
const protectedPaperLimits = {
  startingCapitalPln: 200, riskPerTradePct: 0.5, maxOpenPositions: 3,
  maxGrossExposurePct: 100, maxSinglePositionPct: 50, hardDrawdownStopPct: 10,
  dailyLossLimitPct: 2, maxHoldingHours: 168, atrMultiple: 2, minStopPct: 1,
  maxStopPct: 5, minPositionPln: 10, feePerSidePct: 0.1, slippagePerSidePct: 0.03,
};
for (const [name, value] of Object.entries(protectedPaperLimits)) {
  assert.equal(PAPER_POLICY[name], value, `protected PAPER limit ${name}`);
}
assert.equal(estimateStopPct(0), 1);
assert.equal(estimateStopPct(1.5), 3);
assert.equal(estimateStopPct(100), 5);

const response = await GET();
assert.equal(response.status, 200);
const status = await response.json();
assert.equal(status.mode, "AUTONOMOUS_RESEARCH_AND_PAPER");
assert.equal(status.automation.paperPortfolio, true);
assert.equal(status.liveTrading, false);
assert.equal(status.automation.liveTrading, false);
assert.equal(status.broker, "XTB_NOT_CONNECTED");
for (const name of Object.keys(status.paperPolicy).filter((name) => name !== "stop")) {
  assert.equal(status.paperPolicy[name], PAPER_POLICY[name], `status agrees with PAPER ${name}`);
}
// Every numeric policy field exposed by the status endpoint must be present as well as correct.
for (const name of [
  "startingCapitalPln", "riskPerTradePct", "maxOpenPositions", "maxGrossExposurePct",
  "maxSinglePositionPct", "dailyLossLimitPct", "hardDrawdownStopPct", "maxHoldingHours",
  "feePerSidePct", "slippagePerSidePct",
]) assert.equal(status.paperPolicy[name], PAPER_POLICY[name], `status exposes ${name}`);

const execution = status.resilience.shadowExecution;
assert.equal(execution.mode, SHADOW_EXECUTION_POLICY.mode);
assert.equal(execution.brokerAdapter, SHADOW_EXECUTION_POLICY.adapter);
assert.equal(execution.canSubmitOrders, SHADOW_EXECUTION_POLICY.canSubmitOrders);
assert.equal(execution.brokerConnected, SHADOW_EXECUTION_POLICY.brokerConnected);
assert.equal(publicShadowExecutionSummary().executable, false);
for (const [policy, exposed] of [
  [BROKER_MAPPING_POLICY, execution.brokerMappingReadiness],
  [SHADOW_ORDER_PREFLIGHT_POLICY, execution.shadowOrderPreflight],
  [EXECUTION_QUALITY_POLICY, execution.executionQuality],
]) {
  for (const name of ["mode", "executable", "canSubmitOrders", "brokerConnected", "brokerAdapter"]) {
    assert.equal(exposed[name], policy[name], `status agrees with ${policy.mode}.${name}`);
  }
}
for (const policy of [BROKER_MAPPING_POLICY, SHADOW_ORDER_PREFLIGHT_POLICY, EXECUTION_QUALITY_POLICY, SHADOW_DIAGNOSTIC_POLICY]) {
  assert.equal(policy.mode, "SHADOW_ONLY");
  assert.equal(policy.executable, false);
  assert.equal(policy.canSubmitOrders, false);
  assert.equal(policy.brokerConnected, false);
  assert.equal(policy.brokerAdapter, "NONE");
}
for (const [policy, exposed] of [
  [ALLOCATION_POLICY, status.resilience.allocationIntelligence],
  [STRATEGY_GOVERNANCE_POLICY, status.resilience.strategyGovernance],
]) {
  assert.equal(policy.mode, "SHADOW_ONLY");
  assert.equal(policy.paperAuthority, false);
  assert.equal(exposed.mode, policy.mode);
  assert.equal(exposed.paperAuthority, policy.paperAuthority);
  assert.equal(exposed.automaticPaperEnforcement, false);
}

function assertDisabledFlags(value, path = "status") {
  for (const [name, nested] of Object.entries(value || {})) {
    if (["liveTrading", "brokerConnected", "canSubmitOrders", "orderSubmission", "executable", "paperAuthority", "shadowPaperAuthority"].includes(name)) {
      assert.equal(nested, false, `${path}.${name} must remain disabled`);
    }
    if (nested && typeof nested === "object") assertDisabledFlags(nested, `${path}.${name}`);
  }
}
assertDisabledFlags(status);
assert.equal(status.storagePolicy.publicResearchOnly, true);
assert.equal(status.storagePolicy.simulatedPaperPositionsOnly, true);
for (const key of ["secrets", "realMoneyPositions", "brokerData"]) assert.equal(status.storagePolicy[key], false);

assert.equal(MARKET_UNIVERSE_POLICY.shadowPaperAuthority, false);
assert.equal(RESEARCH_SYMBOLS.length, 16);
assert.equal(PAPER_SYMBOLS.length, 8);
assert.equal(SHADOW_SYMBOLS.length, 8);
assert.deepEqual([...PAPER_SYMBOLS].sort(), ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT"].sort(), "the original PAPER core must not be promoted or substituted");
assert.deepEqual([...SHADOW_SYMBOLS].sort(), ["AVAXUSDT", "DOTUSDT", "LTCUSDT", "TRXUSDT", "BCHUSDT", "NEARUSDT", "UNIUSDT", "AAVEUSDT"].sort(), "the original SHADOW research membership remains separate");
assert.equal(new Set([...PAPER_SYMBOLS, ...SHADOW_SYMBOLS]).size, 16);
assert.deepEqual([...RESEARCH_SYMBOLS].sort(), [...PAPER_SYMBOLS, ...SHADOW_SYMBOLS].sort());
assert.equal(status.marketUniverse.researchUniverse, RESEARCH_SYMBOLS.length);
assert.equal(status.marketUniverse.paperUniverse, PAPER_SYMBOLS.length);
assert.equal(status.marketUniverse.shadowResearchUniverse, SHADOW_SYMBOLS.length);
assert.ok(MARKET_UNIVERSE.every((instrument) => instrument.liveEnabled === false));
assert.ok(PAPER_SYMBOLS.every(isPaperEligibleSymbol));
assert.ok(SHADOW_SYMBOLS.every((symbol) => !isPaperEligibleSymbol(symbol)));
const candidates = RESEARCH_SYMBOLS.map((symbol) => ({ symbol, paperReady: true }));
const split = splitPaperReadyCandidates(candidates);
assert.deepEqual(split.paperCandidates.map((item) => item.symbol).sort(), [...PAPER_SYMBOLS].sort());
assert.deepEqual(split.shadowSignals.map((item) => item.symbol).sort(), [...SHADOW_SYMBOLS].sort());

// A recovered scheduling gap is informational; current unsafe state must still halt.
const now = "2026-10-05T12:39:00.000Z";
const recovered = {
  completedAt: now,
  health: buildAgentHealth({ startedAt: "2026-10-05T12:38:30.000Z", completedAt: now, previousCompletedAt: "2026-10-05T04:00:00.000Z" }),
  paperPortfolio: { halted: false },
  safeguards: { liveTrading: false, brokerConnected: false, paperOnly: true, orderSubmission: false },
  shadowExecution: { executable: false, canSubmitOrders: false, brokerConnected: false },
};
assert.equal(recovered.health.status, "HEALTHY");
assert.ok(recovered.health.scheduleEvents.some((event) => event.code === "MISSED_HEARTBEAT_WINDOW"));
assert.equal(evaluateWatchdog(recovered, now).status, "HEALTHY");
for (const name of ["liveTrading", "brokerConnected", "orderSubmission"]) {
  const result = evaluateWatchdog({ ...recovered, safeguards: { ...recovered.safeguards, [name]: true } }, now);
  assert.equal(result.status, "CRITICAL");
  assert.ok(result.reasons.some((reason) => reason.code === "SAFETY_INVARIANT_VIOLATION"));
}
for (const name of ["executable", "canSubmitOrders", "brokerConnected"]) {
  const result = evaluateWatchdog({ ...recovered, shadowExecution: { ...recovered.shadowExecution, [name]: true } }, now);
  assert.equal(result.status, "CRITICAL");
}
assert.equal(evaluateWatchdog({ ...recovered, safeguards: { ...recovered.safeguards, paperOnly: false } }, now).status, "CRITICAL");
assert.equal(evaluateWatchdog({ ...recovered, paperPortfolio: { halted: true, haltReason: "HARD_DRAWDOWN_STOP" } }, now).status, "CRITICAL");
assert.equal(evaluateWatchdog(recovered, "2026-10-05T16:00:00.000Z").status, "CRITICAL");

console.log("safety contract regression suite: OK");
