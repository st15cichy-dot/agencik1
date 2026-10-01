export const MARKET_UNIVERSE_POLICY = Object.freeze({
  version: "0.13.0",
  provider: "BINANCE_SPOT_PUBLIC",
  assetClass: "CRYPTO",
  paperCoreSize: 8,
  shadowResearchSize: 8,
  totalResearchSize: 16,
  shadowPaperAuthority: false,
});

const CORE_PAPER = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "LINKUSDT",
];

const SHADOW_RESEARCH = [
  "AVAXUSDT",
  "DOTUSDT",
  "LTCUSDT",
  "TRXUSDT",
  "BCHUSDT",
  "NEARUSDT",
  "UNIUSDT",
  "AAVEUSDT",
];

function descriptor(symbol, tier, paperEnabled) {
  return Object.freeze({
    symbol,
    provider: "BINANCE_SPOT_PUBLIC",
    venue: "BINANCE_SPOT",
    assetClass: "CRYPTO",
    quoteCurrency: "USDT",
    interval: "1h",
    tier,
    researchEnabled: true,
    paperEnabled,
    liveEnabled: false,
  });
}

export const MARKET_UNIVERSE = Object.freeze([
  ...CORE_PAPER.map((symbol) => descriptor(symbol, "CORE_PAPER", true)),
  ...SHADOW_RESEARCH.map((symbol) => descriptor(symbol, "SHADOW_RESEARCH", false)),
]);

export const RESEARCH_SYMBOLS = Object.freeze(
  MARKET_UNIVERSE.filter((x) => x.researchEnabled).map((x) => x.symbol)
);

export const PAPER_SYMBOLS = Object.freeze(
  MARKET_UNIVERSE.filter((x) => x.paperEnabled).map((x) => x.symbol)
);

export const SHADOW_SYMBOLS = Object.freeze(
  MARKET_UNIVERSE.filter((x) => x.tier === "SHADOW_RESEARCH").map((x) => x.symbol)
);

const BY_SYMBOL = new Map(MARKET_UNIVERSE.map((x) => [x.symbol, x]));

export function marketSymbolMeta(symbol) {
  return BY_SYMBOL.get(String(symbol || "").toUpperCase()) || null;
}

export function isResearchSymbol(symbol) {
  return Boolean(marketSymbolMeta(symbol)?.researchEnabled);
}

export function isPaperEligibleSymbol(symbol) {
  return Boolean(marketSymbolMeta(symbol)?.paperEnabled);
}

export function splitPaperReadyCandidates(deep = [], openPositions = []) {
  const openSymbols = new Set(
    (Array.isArray(openPositions) ? openPositions : [])
      .map((x) => x?.symbol)
      .filter(Boolean)
  );

  const paperCandidates = [];
  const shadowSignals = [];

  for (const item of Array.isArray(deep) ? deep : []) {
    if (!item?.paperReady || !item?.symbol) continue;

    if (!isPaperEligibleSymbol(item.symbol)) {
      shadowSignals.push(item);
      continue;
    }

    if (!openSymbols.has(item.symbol)) {
      paperCandidates.push(item);
    }
  }

  return { paperCandidates, shadowSignals };
}

export function paperUniverseViolations(openPositions = []) {
  return (Array.isArray(openPositions) ? openPositions : [])
    .map((x) => x?.symbol)
    .filter(Boolean)
    .filter((symbol) => !isPaperEligibleSymbol(symbol));
}

export function publicUniverseSummary() {
  return {
    version: MARKET_UNIVERSE_POLICY.version,
    provider: MARKET_UNIVERSE_POLICY.provider,
    assetClass: MARKET_UNIVERSE_POLICY.assetClass,
    researchCount: RESEARCH_SYMBOLS.length,
    paperCount: PAPER_SYMBOLS.length,
    shadowCount: SHADOW_SYMBOLS.length,
    shadowPaperAuthority: false,
    tiers: {
      CORE_PAPER: [...PAPER_SYMBOLS],
      SHADOW_RESEARCH: [...SHADOW_SYMBOLS],
    },
  };
}
