from .config import RiskConfig
from .data import DemoMarketData
from .strategy import SMAMomentumStrategy
from .risk import RiskEngine
from .paper_broker import PaperBroker
from .memory import Journal

def run_cycle():
    cfg = RiskConfig()
    broker = PaperBroker(cfg.starting_capital_pln)
    risk = RiskEngine(cfg)
    strategy = SMAMomentumStrategy()
    data = DemoMarketData()
    journal = Journal()

    symbol = "DEMO/PLN"
    prices = data.prices(symbol)
    signal = strategy.generate(symbol, prices)
    journal.write("SCAN", {"symbol": symbol, "points": len(prices)})

    if not signal:
        journal.write("DECISION", {"result": "NO_SIGNAL"})
        return

    ok, reason = risk.approve(signal, broker.cash, broker.positions, 0.0)
    journal.write("RISK_CHECK", {"approved": ok, "reason": reason, "signal": signal.__dict__})
    if not ok:
        return

    risk_per_unit = abs(signal.entry - signal.stop)
    qty = (broker.cash * cfg.max_risk_per_trade_pct / 100) / risk_per_unit
    fill = broker.open(signal, qty)
    journal.write("PAPER_EXECUTE", {"symbol": symbol, "quantity": qty, "fill": fill})

if __name__ == "__main__":
    run_cycle()
    print("Agent cycle completed. LIVE TRADING IS DISABLED.")
