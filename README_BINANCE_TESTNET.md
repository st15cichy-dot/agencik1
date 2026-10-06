# Binance Spot — pierwszy etap integracji

Moduł `lib/binance-testnet.js` przygotowuje połączenie z Binance Spot Testnet.
Nie jest wykonawcą transakcji: może odczytać specyfikację rynku i sprawdzić
podpisane zlecenie przez `/api/v3/order/test`. Nie wysyła zlecenia do matching
engine, nawet na testnecie. Nie jest podłączony do strategii ani publicznego UI.
Produkcyjny status aplikacji pozostaje PAPER/SHADOW, broker `NONE`, LIVE false.

## Uruchomienie sprawdzeń

```bash
npm run test-binance-testnet
npm run verify-development
npm run check-development-evidence
```

Testy używają kontrolowanych odpowiedzi HTTP, nie konta ani sieci. Ich zaliczenie
nie dowodzi połączenia z Binance. Próba z prawdziwym testnetem wymaga osobnych
kluczy HMAC utworzonych w Binance Spot Testnet. Nie używaj kluczy produkcyjnych;
moduł nie potrafi ustalić, skąd pochodzi podany klucz. Sekretów nie umieszczaj
w rozmowie, repozytorium, kodzie przeglądarki ani zmiennych `NEXT_PUBLIC_*`.

## Kontrakt

- `createBinanceTestnetClient({ apiKey, apiSecret })` tworzy klienta po stronie
  Node.js. Nie odczytuje sekretów automatycznie ze środowiska.
- `getExchangeInfo(symbol)` odczytuje publiczną specyfikację bez kluczy.
- `validateOrder({ symbol, side, quantity, price, clientOrderId })` sprawdza
  zlecenie LIMIT/GTC. Ceny i ilości są dodatnimi tekstami dziesiętnymi;
  nie są zaokrąglane ani konwertowane na zmiennoprzecinkowe liczby.
- Jedyny host to `https://testnet.binance.vision`. Dopuszczone symbole to
  `BTCUSDC` i `ETHUSDC`; to kandydaci techniczni, nie rekomendacja zakupu ani
  potwierdzenie dostępności na koncie użytkownika. Brak symbolu zatrzymuje próbę.
- Klient sprawdza rynek, pobiera czas serwera, podpisuje żądanie HMAC SHA256
  i wysyła je wyłącznie do `/api/v3/order/test`. Filtry giełdowe sprawdza serwer;
  lokalna kontrola formatu nie zastępuje filtrów ani zarządzania ryzykiem.
- Brak przekierowań, automatycznych ponowień i konfigurowalnego hosta.
  Błędy HTTP, timeout lub niepoprawna odpowiedź kończą próbę błędem.
  Komunikaty błędów nie zawierają odpowiedzi serwera ani sekretów.
- `validated: true` oznacza wyłącznie akceptację testu. Nie oznacza wykonania,
  rezerwacji środków, sprawdzenia rentowności ani gotowości do LIVE.

## Droga do automatycznego handlu

Docelowa automatyzacja ma działać bez ręcznej akceptacji każdego zlecenia,
w ramach wcześniej skonfigurowanych limitów. Ten etap jeszcze jej nie uruchamia.
Przed wdrożeniem wykonawcy potrzebne są:

1. Potwierdzenie dostępnych rynków, opłat i sposobu wypłaty na koncie użytkownika.
2. Bezpieczna konfiguracja klucza bez wypłat i kontrola dostępu do konfiguracji.
3. Dokładne wyliczenia ilości, kosztów i ryzyka dla budżetu 200 PLN, z aktualnymi
   filtrami giełdy i konwersją PLN/USDC; obecnego PAPER USDT nie wolno przełączyć
   bezpośrednio na rzeczywiste zlecenia.
4. Trwały rejestr intencji przed wysłaniem zlecenia, pojedynczy aktywny wykonawca,
   uzgadnianie statusu po timeout i restartach oraz obsługa częściowych realizacji.
5. Działający cyklicznie proces, monitorowanie i zatrzymanie po przekroczeniu
   limitów. Obecny harmonogram badań nie jest wykonawcą zleceń.
6. Testy całego cyklu na testnecie i osobne sprawdzenie gotowości produkcyjnej.

Nie dodano usługi, płatnego API, zależności ani sekretów. Agenci tej sesji
nie kontynuują programowania po zakończeniu rozmowy.

## Dokumentacja źródłowa

- [Binance Spot Testnet](https://github.com/binance/binance-spot-api-docs/blob/master/testnet/general-info.md)
- [Spot REST API i podpisy](https://developers.binance.com/en/docs/products/spot/rest-api)
- [Test new order](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/trade)

Dokumentację sprawdzono 6 października 2026. Testnet używa środków wirtualnych
i może być resetowany; wynik z testnetu nie potwierdza dostępności rynku w EOG.
