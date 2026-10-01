# Night review

Safety scope: paper trading only; live trading remains disabled.

## Findings

- Autonomous memory workflow persists latest.json, history.json, paper.json and paper-trades.json.
- Paper state has hard drawdown, daily-loss, exposure, position-count and per-trade risk controls.
- Existing JavaScript regression test covers a basic open/mark/close lifecycle.
- Recommended CI hardening: run `npm run test-paper` before the autonomous research step.
- Recommended data hardening: add bounded timeout and retry/backoff around public Binance market-data requests.
- Recommended regression coverage: daily halt, hard drawdown halt, max open positions, gross exposure, invalid prices and fee/slippage accounting.

No live broker integration or secrets are required.

## Vercel observation

The production deployment from main is READY. Commits written by the generated `research-data` branch also trigger Vercel preview builds, and those previews fail because that branch intentionally contains only JSON memory files rather than the Next.js application. This does not break production, but it creates noisy failed deployments. Recommended follow-up: configure Vercel to ignore builds from `research-data`.
