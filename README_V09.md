# Autonomiczny Inwestor v0.9

Observability and decision-quality release. Live trading and XTB remain disabled.

## Added
- deterministic agent health score (0-100),
- status: HEALTHY / WATCH / DEGRADED / CRITICAL,
- alerts for failed stages, incomplete screening, delayed heartbeat, paper halts and state-integrity problems,
- expected-next-heartbeat timestamp,
- persistent decision journal with reasons for screening, Deep decisions and paper actions,
- health history persisted to `health.json`,
- decision journal persisted to `journal.json`,
- health and journal summaries embedded in `latest.json`,
- regression tests for health scoring and decision-journal generation.

## Existing v0.8 safety remains
- market-data timeout/retry and stale-data guard,
- paper-state sanitization,
- CI production build gate,
- paper risk regression tests,
- live trading OFF,
- XTB disconnected,
- no secrets.
