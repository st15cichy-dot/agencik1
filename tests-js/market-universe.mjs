import assert from "node:assert/strict";
import {
  MARKET_UNIVERSE,
  MARKET_UNIVERSE_POLICY,
  PAPER_SYMBOLS,
  RESEARCH_SYMBOLS,
  SHADOW_SYMBOLS,
  isPaperEligibleSymbol,
  isResearchSymbol,
  marketSymbolMeta,
  publicUniverseSummary,
} from "../lib/market-universe.js";

assert.equal(RESEARCH_SYMBOLS.length, 16);
assert.equal(PAPER_SYMBOLS.length, 8);
assert.equal(SHADOW_SYMBOLS.length, 8);
assert.equal(new Set(RESEARCH_SYMBOLS).size, RESEARCH_SYMBOLS.length);

for (const symbol of PAPER_SYMBOLS) {
  assert.equal(isResearchSymbol(symbol), true);
  assert.equal(isPaperEligibleSymbol(symbol), true);
  assert.equal(marketSymbolMeta(symbol).tier, "CORE_PAPER");
}

for (const symbol of SHADOW_SYMBOLS) {
  assert.equal(isResearchSymbol(symbol), true);
  assert.equal(isPaperEligibleSymbol(symbol), false);
  assert.equal(marketSymbolMeta(symbol).tier, "SHADOW_RESEARCH");
  assert.equal(marketSymbolMeta(symbol).liveEnabled, false);
}

assert.equal(isResearchSymbol("FAKEUSDT"), false);
assert.equal(isPaperEligibleSymbol("FAKEUSDT"), false);
assert.equal(MARKET_UNIVERSE_POLICY.shadowPaperAuthority, false);

const summary = publicUniverseSummary();
assert.equal(summary.researchCount, 16);
assert.equal(summary.paperCount, 8);
assert.equal(summary.shadowCount, 8);
assert.equal(summary.shadowPaperAuthority, false);
assert.deepEqual(
  [...PAPER_SYMBOLS].sort(),
  MARKET_UNIVERSE.filter((x) => x.paperEnabled).map((x) => x.symbol).sort()
);

console.log("market universe tests: OK");
