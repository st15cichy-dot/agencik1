# Autonomiczny Inwestor v0.13

Market Universe Expansion foundation.

## Research universe
The autonomous research scanner expands from 8 to 16 Binance Spot crypto markets.

### CORE_PAPER — existing PAPER authority
BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT, ADAUSDT, DOGEUSDT, LINKUSDT.

### SHADOW_RESEARCH — research only
AVAXUSDT, DOTUSDT, LTCUSDT, TRXUSDT, BCHUSDT, NEARUSDT, UNIUSDT, AAVEUSDT.

## Safety architecture
The research universe and PAPER universe are now separate concepts.

SHADOW_RESEARCH instruments may:
- be screened,
- enter Deep Lab,
- accumulate Strategy Governance history,
- appear in Allocation Intelligence,
- produce diagnostic entry signals.

They may **not**:
- enter autonomous PAPER,
- enter the manual browser PAPER sandbox,
- increase PAPER exposure,
- alter hard risk limits.

The autonomous PAPER candidate loop contains an explicit `isPaperEligibleSymbol` gate.

## Why this step
This lets us test a larger universe and measure signal quality/correlation without silently increasing the trading surface. It is the foundation for future multi-provider / multi-asset expansion.

## Safety
- live trading OFF,
- XTB disconnected,
- paper core remains 8 symbols,
- hard risk engine unchanged,
- no secrets or paid services.
