from dataclasses import dataclass

@dataclass(frozen=True)
class RiskConfig:
    starting_capital_pln: float = 200.0
    max_risk_per_trade_pct: float = 1.0
    max_daily_loss_pct: float = 3.0
    max_drawdown_pct: float = 10.0
    max_concurrent_positions: int = 2
    max_total_exposure_pct: float = 50.0
    max_position_pct: float = 25.0
    kill_switch: bool = False

LIVE_TRADING_ENABLED = False
AI_DEV_FUND_NET_PROFIT_PCT = 10.0
