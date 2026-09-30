from dataclasses import dataclass

@dataclass
class MarketBar:
    symbol: str
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float

class DemoMarketData:
    def prices(self, symbol: str):
        # Deterministic demo data; replace with CCXT/yfinance adapters.
        base = 100.0
        return [base + i * 0.15 for i in range(30)]
