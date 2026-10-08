# Bitvavo — odczyt salda i przygotowanie wykonania

## Odczyt salda na laptopie (Ubuntu / WSL2)

`npm run bitvavo-balance` wykonuje jednorazowy odczyt rzeczywistego salda konta.
To osobne polecenie terminala, nie połączenie panelu WWW ani automat handlowy.
Korzysta wyłącznie z GET `/v2/time` i podpisanego GET `/v2/balance`.
Nie ma operacji składania/anulowania zleceń ani wypłat. Nie importuje wykonawcy
lub transportu zleceń. PAPER/SHADOW i wszystkie blokady LIVE pozostają bez zmian.

1. W Bitvavo utwórz osobny klucz API dla tego laptopa, np. `agencik1-readonly`.
   Włącz tylko **Read-only**. **Trade digital assets** oraz **Withdraw digital
   assets** mają pozostać wyłączone. Jeśli ustawiasz ograniczenie IP, użyj
   aktualnego publicznego adresu wyjściowego laptopa. Adres `localhost`, adres
   WSL/LAN ani IP strony Vercel nie są tym adresem. Zmiana sieci lub publicznego
   IP może wymagać aktualizacji ograniczenia w Bitvavo.
2. W nowym oknie Ubuntu (panel może działać w poprzednim) uruchom:

   ```bash
   cd ~/agencik1-bitvavo
   git pull --ff-only
   npm ci
   npm run test-bitvavo-account-readonly
   npm run test-bitvavo-balance-cli
   npm run bitvavo-balance
   ```

3. Klucz oraz sekret wpisuj lub wklejaj dopiero przy odpowiednim pytaniu
   programu. Wklejaj osobno sam klucz i sam sekret, bez końca linii;
   zatwierdzaj Enterem. Wpisywane znaki nie są wyświetlane. Nie dopisuj sekretów do
   polecenia, plików projektu ani czatu. Program nie zapisuje ich na dysku
   ani w historii powłoki; podczas zapytania pozostają w pamięci procesu.
   Po zakończeniu potrzebne będzie ponowne wpisanie przy następnym odczycie.
4. Wynik pokazuje jednostki każdego aktywa: `available` (dostępne) i `inOrder`
   (zablokowane w zleceniach). Kwoty nie są sumowane ani przeliczane na PLN.
   Pusta lista jest poprawną odpowiedzią — API bez filtra zwraca aktywa
   z saldem powyżej zera. Nie jest to pełna wycena portfela, np. fixed staking
   ma osobny endpoint.

Wynik i salda są widoczne wyłącznie w lokalnym terminalu; nie wysyłaj ich
zrzutów, jeśli nie chcesz udostępniać stanu konta. Program wymaga terminala
interaktywnego, odmawia potoków/przekierowań i nie przyjmuje sekretów przez
argumenty lub zmienne środowiskowe. Pomoc: `npm run bitvavo-balance -- --help`.

Udany odczyt potwierdza dostęp do endpointu salda, **nie** weryfikację KYC,
uprawnienia do handlu, minima zleceń ani gotowość strategii. Ten endpoint nie
pozwala sprawdzić, czy klucz ma dodatkowe uprawnienia: sprawdź je w Bitvavo.
Odczyt historii zleceń wymaga innych uprawnień; nie jest częścią tego etapu.

Jeśli pojawi się błąd, program nie pokazuje salda zerowego zamiast błędu,
nie ponawia zapytania automatycznie i nie drukuje odpowiedzi giełdy ani sekretów.
Sprawdź połączenie internetowe, poprawność klucza, uprawnienie Read-only
i ograniczenie IP w Bitvavo. Do diagnostyki wystarczy komunikat programu,
bez klucza i sekretu.

Testy automatyczne korzystają z fikcyjnych danych i atrap HTTP. Nie potwierdzają
połączenia z konkretnym kontem. Takie potwierdzenie wymaga uruchomienia powyższego
polecenia przez właściciela konta na laptopie. Nie dodano sekretów do CI/Vercel.

## Transport zleceń (nadal niepodłączony)

Bitvavo jest wybraną giełdą dla planowanego pilota 200 PLN. Ten etap dodaje
izolowany transport do istniejącego wykonawcy. Nie podłącza konta, nie wysyła
rzeczywistych zleceń i nie zmienia runtime PAPER/SHADOW ani limitów ryzyka.

## Kontrakt

`lib/bitvavo-order-transport.js` udostępnia `createBitvavoOrderTransport` oraz
metody `submitOrder` i `queryOrder`, zgodne z `lib/order-executor.js`.
Obsługiwane są wyłącznie LIMIT/GTC BUY/SELL na BTC-USDC i ETH-USDC.
Wewnętrzne symbole pozostają BTCUSDC i ETHUSDC. Badania USDT nie są automatycznie
sygnałami do handlu na tych rynkach. Dostępność rynków i ograniczenia konta trzeba
sprawdzić przed LIVE.

Transport jest domyślnie wyłączony. Wymaga jawnej konfiguracji serwerowej,
klucza, sekretu i stałego identyfikatora algorytmu `operatorId`. Nie odczytuje
automatycznie zmiennych środowiskowych. Jawne włączenie transportu samo w sobie
nie jest potwierdzeniem gotowości ani kontrolą ryzyka.

Identyfikator zlecenia powstaje deterministycznie z identyfikatora wykonawcy
i jest przekazywany do Bitvavo jako standardowy UUIDv5 (przestrzeń URL,
nazwa `agencik1:bitvavo:<wewnętrzny identyfikator>`). Mapowanie musi pozostać
niezmienne po wdrożeniu. Zapytanie o stan używa tego samego
identyfikatora po restarcie. Nie wolno współdzielić magazynu wykonawcy między
giełdami, kontami lub środowiskami.

Żądania mają stały host, podpis HMAC, ograniczony czas i zakaz przekierowań.
Transport nie ponawia wysłania zlecenia. Nie ujawnia surowych błędów giełdy,
sekretów ani dodatkowych danych konta. Nie posiada operacji wypłat.
Niepewna odpowiedź pozostawia zlecenie UNKNOWN w wykonawcy i blokuje nowe
intencje do wyjaśnienia. Brak znalezionego zlecenia nie oznacza zgody na ponowienie.

## Testowanie

```bash
npm run test-bitvavo-order-transport
npm run test-bitvavo-execution-integration
npm run verify-development
npm run check-development-evidence
```

Testy używają wyłącznie atrap HTTP i fikcyjnych danych uwierzytelniających.
Nie są testem konta użytkownika ani rzeczywistego wykonania na Bitvavo.
Nie zakładamy istnienia testnetu Bitvavo.

## Co pozostaje przed uruchomieniem

- Zweryfikować saldo, uprawnienia, dostępne rynki, minima, tick size i prowizje
  przez odczyt API konta i publiczne metadane rynku.
- Połączyć właściwą politykę ryzyka z aktualnymi saldami, otwartymi zleceniami,
  rozliczonymi prowizjami i kursem PLN. Stała funkcja `approved: true` jest
  dopuszczalna tylko w testach, nigdy dla LIVE.
- Zapewnić obsługę anulowania i ochrony pozycji, rozliczanie częściowych realizacji,
  uzgadnianie stanu po awarii oraz wyłącznik awaryjny.
- Uruchomić pojedynczy, stale działający worker z prywatnym trwałym magazynem
  i znanym, stałym wychodzącym adresem IP. Obecny lokalny ledger nie jest
  rozproszoną bazą danych ani trwałym magazynem Vercel. Harmonogram badań GitHub
  Actions nie jest workerem obsługującym zlecenia.

W tym etapie nie utworzono serwera ani stałego IP i nie zakupiono usług.
Przed podaniem IP użytkownikowi należy potwierdzić rzeczywisty adres wychodzący
docelowego workera. Adres domeny strony ani IP tymczasowej sesji programistycznej
nie zastępuje tego adresu.

Osobny klucz do przyszłego handlu należy utworzyć dopiero dla docelowego środowiska: odczyt i handel,
bez wypłat, z ograniczeniem do zweryfikowanego IP. Sekret trafia do prywatnej
konfiguracji serwera, nigdy do czatu, repozytorium, przeglądarki ani publicznych
raportów. Agent programujący nie pozostaje aktywny po zakończeniu sesji.

## Źródła kontraktu

- https://docs.bitvavo.com/docs/rest-api/introduction/
- https://docs.bitvavo.com/docs/rest-api/get-account-balance/
- https://docs.bitvavo.com/docs/rest-api/create-order/
- https://docs.bitvavo.com/docs/rest-api/get-order/
- https://docs.bitvavo.com/docs/faqs/
- https://support.bitvavo.com/hc/en-us/articles/4405059841809-What-are-API-keys-and-how-do-I-create-them

Pozostałe ograniczenia wykonawcy opisuje README_EXECUTION_PREPARATION.md.
