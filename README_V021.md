# v0.21 — aktualne dowody przekazania pracy agentów

Stary raport PASS pozostawał wcześniej na dysku aż do zakończenia następnej
weryfikacji. Przerwanie procesu mogło zostawić poprzedni sukces, a odbiorca
musiał ręcznie sprawdzać SHA i odcisk kodu. V0.21 zapisuje atomowo RUNNING przed
uruchomieniem testów, używa wyłącznej blokady pliku raportu i udostępnia komendę:

```bash
npm run verify-development
npm run check-development-evidence
```

Druga komenda nie uruchamia testów i nie zmienia kodu. Sprawdza schemat raportu,
końcowy PASS, aktualny HEAD i odcisk źródeł, zgodność zestawu poleceń oraz
komplet wyników z czasami wykonania. Brak pliku, starszy schemat, inny kod,
niepełne/błędne wyniki i istniejąca blokada oznaczają FAIL. CI używa jej po
weryfikacji. Zmiana kodu lub commitu wymaga ponownej pełnej weryfikacji.

Raport schemaVersion=2 zawiera hash poleceń (nazwy, programy, argumenty, timeout),
bez ujawniania ich argumentów. Przypadkowe użycie uproszczonego zestawu testów
nie może zastąpić domyślnego test-core i buildu. Raport nadal nie jest podpisanym
poświadczeniem: osoba mogąca zmienić plik może go sfałszować. Kontrola nie dowodzi
tożsamości ani niezależności recenzenta; independentReview pozostaje REQUIRED.

Blokada `.development-output/verification.json.lock` serializuje zapis do tego
raportu. Drugie uruchomienie nie nadpisuje pierwszego i nie uruchamia testów.
Awaria/SIGKILL może pozostawić RUNNING i blokadę. Nie usuwaj jej automatycznie:
sprawdź proces, zatrzymaj pozostałe procesy weryfikacji, usuń osieroconą blokadę
i uruchom pełną weryfikację od nowa. Samo usunięcie blokady nie zamienia RUNNING
w PASS. Błąd publikacji raportu zatrzymuje przekazanie pracy.

Kontrola opisuje stan w momencie odczytu, nie blokuje późniejszych zmian kodu.
Nie edytuj źródeł podczas testów ani przekazywania pracy. Odcisk obejmuje pliki
źródłowe, a nie ignorowane zależności/runtime; raport z innego komputera nie
poświadcza zgodności zainstalowanych tam pakietów. Testy Windows procesu nie są
potwierdzone; CI używa Linux. Ręczny przegląd końcowego diffu nadal jest wymagany.

Agenci AI pracują w dostępnej sesji; istniejące GitHub Actions wykonują testy,
heartbeat i watchdog w tle. Nie dodano płatnego API, autonomicznego wykonawcy
piszącego kod po zakończeniu sesji ani nowych uprawnień workflow. PAPER/SHADOW,
limity i wyłączone LIVE/broker/zlecenia pozostają.
