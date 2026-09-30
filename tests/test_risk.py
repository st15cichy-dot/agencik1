from agent.config import RiskConfig
from agent.risk import RiskEngine
from agent.models import Signal

def test_risk_rejects_kill_switch():
    cfg = RiskConfig(kill_switch=True)
    engine = RiskEngine(cfg)
    s = Signal("X", "BUY", .9, 100, 99, 102, "test")
    assert engine.approve(s, 200, [], 0)[0] is False

def test_risk_accepts_small_trade():
    engine = RiskEngine(RiskConfig())
    s = Signal("X", "BUY", .9, 100, 99, 102, "test")
    assert engine.approve(s, 200, [], 0)[0] is True
