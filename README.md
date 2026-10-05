# Autonomous Investor — Free Core

Aktualny produkt: **v0.18, Next.js + deterministyczny silnik JS**. Współpraca
agentów przy implementacji, testach i przeglądzie: [README_V018.md](README_V018.md)
i [AGENTS.md](AGENTS.md). Praca w tle używa istniejących GitHub Actions, bez API LLM.

```bash
npm install --no-audit --no-fund
npm run dev
# Testy, build i raport dla przekazania pracy:
npm run verify-development
```

Poniżej zachowano opis starszego rdzenia Python; jego konfiguracja i testy
nie są bramką wydania aktualnego silnika JS.

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
