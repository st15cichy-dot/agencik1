from .models import Signal

class SMAMomentumStrategy:
    version = "sma-momentum-v0.1"

    def generate(self, symbol: str, prices: list[float]):
        if len(prices) < 20:
            return None
        fast = sum(prices[-5:]) / 5
        slow = sum(prices[-20:]) / 20
        entry = prices[-1]
        if fast > slow:
            return Signal(symbol, "BUY", 0.55, entry, entry * 0.99, entry * 1.02, self.version,
                          "5-period SMA above 20-period SMA")
        return None
