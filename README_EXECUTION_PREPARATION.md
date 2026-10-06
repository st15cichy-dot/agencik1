# Wykonanie zleceń, monitoring i prognozy

Cel: przygotować automatyczny zakup i sprzedaż bez potwierdzania każdej
transakcji, w granicach uprzednio skonfigurowanej polityki. Budżet planowanego
pilota wynosi 200 PLN. Ten etap **nie uruchamia handlu rzeczywistego**.
Publiczny runtime pozostaje PAPER/SHADOW, LIVE false, broker NONE.

## Co działa w tym etapie

### Izolowany wykonawca

`lib/order-executor.js` udostępnia `createOrderExecutor` z metodami
`initializeStore`, `execute`, `reconcile`, `snapshot`. Wymaga lokalnej ścieżki
`storagePath`, wstrzykniętego brokera i zaufanej funkcji `riskCheck`.
`executionEnabled` jest domyślnie false. Nie ma automatycznego odczytu sekretów.

Intencja ma pola `id`, `symbol`, `side`, `quantity`, `price`. Dopuszczone są
LIMIT/GTC, BUY/SELL, BTCUSDC/ETHUSDC oraz dodatnie dziesiętne ciągi znaków.
Identyfikator musi być trwały i nie może być ponownie użyty dla innej decyzji.
Przed wywołaniem brokera stan SUBMITTING jest zapisywany atomowo z fsync.
Identyczna intencja zwraca wcześniejszy zapis bez ponownego wysłania.

Timeout, błędna odpowiedź lub niezgodność realizacji pozostawia UNKNOWN.
SUBMITTING/UNKNOWN blokuje nowe intencje. `reconcile` wyłącznie odczytuje status
istniejącego zlecenia; NOT_FOUND nie jest zgodą na ponowne wysłanie. Częściowe
realizacje nie mogą się cofać ani przekraczać zamówionej ilości. Stan końcowy
nie jest ponownie wysyłany ani uzgadniany.

### Transport Binance

`lib/binance-order-transport.js` obsługuje podpisane `submitOrder` i `queryOrder`.
Ma stałe hosty TESTNET/LIVE, jest domyślnie wyłączony i nie jest importowany przez
aplikację, heartbeat ani endpointy HTTP. Tryb LIVE wymaga osobnej jawnej bramki
konfiguracji w kodzie serwera. Sama bramka **nie sprawdza gotowości do handlu**.
Żaden test nie kontaktuje się z Binance: wszystkie używają atrap HTTP.

Transport nie ponawia żądań, zabrania przekierowań, ogranicza czas żądania
i parsowania odpowiedzi. Nie zwraca surowych danych konta ani tekstów błędów
giełdy. Nie ma endpointu wypłat. Klucze nie są potrzebne do uruchomienia testów.

### Monitoring i prognozy

Panel pokazuje świeżość heartbeat, pokrycie prognozami, prognozy gorsze od
bazy i jawny brak połączenia z wykonawcą. Liczba rzeczywistych zleceń jest
nieznana, a nie równa zero. Telemetria nigdy nie nadaje uprawnień do transakcji.

`buildForecastDiagnostics` ocenia kierunek kolejnej świecy 1h poprzez częstość
wzrostów w ostatnich maksymalnie 48 zmianach, z minimum 24 i wygładzaniem
Laplace'a. To prosty punkt odniesienia, nie model o udowodnionej przewadze.
Historyczna ocena kolejno dopasowuje model tylko na dostępnej wtedy historii,
a następnie mierzy błąd Brier na następnym wyniku. Baza 50/50 ma Brier 0,25;
ujemny Brier skill oznacza gorszy wynik. Brak próbek oznacza null, nie zero.
Wynik nie uwzględnia rentowności po prowizjach i nie jest skalibrowaną pewnością.

Niekompletne świece są usuwane przed analizą strategii. Luki, duplikaty,
nieprawidłowe OHLCV, przyszłe lub nieaktualne dane blokują analizę. Brak jednej
zamkniętej godziny jest teraz uznawany za nieaktualność; wcześniej limit wynosił
4h. To świadome zaostrzenie jakości danych, bez zmiany progów strategii.
Prognoza przestaje być aktualna po zamknięciu godziny, której dotyczyła.
Heartbeat co 2h nie zapewnia ciągłej dostępności prognozy 1h.
Nowe pola pamięci pojawią się dopiero po heartbeat uruchomionym z tym kodem.

## Ograniczenia przed LIVE

- `riskCheck` to wymagany punkt kontroli, **nie gotowa polityka ryzyka**.
  Należy dopiero połączyć aktualne salda/pozycje, oczekujące zlecenia, FX,
  filtry giełdy, koszty, limity 200 PLN i wyłącznik awaryjny. Nie wolno użyć
  stale zwracającego true callbacku do handlu rzeczywistego.
- Lokalny ledger działa na jednym komputerze. Nie jest rozproszoną bazą ani
  trwałym magazynem Vercel. Potrzebny jest pojedynczy worker i prywatny trwały
  magazyn. Konto i środowisko muszą mieć osobne magazyny i identyfikatory.
- Nie ma automatycznego anulowania, strumienia zdarzeń konta, obsługi ochronnych
  zleceń stop ani mechanizmu rozliczania prowizji i sald. LIMIT/GTC może pozostać
  niewykonany. Nie wolno traktować tej wersji jako kompletnego bota LIVE.
- Brak testu na prawdziwym testnecie i potwierdzenia rynków/opłat użytkownika.
  Obecne badania USDT nie są mapowane automatycznie na rzeczywiste zlecenia USDC.
- Prognozy są diagnostyczne i nie sterują PAPER ani LIVE. Dokładniejszy pomiar
  nie jest dowodem większych przyszłych zysków.

## Przechowywanie i odzyskiwanie

Stan wykonania jest prywatny. Katalog `.execution-private/` jest ignorowany
przez Git; nie zapisuj ledgeru w publicznej pamięci research-data ani logach.
Katalog nadrzędny magazynu musi istnieć. Pliki mają uprawnienia 0600.
Brak/korupcja magazynu i błąd trwałego zapisu zatrzymują działanie, pozostawiając
blokadę. Nie usuwaj aktywnej blokady ani nie inicjalizuj pustego ledgeru w miejsce
utraconej historii. Najpierw zatrzymaj proces, zweryfikuj jego brak, zabezpiecz
stan i uzgodnij wszystkie niepewne zlecenia z brokerem. Odtwarzanie z niepełnej
kopii może zgubić identyfikatory i wymaga osobnej procedury odzyskiwania.

## Weryfikacja

`npm run verify-development` uruchamia testy i build; następnie
`npm run check-development-evidence` sprawdza zgodność dowodu z kodem.
Testy wykonawcy używają katalogów tymczasowych, a transportu wyłącznie atrap.
Nie dodano usług, pakietów ani płatnych API. Ta zmiana nie uruchamia trwałych
agentów programujących po zakończeniu rozmowy.

Źródła interfejsu: [Binance Spot REST](https://developers.binance.com/en/docs/products/spot/rest-api),
[Trade](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints),
[Account](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints),
[Errors](https://developers.binance.com/docs/binance-spot-api-docs/errors).
