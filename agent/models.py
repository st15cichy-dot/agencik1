from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

@dataclass
class Signal:
    symbol: str
    side: str
    confidence: float
    entry: float
    stop: float
    take_profit: float
    strategy_version: str
    reason: str = ""

@dataclass
class Position:
    symbol: str
    side: str
    quantity: float
    entry: float
    stop: float
    take_profit: float
    opened_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

@dataclass
class Trade:
    symbol: str
    side: str
    quantity: float
    entry: float
    exit: float
    pnl: float
    costs: float
    strategy_version: str
    opened_at: str
    closed_at: str
