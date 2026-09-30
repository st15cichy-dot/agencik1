# Autonomous Investor — Free Core

Darmowy, lokalny rdzeń autonomicznego agenta inwestycyjnego.
Domyślnie działa WYŁĄCZNIE w paper trading.

## Architektura
SCAN -> ANALYZE -> DECIDE -> RISK CHECK -> PAPER EXECUTE -> MONITOR -> REVIEW

## Zasady
- startowy kapitał: 200 PLN
- live trading: wyłączony
- risk engine jest niezależny od LLM
- koszty/slippage są uwzględniane
- każda decyzja trafia do journal
- strategia ma wersję
- AI może generować hipotezy, ale nie może wyłączyć risk engine

## Uruchomienie
```bash
python -m agent.main
```

Opcjonalne dane:
```bash
pip install ccxt vectorbt yfinance pandas numpy
```

CCXT służy do danych crypto/exchange, a VectorBT do szybkiego backtestingu.
