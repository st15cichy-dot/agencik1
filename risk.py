from .config import RiskConfig
from .models import Signal, Position

class RiskEngine:
    def __init__(self, cfg: RiskConfig):
        self.cfg = cfg

    def approve(self, signal: Signal, equity: float, positions: list[Position], daily_pnl: float) -> tuple[bool, str]:
        if self.cfg.kill_switch:
            return False, "KILL_SWITCH"
        if self.cfg.max_concurrent_positions <= len(positions):
            return False, "MAX_CONCURRENT_POSITIONS"
        if daily_pnl <= -equity * self.cfg.max_daily_loss_pct / 100:
            return False, "MAX_DAILY_LOSS"
        if signal.entry <= 0 or signal.stop <= 0 or signal.take_profit <= 0:
            return False, "INVALID_PRICES"
        risk_per_unit = abs(signal.entry - signal.stop)
        if risk_per_unit <= 0:
            return False, "INVALID_STOP"
        max_risk_cash = equity * self.cfg.max_risk_per_trade_pct / 100
        qty = max_risk_cash / risk_per_unit
        notional = qty * signal.entry
        if notional > equity * self.cfg.max_position_pct / 100:
            return False, "MAX_POSITION_SIZE"
        return True, "APPROVED"
