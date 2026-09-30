# Autonomiczny Inwestor v0.3

## Co nowego
- 8 instrumentów w skanerze: BTC, ETH, BNB, SOL, XRP, ADA, DOGE, LINK względem USDT.
- 4 rodziny strategii:
  - SMA Trend
  - EMA Momentum
  - RSI Mean Reversion
  - Breakout
- 1500 świec 1h do laboratorium.
- Train/test 70/30.
- Optymalizacja konfiguracji wyłącznie na części train.
- 3-fold walk-forward stability.
- Koszty modelowe: 0,10% fee + 0,03% slippage na stronę.
- Paper gate PASS/FAIL.
- ATR-based sizing do paper journal.
- Historia uruchomień labu + eksport JSON.
- Realne transakcje nadal wyłączone; XTB nadal niepołączony.

## Wgrywanie
Do katalogu głównego repozytorium `agencik1` wgraj/nadpisz:
- `package.json`
- `next.config.mjs`
- cały folder `app`
- cały folder `lib`

Po commicie do `main` Vercel powinien wdrożyć v0.3 automatycznie.

## Ważne
Historia labów i paper journal w v0.3 nadal zapisują się lokalnie w przeglądarce.
Dodano eksport JSON, żeby wyniki nie były uwięzione w jednym widoku.
Trwała historia serwerowa powinna wejść dopiero razem z uwierzytelnieniem i bezpiecznym storage,
żeby publiczny endpoint nie pozwalał obcym użytkownikom modyfikować danych projektu.
