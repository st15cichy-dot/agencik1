Autonomiczny Inwestor v0.6 — Vercel build fix

Błąd:
app/api/backtest/route.js importował funkcję `sma`, której lib/indicators.js nie eksportuje.

Naprawa:
- import `smaAt`
- zamiana 4 wywołań `sma(...)` na `smaAt(...)`
- jawne rozszerzenie `.js`

Wgraj:
app/api/backtest/route.js

Commit:
Fix v0.6 Vercel build: use smaAt in backtest route
