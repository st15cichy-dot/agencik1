# Autonomiczny Inwestor v0.19 — ochrona pamięci PAPER

Nieudane pobranie pamięci nie może wyglądać jak pierwszy start. Wcześniej
błąd `git ls-remote`, brakujący blob lub uszkodzony JSON mogły przejść do
wartości domyślnych i późniejszej publikacji nowego stanu za pomocą force-push.

V0.19 rozróżnia potwierdzony brak `research-data` od błędu Git. Przywrócenie
pamięci kończy się błędem, jeśli brakuje wymaganych plików albo ich format jest
niepoprawny. Stan PAPER jest sprawdzany przed normalizacją, pobieraniem rynku
i zapisem nowych wyników: uszkodzone liczby, typy haltów lub pozycje nie są
cicho usuwane ani zastępowane startowym kapitałem. Aktywne halty pozostają.

Pierwszy start workflow jest dozwolony tylko przy potwierdzonym braku gałęzi.
Lokalne uruchomienie bez wskazanych plików pamięci zachowuje możliwość startu
od początku. Wskazane, lecz nieistniejące pliki oznaczają błąd, chyba że jawny
tryb `AUTONOMOUS_MEMORY_MODE=BOOTSTRAP` potwierdza brak całej pamięci.
Nie używaj BOOTSTRAP do obchodzenia błędów lub naprawiania istniejącego stanu.

Obowiązkowe są latest, history, paper, paper-trades i journal. Późniejsze
pliki diagnostyczne mogą nie istnieć wyłącznie przy migracji poprawnej pamięci
sprzed ich wprowadzenia: governance 0.11, execution-intents 0.14,
preflight-audit 0.16, execution-quality 0.17. Uszkodzony istniejący plik blokuje
uruchomienie. Pamięć v0.18 i nowsza wymaga wszystkich tych plików.
Jest to kontrola JSON, struktur i stanu finansowego PAPER; nie pełna walidacja
semantyczna każdego rekordu transakcji, historii lub journal.

Publikacja używa `--force-with-lease` z SHA przywróconej pamięci. Jeśli ktoś
w międzyczasie zmieni gałąź, job kończy się błędem i nie nadpisuje nowego stanu.
Istniejąca grupa concurrency nadal serializuje heartbeat. Po błędzie sprawdź
logi i pamięć, popraw źródło błędu i ponów workflow; nie kasuj pamięci ani haltu.
Ostatni poprawny heartbeat pozostaje, a watchdog nadal wykrywa jego starzenie.

Weryfikacja: `npm run test-memory` oraz `npm run verify-development` w tym samym
istniejącym CI. Testy obejmują pliki, proces heartbeat przed pobraniem rynku,
odtwarzanie Git i odrzucenie konkurencyjnej publikacji.

Limity ryzyka, PAPER/SHADOW i granice LIVE/broker/zlecenia są bez zmian.
Nie dodano zależności, usług, sekretów ani płatnego API. Agenci rozwijają kod
podczas sesji; w tle pracują istniejące Actions, z opóźnieniami i limitami GitHub.
Przygotowanie PR nie wdraża tej wersji automatycznie.
