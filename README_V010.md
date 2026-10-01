# Autonomiczny Inwestor v0.10

Portfolio Intelligence release. Live trading and XTB remain disabled.

## Added
- persistent portfolio analytics embedded in `latest.json` and saved as `analytics.json`,
- paper equity curve from heartbeat history,
- expectancy in PLN and percent,
- profit factor, payoff ratio and average holding time,
- R-multiple based on planned risk per trade,
- MFE/MAE tracking for paper positions,
- rolling 7/30/90-day statistics,
- breakdown by strategy and instrument,
- exit-reason statistics,
- fee totals and observed drawdown,
- regression tests for analytics and excursion tracking,
- dashboard section for portfolio-quality diagnostics.

## Interpretation guard
When there are few or no closed PAPER trades, the system reports an explicit sample status rather than treating early results as reliable evidence.

## Safety
- paper only,
- live trading OFF,
- broker disconnected,
- hard risk limits unchanged,
- no secrets or paid services added.
