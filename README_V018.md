# Autonomiczny Inwestor v0.18 — współpraca przy rozwoju

Wydanie dodaje protokół współpracy agentów programistycznych oraz dowody
weryfikacji w istniejącym CI. Nie zmienia decyzji inwestycyjnych ani limitów
silnika PAPER/SHADOW. Punkt bazowy: `main` po PR #17 (`19e5174`), heartbeat
5 października 2026, 14:39 CEST (12:39 UTC), `HEALTHY`, 100/100.

## Jak współpracują agenci

Koordynator przydziela rozłączne pliki implementerowi i autorowi testów.
Autor testów sprawdza kontrakt niezależnie. Recenzent czyta końcowy diff,
sprawdza regresje i bezpieczniki. Koordynator rozwiązuje uwagi, ponawia
potrzebne testy i przekazuje przetestowany PR. Repozytoryjne instrukcje są
w [AGENTS.md](AGENTS.md), a szablon PR zawiera miejsce na role i dowody.

Są to rzeczywiści wykonawcy dostępni w sesji. Skrypt CI nie podszywa się pod
agenta ani recenzenta. Jeśli jedna osoba/agent pełni kilka ról, PR musi to
ujawnić. Wynik przeglądu zapisuje recenzent/koordynator w PR wraz ze sprawdzonym
SHA i zakresem diffu; raport automatyczny nie wystawia aprobaty kodu.

## Jedna komenda weryfikacji

```bash
npm install --no-audit --no-fund
npm run verify-development
```

Komenda uruchamia `npm run test-core` (dotychczasowe regresje, nowy kontrakt
bezpieczeństwa i testy workflow) oraz `npm run build`. Raport JSON trafia do
`.development-output/verification.json` i zawiera HEAD, odcisk źródeł przed
i po sprawdzeniu, wyniki komend i czasy. Odcisk obejmuje pliki śledzone przez
Git i nieignorowane nowe pliki, także usunięcia, dowiązania i bit wykonywalny.
Raport nie zawiera treści źródeł, środowiska, sekretów ani logów procesów.

Błąd, timeout lub różnica źródeł między początkiem i końcem sprawdzania oznacza
niepowodzenie. Dwa odciski nie wykrywają chwilowej zmiany cofniętej przed końcem;
weryfikację wykonuj bez równoległej edycji źródeł, najlepiej na czystym commicie.
Po błędzie następne sprawdzenia są pomijane, a raport zachowuje wynik błędu.
Timeout kończy proces sprawdzania; na runnerach Linux także jego grupę procesów.
Limity wynoszą 5 minut dla testów i 12 minut dla buildu. Po każdej zmianie kodu
trzeba ponowić weryfikację dla nowego odcisku. Powiązanie z odciskiem pomaga
unikać starych dowodów; raport nie jest podpisanym poświadczeniem i nie dowodzi
niezależności przeglądu.

Istniejący workflow `CI` uruchamia tę samą komendę na push/PR po kontroli
składni. Raport jest artifactem `development-verification-<SHA>` przez 7 dni;
podsumowanie joba wskazuje wynik. Raport jest zapisywany również po błędzie
weryfikacji, o ile proces może go zapisać. Anulowanie joba, awaria runnera
lub błąd przed startem komendy mogą uniemożliwić zapis. CI nadal ma tylko
`contents: read`, nie wykonuje merge ani zmian kodu.

## Bezpieczniki

Nowy test `npm run test-safety` weryfikuje publiczny status względem zasad silnika
i regresje granic bezpieczeństwa. PAPER zachowuje kapitał 200 PLN, ryzyko
0,5%, maks. 3 pozycje, ekspozycję 100%, pozycję maks. 50%, dzienny halt 2%
i hard drawdown stop 10%. LIVE jest wyłączony, broker odłączony, adapter `NONE`,
zlecenia wyłączone. Badania: 16 rynków; PAPER: dotychczasowe 8; pozostałe 8:
SHADOW bez PAPER authority. Governance, allocation i diagnostyka wykonania
pozostają niewykonywalne. Regresja odzyskanego heartbeat z v0.17 pozostaje.

Nie dodano pakietów, API modeli, usług ani sekretów. Weryfikacja korzysta
z istniejących zależności i GitHub Actions. Artefakty i czas CI podlegają
limitom konta GitHub; ta zmiana nie kupuje dodatkowych minut ani przestrzeni.

## Ograniczenia pracy w tle

- Agenci tej sesji nie stają się trwałymi workerami po jej zakończeniu.
  Nie będą samodzielnie pisać następnych zmian ani otwierać przyszłych PR.
- Istniejący heartbeat działa według cron `17 */2 * * *` UTC, watchdog
  `42 * * * *` UTC. Mogą działać przy zamkniętej przeglądarce; mają limity
  jobów 30 i 10 minut. GitHub może opóźnić/pominąć start, wyłączyć harmonogram
  po nieaktywności publicznego repo lub zatrzymać działanie z powodu limitów.
- CI działa na zdarzeniach push/PR i sprawdza deterministyczne testy oraz build.
  Nie ma modelu LLM ani wykonawcy stale implementującego lub recenzującego kod.
- Ten PR sam nie wdraża v0.18. Heartbeat z `main` użyje nowej wersji dopiero
  po scaleniu; potwierdzenie produkcji wymaga nowego rzeczywistego heartbeat.
- Starszy Python core ma zastany błąd fixture `test_risk_accepts_small_trade`:
  przy entry 100/stop 99/kapitale 200 wylicza pozycję 200 PLN ponad limit 50 PLN.
  `unittest discover` nie uruchamia tych funkcji pytest. Nie są częścią bramki
  JS i nie zostały naprawione w v0.18; nie deklarujemy, że testy Python przeszły.
