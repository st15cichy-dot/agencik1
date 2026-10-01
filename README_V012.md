# Autonomiczny Inwestor v0.12

Allocation Intelligence release in **SHADOW_ONLY** mode.

## What it adds
- deterministic ranking of current Deep PASS candidates,
- realized-volatility diagnostics from recent hourly returns,
- pairwise return correlations,
- warning threshold at |ρ| >= 0.75,
- hard shadow concentration threshold at |ρ| >= 0.90,
- maximum 3 names in the diagnostic basket,
- maximum 50% shadow weight per name,
- maximum 100% gross shadow allocation,
- inverse-volatility shadow weights,
- concentration limit of 2 positions from the same strategy family,
- persistent `allocation.json`,
- Allocation events in Decision Journal.

## Safety boundary
Allocation Intelligence has **no authority over PAPER**:
- `mode = SHADOW_ONLY`,
- `paperAuthority = false`,
- it does not reorder the actual PAPER entry loop,
- it does not change position sizing,
- it does not bypass Deep gate,
- it does not weaken hard risk limits.

The purpose is to collect evidence about whether correlation-aware allocation would improve diversification before any future enforcement is considered.

## Existing safety
- LIVE trading OFF,
- XTB disconnected,
- hard risk engine unchanged,
- no paid services or secrets.
