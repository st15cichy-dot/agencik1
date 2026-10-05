# Lokalny eksperyment kontraktu IBKR — PAPER_MOCK

Ten prototyp **nie łączy się z IBKR**. Używa wyłącznie Python standard library,
lokalnego pliku JSON i brokera mock w pamięci. Nie pobiera notowań, nie loguje się
na konto i nie wysyła zleceń demo ani rzeczywistych. Nie zmienia produkcyjnego
adaptera `NONE`, PAPER/SHADOW ani bezpieczników agencik1. Istniejące CI dodatkowo
uruchamia niezależne testy tego mocka i demonstrację; nie steruje brokerem.

## Uruchomienie na Windows

Z katalogu repozytorium, w PowerShell z zainstalowanym Pythonem 3.10 lub nowszym:

```powershell
py -3 .\experiments\ibkr-paper\adapter.py --self-demo
py -3 -m unittest discover -s .\experiments\ibkr-paper -p "test_adapter.py" -v
```

Na Linux/macOS można użyć `python3` zamiast `py -3`. Demonstracja wypisuje
`PAPER_MOCK`, `real_connection: false` oraz stany `ACCEPTED`,
`PARTIALLY_FILLED`, `CANCELLED`. Wykonania są jawnie wstrzykiwane przez kod
demonstracji. Jej plik stanu jest tymczasowy i usuwany po zakończeniu.

## Kontrakt

`MockBroker(account_id="MOCK-ACCOUNT", mode="PAPER_MOCK", clock=time.time)`:
`set_quote(symbol, price, timestamp=None)`, `submit(intent)`,
`order_status(order_id_or_intent_id)` (alias `orderStatus`), `open_orders()`
(alias `openorders`), `executions()`, `positions()`, `cancel(order_id)`.
Testy sterują wynikami przez `fill(order_id, quantity, price=None)`,
`reject(order_id)`, `reject_next=True`, `timeout_after_accept=True` i
`set_position(symbol, quantity)`; ostatnia metoda wywołuje rozbieżność bez
historii wykonań. `submission_count` liczy rzeczywiste wywołania `submit`.

`ExecutionController(state_path, broker, account_id="MOCK-ACCOUNT", ...)`
obsługuje `approve(mode="PAPER_MOCK")`, `enable()`, `halt(reason)`,
`resume()`, `submit_intent(intent)`, `cancel_intent(id)`, `reconcile()`,
`get_intent(id)` i `status()`. Parametry limitów mock: `quote_max_age=30`
sekund, `max_order_notional=50`, `max_quantity=10`. Wartości nie opisują ryzyka
produkcyjnego portfela ani waluty rzeczywistego konta. Mock nie modeluje gotówki,
kosztów, rozrachunku i jakości realizacji.

Zamiar zawiera `id`, `symbol`, `side` (`BUY`/`SELL`), dodatnią całkowitą
`quantity` i skończoną dodatnią `priceLimit`. Ilość bool, NaN i infinity są
odrzucane. ID jest niezmienne: identyczne żądanie odczytuje istniejący wynik,
zmieniona treść tego samego ID wywołuje `InputError`. Odrzucone i anulowane
zamiary także nie mogą zostać ponownie wysłane pod tym samym ID.

Nowy proces resetuje `enabled` i `approved`; operator ponownie wykonuje
`reconcile()`, `approve()`, `enable()`. Przed każdą nową operacją kontroler
uzgadnia identyfikatory, zlecenia, wykonania i pozycje. Zapis zamiaru `SUBMITTING`
następuje atomowo przed wywołaniem mock brokera. Timeout lub inny błąd odpowiedzi
oznacza `UNKNOWN` oraz HALT, bez ponownej wysyłki. Uzgodnienie może odnaleźć
zamówienie po ID zamiaru; dopiero po rozwiązaniu niepewności można wykonać
`resume()`, `approve()`, `enable()`. Przy nierozwiązanym wyniku pozostaje HALT.

Obsługiwane wyniki to `ACCEPTED`, `PARTIALLY_FILLED`, `FILLED`, `REJECTED`,
`CANCELLED`, `UNKNOWN` i przejściowe `SUBMITTING`. Wykonania częściowe zachowują
ilość wykonaną po anulowaniu. SELL nie może przekroczyć uzgodnionej pozycji
pomniejszonej o istniejące rezerwacje SELL. Anulowanie istniejącego zlecenia
mock jest możliwe przy HALT, po uzgodnieniu konta i jego stanu.

Nieprawidłowe konto/tryb, nieaktualny lub przyszły czas notowania, nieznane
otwarte zlecenie, zmieniona historia wykonań, nadmiarowe wykonanie albo
rozbieżność pozycji wywołują `SafetyError` z kodem oraz blokują nowe zamiary.
Uszkodzony plik stanu nie jest zastępowany pustym portfelem.

## Granice i dalsze podłączenie

Mock broker traci dane po zakończeniu procesu. Restart kontrolera w testach
używa tego samego obiektu brokera, aby zasymulować zachowaną historię po stronie
brokera. Nowy pusty mock przy niepustym ledgerze powoduje HALT; nie dowodzi to
gotowości prawdziwego odzyskiwania stanu IBKR. Prototyp przeznaczony jest dla
jednego kontrolera i jednego wykonawcy na plik. Zapis atomowy nie zastępuje
blokady wielu procesów, podpisu stanu ani zabezpieczenia przed jego edycją.
Nie ma rzeczywistej obsługi sieci, sesji, retry, rate limits, walut ani podpisanych
potwierdzeń brokera. Mock nie jest modelem zyskowności strategii.

Następny etap powinien zacząć od odczytu konta PAPER przez osobnego lokalnego
wykonawcę, bez składania zleceń. Dashboard Vercel i GitHub Actions nie sterują
brokerem. IBKR TWS/IB Gateway wymaga działającego komputera, internetu i sesji;
[oficjalna dokumentacja](https://www.interactivebrokers.com/docs/tws-api/doc/tws-settings/daily-weekly-reauthentication)
opisuje automatyczny restart codzienny i cotygodniowe ręczne ponowne logowanie.
[Trading API](https://www.interactivebrokers.com/campus/ibkr-api-page/web-api-trading/)
może być bez dodatkowej opłaty za API; prowizje i ewentualne płatne dane
rynkowe pozostają kosztami brokera. Ten eksperyment nie kupuje żadnych usług
ani nie obiecuje zysku lub bezobsługowego działania po zamknięciu komputera.
