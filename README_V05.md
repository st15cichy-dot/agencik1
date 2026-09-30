# Autonomiczny Inwestor v0.5

## Cel wersji
v0.5 poprawia jakość badań zamiast poluzowywać kryteria wejścia.

## Najważniejsze zmiany
- Deep Lab używa 5000 świec 1h (~208 dni).
- 30% danych pozostaje jako final OOS i nie jest używane do strojenia.
- Anchored walk-forward na części development.
- 24-godzinny purge gap między train a test.
- Stabilność parametrów: mierzymy, jak często ten sam config wygrywa kolejne foldy.
- Dwa benchmarki:
  - pełny buy-and-hold,
  - exposure-adjusted benchmark, który uwzględnia czas faktycznej ekspozycji strategii.
- Metryki: Sharpe, Calmar, Profit Factor, Max Drawdown, Exposure.
- Final OOS dzielony na 3 segmenty i klasyfikowany jako BULL / BEAR / RANGE oraz HIGH/NORMAL VOL.
- Dwuetapowy proces:
  1. all-market screening 3000 świec,
  2. deep lab 5000 świec.
- Screening PASS nie dopuszcza do paper tradingu.
- Paper-ready wymaga Deep PASS i aktywnego sygnału LONG.

## Nadal celowo brak
- realnych zleceń,
- połączenia z XTB,
- trwałego serwerowego storage,
- pełnego procesu 24/7 przy zamkniętej przeglądarce.

Te elementy mają wejść dopiero po walidacji v0.5.
