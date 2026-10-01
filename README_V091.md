# Autonomiczny Inwestor v0.9.1

Active monitoring patch. Live trading and XTB remain disabled.

## Watchdog
An independent GitHub Actions watchdog runs hourly, offset from the 2-hour research heartbeat.

It evaluates:
- age of the last autonomous heartbeat,
- agent health status and critical health alerts,
- paper HARD HALT,
- safety invariants: live trading OFF, broker disconnected, paper-only mode.

## Alert behaviour
- HEALTHY: no issue is opened.
- WARNING: one persistent GitHub issue is opened or updated.
- CRITICAL: the same issue is opened/updated and the watchdog workflow fails, creating an additional visible signal in GitHub Actions.
- Recovery: the existing alert issue is automatically commented and closed.

The workflow uses one issue only, so repeated identical alerts do not create issue spam.

## Thresholds
- warning when heartbeat age exceeds 2.75 h,
- critical when heartbeat age exceeds 3.25 h,
- critical on paper HARD HALT,
- critical on any live/broker/paper-only safety invariant violation.

No secrets or paid external notification providers are required.
