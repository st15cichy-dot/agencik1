# Autonomiczny Inwestor v0.6

## Najważniejsza zmiana
Research może wykonywać się bez otwartej przeglądarki.

v0.6 wykorzystuje GitHub Actions jako bezpłatny dla publicznego repozytorium
harmonogram obliczeń researchowych. Workflow działa docelowo co 2 godziny.

## Architektura
1. GitHub Actions uruchamia `scripts/autonomous-research.mjs`.
2. Wszystkie 8 instrumentów przechodzi screening.
3. Tylko screen PASS przechodzi Deep Lab.
4. Wyniki są zapisywane do osobnej gałęzi `research-data`.
5. Panel Vercel odczytuje `latest.json` z tej gałęzi.
6. `history.json` trzyma do 240 heartbeatów.

## Dlaczego osobna gałąź
Wyniki researchu nie powodują ciągłego redeployu Vercela.

## Bezpieczeństwo
Gałąź `research-data` może zawierać WYŁĄCZNIE publiczne wyniki researchu.

Nie wolno tam zapisywać:
- haseł,
- kluczy API,
- tokenów,
- danych XTB,
- identyfikatorów kont,
- realnych pozycji użytkownika,
- prywatnych danych.

## Live trading
Nadal OFF.

## Pierwsze uruchomienie
Po wdrożeniu v0.6:
1. GitHub -> Actions
2. wybierz `Autonomous research heartbeat`
3. `Run workflow`
4. po zakończeniu powstanie gałąź `research-data`
5. odśwież panel v0.6

Następne uruchomienia odbywają się automatycznie wg harmonogramu.
