# Autonomiczny Inwestor v0.7

v0.7 dodaje trwałe, autonomiczne PAPER portfolio.
Realne transakcje i XTB pozostają wyłączone.

## Jak działa heartbeat

1. Screening 8 instrumentów.
2. Deep Lab tylko dla screen PASS oraz zawsze dla już otwartych pozycji paper.
3. Sygnał wejścia jest sprawdzany w całym oknie od poprzedniego heartbeat, żeby 2-godzinny harmonogram nie pomijał krótkiego crossovera.
4. Nowa pozycja może powstać tylko gdy:
   - Deep gate = PASS,
   - w oknie heartbeat wystąpiło aktywne wejście LONG,
   - portfolio nie ma hard/daily halt,
   - nie przekroczono limitów ekspozycji.
5. Otwarta pozycja jest kontrolowana w kolejnych heartbeatach.

## Wyjścia paper

Pozycja jest zamykana, gdy wystąpi pierwsze z:
- stop-loss,
- Deep PASS zostaje utracony,
- zwalidowana strategia/config się zmienia,
- strategia daje EXIT,
- upływa 7 dni,
- portfolio trafia w twardy drawdown stop.

## Hard risk policy

- kapitał startowy: 200 PLN,
- ryzyko / trade: 0,50% equity,
- stop: 2x ATR, minimum 1%, maksimum 5%,
- maks. jedna pozycja: 50% equity,
- maks. łączna ekspozycja: 100% equity,
- maks. 3 otwarte pozycje,
- dzienny loss halt: -2%,
- hard portfolio DD stop: -10%,
- max holding: 168 h,
- fee model: 0,10% / stronę,
- slippage model: 0,03% / stronę.

## Persistence

Gałąź `research-data` otrzymuje:
- latest.json
- history.json
- paper.json
- paper-trades.json

Są to wyłącznie publiczne dane researchowe i symulowane pozycje.
Żadnych sekretów, kont brokerskich ani realnych pozycji.

## Ważne

Wyniki PAPER nie są gwarancją przyszłych wyników.
v0.7 służy do sprawdzenia, czy strategia i risk engine zachowują się poprawnie w warunkach forward/paper.
