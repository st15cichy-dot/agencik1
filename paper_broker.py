from .models import Position, Trade
from datetime import datetime, timezone

class PaperBroker:
    def __init__(self, cash: float, fee_bps: float = 10.0, slippage_bps: float = 5.0):
        self.cash = cash
        self.fee_bps = fee_bps
        self.slippage_bps = slippage_bps
        self.positions: list[Position] = []
        self.trades: list[Trade] = []

    def open(self, signal, quantity):
        fill = signal.entry * (1 + self.slippage_bps / 10000 if signal.side == "BUY" else 1 - self.slippage_bps / 10000)
        cost = fill * quantity * self.fee_bps / 10000
        self.cash -= fill * quantity + cost
        self.positions.append(Position(signal.symbol, signal.side, quantity, fill, signal.stop, signal.take_profit))
        return fill

    def close(self, position, price, strategy_version):
        fill = price * (1 - self.slippage_bps / 10000 if position.side == "BUY" else 1 + self.slippage_bps / 10000)
        gross = (fill - position.entry) * position.quantity if position.side == "BUY" else (position.entry - fill) * position.quantity
        costs = (fill * position.quantity) * self.fee_bps / 10000
        pnl = gross - costs
        self.cash += fill * position.quantity - costs
        self.positions.remove(position)
        self.trades.append(Trade(position.symbol, position.side, position.quantity, position.entry, fill,
                                 pnl, costs, strategy_version, position.opened_at,
                                 datetime.now(timezone.utc).isoformat()))
        return pnl
