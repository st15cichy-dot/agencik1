# Bitvavo — przygotowanie integracji

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

Klucz należy utworzyć dopiero dla docelowego środowiska: odczyt i handel,
bez wypłat, z ograniczeniem do zweryfikowanego IP. Sekret trafia do prywatnej
konfiguracji serwera, nigdy do czatu, repozytorium, przeglądarki ani publicznych
raportów. Agent programujący nie pozostaje aktywny po zakończeniu sesji.

## Źródła kontraktu

- https://docs.bitvavo.com/docs/rest-api/introduction/
- https://docs.bitvavo.com/docs/rest-api/create-order/
- https://docs.bitvavo.com/docs/rest-api/get-order/
- https://docs.bitvavo.com/docs/faqs/
- https://support.bitvavo.com/hc/en-us/articles/4405059841809-What-are-API-keys-and-how-do-I-create-them

Pozostałe ograniczenia wykonawcy opisuje README_EXECUTION_PREPARATION.md.
