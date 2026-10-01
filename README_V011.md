# Autonomiczny Inwestor v0.11

Strategy Governance release in **shadow-only mode**.

## What it does
- fingerprints every selected strategy configuration into a stable strategy version,
- persists a governance record per symbol + strategy version,
- tracks Deep PASS/FAIL observations and consecutive streaks,
- lifecycle: CANDIDATE → SHADOW → VALIDATED → ACTIVE,
- degrades a previously strong version after repeated Deep FAIL,
- retires a version after a longer consecutive FAIL streak,
- maintains informational champion/challenger rankings per symbol,
- writes governance transitions into the Decision Journal,
- stores full state in `governance.json`.

## Important safety boundary
Governance is deliberately **SHADOW_ONLY** in v0.11:
- `paperAuthority = false`,
- it does not open positions,
- it does not block positions,
- existing Deep gate + hard risk engine remain authoritative for PAPER.

This lets the system gather enough governance history before any future enforcement is considered.

## Promotion policy
- first Deep PASS: SHADOW,
- at least 3 observations and >=66.67% PASS: VALIDATED,
- at least 5 observations and >=80% PASS with recent consistency: ACTIVE,
- 2 consecutive FAIL after validation: DEGRADED,
- 4 consecutive FAIL: RETIRED.

## Safety
- live trading OFF,
- XTB disconnected,
- hard risk limits unchanged,
- no secrets or paid services.
