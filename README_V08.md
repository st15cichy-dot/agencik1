# Autonomiczny Inwestor v0.8

Hardening release. Live trading and XTB remain disabled.

## Added
- Binance market-data timeout: 10 s.
- Up to 3 attempts with exponential backoff for network, 429 and 5xx failures.
- OHLCV validation and a 4-hour stale-data guard.
- Persisted paper-state sanitization before every autonomous run.
- Expanded paper risk regression suite for daily halt, hard DD, max positions, gross exposure, invalid prices, fee/slippage and corrupt state.
- Heartbeat preflight checks before autonomous research.
- CI workflow with syntax checks, paper tests and Next.js production build.
- Vercel Git config disables deployments for the generated `research-data` branch.

## Safety
- Paper only.
- Broker disconnected.
- No secrets.
- Existing hard risk limits unchanged.
