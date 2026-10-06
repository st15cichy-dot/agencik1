# Autonomiczny Inwestor v0.20 — zakres dowodów PAPER/SHADOW

Jedna zyskowna transakcja nie pozwala ocenić przewagi strategii. Dotychczas
Portfolio Intelligence przy braku strat pokazywało profit factor 99, a status
próby i okna 7/30/90 dni nie ujawniały zakresu zachowanej historii. Pamięć po
v0.18 zawierała jedną zamkniętą transakcję i około 4,7 dnia heartbeatów.

V0.20 zwraca `profitFactor=null` i jawny `profitFactorStatus` przy braku strat
lub transakcji. Gdy istnieją straty, PF pozostaje ilorazem zysków i strat;
same straty dają 0. Poprawka dotyczy opisowych analityk zamkniętych transakcji
PAPER, nie backtestów, bramek Deep ani wyboru strategii.

Wyniki i grupy obliczane są z tej samej próby poprawnych, unikalnych transakcji.
Raport `portfolioAnalytics.evidence` podaje odrzucenia, duplikaty, brakujące
opcjonalne metryki, liczbę zachowanych heartbeatów i punktów equity, granice
dat, największą przerwę i zakres dat w oknach 7/30/90 dni. Nowy panel wyjaśnia
te ograniczenia. Starsza poprawna pamięć bez pola evidence nadal się wyświetla;
raport pojawia się po heartbeat wykonanym nowym kodem.

Określenie zakresu dat nie oznacza ciągłego pokrycia: między obserwacjami mogą
być luki. `completeCoverage=false` jest celowe nawet przy zakresie obejmującym
całe okno. Liczniki dotyczą zachowanego wycinka, nie całego życia portfolio.
Historia zatrzymuje 240 runów, wykres 120 punktów, transakcje 500. Nie znamy
pełnej historii spoza retencji ani niezależności obserwacji.

Status `DESCRIPTIVE_ONLY` nie jest gotowością inwestycyjną. Nawet 75 transakcji
nie daje tu etykiety ESTABLISHED/VALIDATED; liczebność jest wyłącznie opisem.
Powtarzane heartbeat i backtesty nie zwiększają próby zamkniętych transakcji.
Symulowane fille SHADOW są oznaczone osobno; nie stanowią porównywalnego
portfolio i nie potwierdzają rzeczywistego wykonania brokerskiego.

Raport ma `mode=SHADOW_ONLY`, `paperAuthority=false`, `inferenceSupported=false`
i `liveReadiness=false`. Nie promuje strategii, nie zmienia decyzji PAPER,
limitów ryzyka, universe ani bezpieczników wykonania. LIVE/broker/zlecenia
pozostają wyłączone. Nie dodano modeli, pakietów, usług, sekretów ani płatnego API.

Weryfikacja: `npm run test-evidence` i `npm run verify-development` w istniejącym
CI. Wydanie opiera się na poprawce ochrony pamięci v0.19: najpierw scal v0.19,
następnie przetestowany PR v0.20. Te PR-y nie wdrażają się przez samo przygotowanie.

## Dostęp do XTB

Sprawdzenie 5 października 2026: [oficjalne centrum pomocy XTB](https://www.xtb.com/en/help-center/our-platforms-6/does-xtb-offer-investment-automation-tools)
informuje, że dostęp do API zakończono 14 marca 2025. V0.20 nie oferuje połączenia
ani automatycznych zleceń XTB. Dotychczasowe mapping/preflight/fill pozostają
diagnostyką na statycznych fixture, nie danymi rzeczywistego brokera. Raporty
mogą pomagać w ręcznej ocenie, ale nie dowodzą gotowości integracji. Ewentualny
przyszły adapter wymaga aktualnego, oficjalnie wspieranego kanału dostępu,
specyfikacji instrumentów/kosztów i odrębnego zakresu wdrożenia. Nie dodajemy
nieoficjalnego obejścia xStation ani adaptera do wyłączonego xAPI.

Agenci programistyczni działają podczas sesji. Po jej zakończeniu istniejące
Actions wykonują heartbeat, watchdog i kontrole kodu; harmonogram i dostępne
zasoby GitHub mogą ograniczyć działanie. CI nie pisze kolejnych wersji samodzielnie.
