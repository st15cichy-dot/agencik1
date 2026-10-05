"""Local PAPER_MOCK contract experiment. No IBKR SDK, network, or real orders."""

from __future__ import annotations

import argparse
import copy
import json
import math
import os
from pathlib import Path
import re
import tempfile
import time
from typing import Callable

MODE = "PAPER_MOCK"
STATUSES = {"SUBMITTING", "UNKNOWN", "ACCEPTED", "PARTIALLY_FILLED", "FILLED", "REJECTED", "CANCELLED"}
OPEN_STATUSES = {"SUBMITTING", "UNKNOWN", "ACCEPTED", "PARTIALLY_FILLED"}


class InputError(ValueError):
    """Invalid input or reuse of an immutable intent ID with different content."""


class SafetyError(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _number(value: object) -> bool:
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        return False


def _positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _intent(value: object) -> dict:
    if not isinstance(value, dict):
        raise InputError("INVALID_INTENT")
    identifier, symbol = value.get("id"), value.get("symbol")
    if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", identifier):
        raise InputError("INVALID_INTENT_ID")
    if not isinstance(symbol, str) or not re.fullmatch(r"[A-Z][A-Z0-9._:-]{0,15}", symbol):
        raise InputError("INVALID_SYMBOL")
    if not isinstance(value.get("side"), str) or value["side"] not in {"BUY", "SELL"}:
        raise InputError("INVALID_SIDE")
    if not _positive_int(value.get("quantity")):
        raise InputError("INVALID_QUANTITY")
    if not _number(value.get("priceLimit")) or value["priceLimit"] <= 0:
        raise InputError("INVALID_PRICE_LIMIT")
    return {"id": identifier, "symbol": symbol, "side": value["side"],
            "quantity": value["quantity"], "priceLimit": float(value["priceLimit"])}


class MockBroker:
    """In-memory fake broker. Every fill must be explicitly injected by a test."""

    def __init__(self, account_id: str = "MOCK-ACCOUNT", mode: str = MODE,
                 clock: Callable[[], float] = time.time):
        self.account_id, self.mode, self.clock = account_id, mode, clock
        self.timeout_after_accept = False
        self.reject_next = False
        self.submission_count = 0
        self._orders: dict[str, dict] = {}
        self._executions: list[dict] = []
        self._positions: dict[str, int] = {}
        self._quotes: dict[str, dict] = {}

    def set_quote(self, symbol: str, price: float, timestamp: float | None = None) -> None:
        if not _number(price) or price <= 0:
            raise InputError("INVALID_QUOTE_PRICE")
        timestamp = self.clock() if timestamp is None else timestamp
        if not _number(timestamp):
            raise InputError("INVALID_QUOTE_TIME")
        self._quotes[symbol] = {"price": float(price), "timestamp": float(timestamp)}

    def quote(self, symbol: str) -> dict | None:
        return copy.deepcopy(self._quotes.get(symbol))

    def submit(self, intent: dict) -> dict:
        payload = _intent(intent)
        self.submission_count += 1
        existing = next((o for o in self._orders.values() if o["id"] == payload["id"]), None)
        if existing:
            if _intent(existing) != payload:
                raise InputError("IMMUTABLE_INTENT_ID")
            return copy.deepcopy(existing)
        order_id = f"MOCK-{len(self._orders) + 1:06d}"
        record = {**payload, "order_id": order_id,
                  "status": "REJECTED" if self.reject_next else "ACCEPTED",
                  "filled_quantity": 0, "executions": []}
        self.reject_next = False
        self._orders[order_id] = record
        if self.timeout_after_accept:
            raise TimeoutError("MOCK_ACCEPTED_RESPONSE_LOST")
        return copy.deepcopy(record)

    def order_status(self, order_id_or_intent_id: str) -> dict | None:
        record = self._orders.get(order_id_or_intent_id)
        if record is None:
            record = next((o for o in self._orders.values() if o["id"] == order_id_or_intent_id), None)
        return copy.deepcopy(record)

    orderStatus = order_status

    def open_orders(self) -> list[dict]:
        return copy.deepcopy([o for o in self._orders.values() if o["status"] in OPEN_STATUSES])

    openorders = open_orders

    def executions(self) -> list[dict]:
        return copy.deepcopy(self._executions)

    def positions(self) -> dict[str, int]:
        return {symbol: quantity for symbol, quantity in self._positions.items() if quantity}

    def set_position(self, symbol: str, quantity: int) -> None:
        """Test-only mismatch injection; intentionally does not create executions."""
        if not isinstance(quantity, int) or isinstance(quantity, bool):
            raise InputError("INVALID_POSITION")
        self._positions[symbol] = quantity

    def fill(self, order_id: str, quantity: int, price: float | None = None) -> dict:
        order = self._orders.get(order_id)
        if order is None or order["status"] not in {"ACCEPTED", "PARTIALLY_FILLED"}:
            raise InputError("ORDER_NOT_FILLABLE")
        if not _positive_int(quantity) or quantity > order["quantity"] - order["filled_quantity"]:
            raise InputError("INVALID_FILL_QUANTITY")
        price = order["priceLimit"] if price is None else price
        if not _number(price) or price <= 0:
            raise InputError("INVALID_FILL_PRICE")
        if (order["side"] == "BUY" and price > order["priceLimit"]) or (order["side"] == "SELL" and price < order["priceLimit"]):
            raise InputError("FILL_OUTSIDE_LIMIT")
        execution = {"execution_id": f"FILL-{len(self._executions) + 1:06d}",
                     "order_id": order_id, "intent_id": order["id"], "symbol": order["symbol"],
                     "side": order["side"], "quantity": quantity, "price": float(price)}
        self._executions.append(execution)
        order["executions"].append(copy.deepcopy(execution))
        order["filled_quantity"] += quantity
        order["status"] = "FILLED" if order["filled_quantity"] == order["quantity"] else "PARTIALLY_FILLED"
        delta = quantity if order["side"] == "BUY" else -quantity
        self._positions[order["symbol"]] = self._positions.get(order["symbol"], 0) + delta
        return copy.deepcopy(order)

    def reject(self, order_id: str) -> dict:
        order = self._orders.get(order_id)
        if order is None or order["status"] not in {"ACCEPTED", "PARTIALLY_FILLED"}:
            raise InputError("ORDER_NOT_REJECTABLE")
        order["status"] = "REJECTED"
        return copy.deepcopy(order)

    def cancel(self, order_id: str) -> dict:
        order = self._orders.get(order_id)
        if order is None:
            raise InputError("ORDER_NOT_FOUND")
        if order["status"] in {"ACCEPTED", "PARTIALLY_FILLED"}:
            order["status"] = "CANCELLED"
        return copy.deepcopy(order)


class ExecutionController:
    """Fail-closed mock intent ledger; not a production brokerage adapter."""

    def __init__(self, state_path: str | Path, broker: MockBroker, *,
                 account_id: str = "MOCK-ACCOUNT", quote_max_age: float = 30,
                 max_order_notional: float = 50, max_quantity: int = 10,
                 clock: Callable[[], float] = time.time):
        if type(broker) is not MockBroker:
            raise SafetyError("MOCK_BROKER_ONLY")
        if not isinstance(account_id, str) or not account_id.startswith("MOCK-"):
            raise SafetyError("MOCK_ACCOUNT_ONLY")
        if not _number(quote_max_age) or quote_max_age <= 0 or not _number(max_order_notional) or max_order_notional <= 0 or not _positive_int(max_quantity):
            raise InputError("INVALID_MOCK_LIMITS")
        self.path, self.broker, self.account_id = Path(state_path), broker, account_id
        self.clock, self.quote_max_age = clock, float(quote_max_age)
        self.max_order_notional, self.max_quantity = float(max_order_notional), max_quantity
        self._needs_reconciliation = True
        if self.path.is_symlink():
            raise SafetyError("INVALID_STATE_PATH")
        if self.path.exists():
            try:
                self._state = json.loads(self.path.read_text(encoding="utf-8"))
                self._validate_state()
            except (OSError, ValueError, TypeError, KeyError, InputError):
                raise SafetyError("INVALID_PERSISTENT_STATE") from None
        else:
            self._state = {"schema": 1, "mode": MODE, "account_id": account_id,
                           "enabled": False, "approved": False, "halted": False,
                           "halt_reason": None, "intents": {}, "positions": {}, "executions": {}}
        # A new process never inherits permission to submit from an old process.
        self._state["enabled"] = False
        self._state["approved"] = False
        self._check_broker()
        self._save()

    def _validate_state(self) -> None:
        state = self._state
        if not isinstance(state, dict) or state.get("schema") != 1 or state.get("mode") != MODE or state.get("account_id") != self.account_id:
            raise ValueError("state")
        if any(type(state.get(key)) is not bool for key in ("enabled", "approved", "halted")):
            raise ValueError("flags")
        if state.get("halt_reason") is not None and not isinstance(state["halt_reason"], str):
            raise ValueError("reason")
        if any(not isinstance(state.get(key), dict) for key in ("intents", "positions", "executions")):
            raise ValueError("maps")
        for key, record in state["intents"].items():
            if _intent(record)["id"] != key or record.get("status") not in STATUSES:
                raise ValueError("intent")
            if record.get("order_id") is not None and not isinstance(record["order_id"], str):
                raise ValueError("order")
            filled = record.get("filled_quantity")
            if type(filled) is not int or not 0 <= filled <= record["quantity"] or not isinstance(record.get("executions"), list):
                raise ValueError("fills")
        if any(type(qty) is not int or qty < 0 for qty in state["positions"].values()):
            raise ValueError("positions")
        # Validate ledger relationships before saving anything on restart. A
        # syntactically valid JSON file is not necessarily a valid portfolio.
        expected_positions: dict[str, int] = {}
        executions_by_intent = {identifier: {} for identifier in state["intents"]}
        for execution_id, execution in state["executions"].items():
            if not isinstance(execution, dict) or execution.get("execution_id") != execution_id:
                raise ValueError("execution identity")
            identifier = execution.get("intent_id")
            if not isinstance(identifier, str) or identifier not in state["intents"]:
                raise ValueError("execution intent")
            record = state["intents"][identifier]
            if not isinstance(record["order_id"], str) or any(execution.get(key) != record.get(key) for key in ("order_id", "symbol", "side")):
                raise ValueError("execution order")
            if not _positive_int(execution.get("quantity")) or not _number(execution.get("price")) or execution["price"] <= 0:
                raise ValueError("execution value")
            if (record["side"] == "BUY" and execution["price"] > record["priceLimit"]) or (record["side"] == "SELL" and execution["price"] < record["priceLimit"]):
                raise ValueError("execution limit")
            executions_by_intent[identifier][execution_id] = execution
            delta = execution["quantity"] if execution["side"] == "BUY" else -execution["quantity"]
            expected_positions[record["symbol"]] = expected_positions.get(record["symbol"], 0) + delta
        for identifier, record in state["intents"].items():
            expected_executions = executions_by_intent[identifier]
            recorded_executions = record["executions"]
            if any(not isinstance(execution, dict) or not isinstance(execution.get("execution_id"), str) for execution in recorded_executions):
                raise ValueError("record executions")
            recorded_map = {execution["execution_id"]: execution for execution in recorded_executions}
            if len(recorded_map) != len(recorded_executions) or recorded_map != expected_executions:
                raise ValueError("record execution history")
            filled = sum(execution["quantity"] for execution in expected_executions.values())
            if filled != record["filled_quantity"] or (record["status"] == "FILLED" and filled != record["quantity"]):
                raise ValueError("record fill total")
        expected_positions = {symbol: quantity for symbol, quantity in expected_positions.items() if quantity}
        if expected_positions != state["positions"]:
            raise ValueError("ledger positions")

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".mock-ledger-", dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                json.dump(self._state, output, allow_nan=False, sort_keys=True, indent=2)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _fail(self, reason: str) -> None:
        self._state["halted"] = True
        self._state["halt_reason"] = reason
        self._state["enabled"] = False
        self._needs_reconciliation = True
        self._save()
        raise SafetyError(reason)

    def _check_broker(self) -> None:
        if self.broker.mode != MODE or self.broker.account_id != self.account_id:
            self._fail("WRONG_ACCOUNT_OR_MODE")

    def _broker_read(self, method: str, *args: object) -> object:
        try:
            return getattr(self.broker, method)(*args)
        except Exception:
            self._fail("BROKER_READ_UNAVAILABLE")

    def status(self) -> dict:
        return {key: copy.deepcopy(self._state[key]) for key in
                ("mode", "account_id", "enabled", "approved", "halted", "halt_reason")} | {
                    "needs_reconciliation": self._needs_reconciliation,
                    "intent_count": len(self._state["intents"]), "real_connection": False}

    def get_intent(self, intent_id: str) -> dict | None:
        return copy.deepcopy(self._state["intents"].get(intent_id))

    def approve(self, mode: str = MODE) -> dict:
        if mode != MODE:
            self._fail("ONLY_PAPER_MOCK_APPROVAL")
        self.reconcile()
        if self._state["halted"]:
            raise SafetyError("HALTED")
        self._state["approved"] = True
        self._save()
        return self.status()

    def enable(self) -> dict:
        self.reconcile()
        if self._state["halted"] or not self._state["approved"]:
            raise SafetyError("APPROVAL_REQUIRED_OR_HALTED")
        self._state["enabled"] = True
        self._save()
        return self.status()

    def halt(self, reason: str = "OPERATOR_HALT") -> dict:
        if not isinstance(reason, str) or not reason:
            raise InputError("INVALID_HALT_REASON")
        self._state["enabled"] = False
        self._state["halted"] = True
        self._state["halt_reason"] = reason
        self._save()
        return self.status()

    def resume(self) -> dict:
        self.reconcile()
        if any(record["status"] in {"UNKNOWN", "SUBMITTING"} for record in self._state["intents"].values()):
            raise SafetyError("UNRESOLVED_INTENT")
        self._state.update(enabled=False, approved=False, halted=False, halt_reason=None)
        self._save()
        return self.status()

    def reconcile(self) -> dict:
        self._check_broker()
        updates = copy.deepcopy(self._state["intents"])
        for intent_id, record in updates.items():
            observed = self._broker_read("order_status", record["order_id"] or intent_id)
            if observed is None:
                if record["status"] in {"UNKNOWN", "SUBMITTING"}:
                    record["status"] = "UNKNOWN"
                    continue
                self._fail("CONFIRMED_ORDER_MISSING")
            try:
                identical = _intent(observed) == _intent(record)
            except InputError:
                identical = False
            if not identical or observed.get("status") not in STATUSES or not isinstance(observed.get("order_id"), str):
                self._fail("ORDER_RECONCILIATION_MISMATCH")
            if record["order_id"] is not None and observed["order_id"] != record["order_id"]:
                self._fail("ORDER_ID_CHANGED")
            updates[intent_id] = copy.deepcopy(observed)
        open_orders = self._broker_read("open_orders")
        if not isinstance(open_orders, list) or any(not isinstance(order, dict) for order in open_orders):
            self._fail("INVALID_OPEN_ORDERS_RESPONSE")
        for observed in open_orders:
            if not isinstance(observed.get("id"), str) or observed["id"] not in updates:
                self._fail("UNEXPECTED_OPEN_ORDER")
        executions: dict[str, dict] = {}
        expected: dict[str, int] = {}
        quantities = {key: 0 for key in updates}
        broker_executions = self._broker_read("executions")
        if not isinstance(broker_executions, list):
            self._fail("INVALID_EXECUTIONS_RESPONSE")
        for execution in broker_executions:
            if not isinstance(execution, dict):
                self._fail("INVALID_EXECUTION")
            execution_id, intent_id = execution.get("execution_id"), execution.get("intent_id")
            record = updates.get(intent_id) if isinstance(intent_id, str) else None
            if not isinstance(execution_id, str) or execution_id in executions or record is None:
                self._fail("UNEXPECTED_OR_DUPLICATE_EXECUTION")
            if any(execution.get(key) != record.get(key) for key in ("order_id", "symbol", "side")) or not _positive_int(execution.get("quantity")) or not _number(execution.get("price")) or execution["price"] <= 0:
                self._fail("INVALID_EXECUTION")
            price = execution["price"]
            if (record["side"] == "BUY" and price > record["priceLimit"]) or (record["side"] == "SELL" and price < record["priceLimit"]):
                self._fail("EXECUTION_OUTSIDE_LIMIT")
            executions[execution_id] = copy.deepcopy(execution)
            quantities[intent_id] += execution["quantity"]
            delta = execution["quantity"] if execution["side"] == "BUY" else -execution["quantity"]
            expected[execution["symbol"]] = expected.get(execution["symbol"], 0) + delta
        if any(executions.get(key) != value for key, value in self._state["executions"].items()):
            self._fail("EXECUTION_HISTORY_CHANGED")
        for intent_id, record in updates.items():
            filled = quantities[intent_id]
            if type(record.get("filled_quantity")) is not int or record["filled_quantity"] != filled or not 0 <= filled <= record["quantity"]:
                self._fail("FILL_RECONCILIATION_MISMATCH")
            if record["status"] == "FILLED" and filled != record["quantity"]:
                self._fail("FILL_RECONCILIATION_MISMATCH")
            record["executions"] = [copy.deepcopy(e) for e in executions.values() if e["intent_id"] == intent_id]
        expected = {symbol: quantity for symbol, quantity in expected.items() if quantity}
        actual = self._broker_read("positions")
        if not isinstance(actual, dict) or any(type(qty) is not int or qty < 0 for qty in actual.values()) or expected != actual:
            self._fail("POSITION_MISMATCH")
        self._state.update(intents=updates, executions=executions, positions=expected)
        unresolved = any(record["status"] in {"UNKNOWN", "SUBMITTING"} for record in updates.values())
        self._needs_reconciliation = unresolved
        if unresolved:
            self._state.update(enabled=False, halted=True, halt_reason="UNRESOLVED_INTENT")
        self._save()
        return self.status()

    def _ready(self) -> None:
        self.reconcile()
        if self._state["halted"] or not self._state["enabled"] or not self._state["approved"] or self._needs_reconciliation:
            raise SafetyError("NOT_ENABLED_OR_HALTED")

    def submit_intent(self, intent: dict) -> dict:
        payload = _intent(intent)
        existing = self._state["intents"].get(payload["id"])
        if existing is not None:
            if _intent(existing) != payload:
                raise InputError("IMMUTABLE_INTENT_ID")
            self.reconcile()
            return self.get_intent(payload["id"])
        self._ready()
        if payload["quantity"] > self.max_quantity or payload["quantity"] * payload["priceLimit"] > self.max_order_notional:
            self._fail("MOCK_LIMIT_EXCEEDED")
        quote = self._broker_read("quote", payload["symbol"])
        now = self.clock()
        if not isinstance(quote, dict) or not _number(now) or not _number(quote.get("timestamp")) or not _number(quote.get("price")) or quote["price"] <= 0 or not 0 <= now - quote["timestamp"] <= self.quote_max_age:
            self._fail("STALE_OR_INVALID_QUOTE")
        if payload["side"] == "SELL":
            reserved = sum(record["quantity"] - record["filled_quantity"] for record in self._state["intents"].values()
                           if record["side"] == "SELL" and record["symbol"] == payload["symbol"] and record["status"] in OPEN_STATUSES)
            if payload["quantity"] > self._state["positions"].get(payload["symbol"], 0) - reserved:
                self._fail("INSUFFICIENT_MOCK_POSITION")
        # Reserve the immutable intent before calling broker; a crash is ambiguous.
        self._state["intents"][payload["id"]] = {**payload, "status": "SUBMITTING", "order_id": None,
                                                 "filled_quantity": 0, "executions": []}
        self._save()
        try:
            self.broker.submit(payload)
        except Exception:
            self._state["intents"][payload["id"]]["status"] = "UNKNOWN"
            self._state.update(enabled=False, halted=True, halt_reason="SUBMISSION_RESULT_UNKNOWN")
            self._needs_reconciliation = True
            self._save()
            return self.get_intent(payload["id"])
        # Query broker truth even if its response claims successful submission.
        self.reconcile()
        return self.get_intent(payload["id"])

    def cancel_intent(self, intent_id: str) -> dict:
        self.reconcile()
        record = self._state["intents"].get(intent_id)
        if record is None:
            raise InputError("INTENT_NOT_FOUND")
        if record["order_id"] is None:
            raise SafetyError("UNRESOLVED_INTENT")
        # Cancellation is permitted under HALT to reduce existing mock exposure.
        try:
            self.broker.cancel(record["order_id"])
        except Exception:
            record["status"] = "UNKNOWN"
            self._state.update(enabled=False, halted=True, halt_reason="CANCELLATION_RESULT_UNKNOWN")
            self._needs_reconciliation = True
            self._save()
            return self.get_intent(intent_id)
        self.reconcile()
        return self.get_intent(intent_id)


def self_demo() -> None:
    with tempfile.TemporaryDirectory(prefix="agencik-paper-mock-") as temporary:
        broker = MockBroker()
        broker.set_quote("DEMO", 10)
        controller = ExecutionController(Path(temporary) / "state.json", broker)
        controller.approve()
        controller.enable()
        record = controller.submit_intent({"id": "demo-1", "symbol": "DEMO", "side": "BUY",
                                           "quantity": 2, "priceLimit": 10})
        print(json.dumps({"mode": MODE, "real_connection": False, "status": record["status"]}))
        broker.fill(record["order_id"], 1)
        controller.reconcile()
        print(json.dumps({"mode": MODE, "real_connection": False, "status": controller.get_intent("demo-1")["status"]}))
        controller.cancel_intent("demo-1")
        print(json.dumps({"mode": MODE, "real_connection": False, "status": controller.get_intent("demo-1")["status"]}))
        controller.halt("DEMO_FINISHED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Local PAPER_MOCK only; no IBKR connection or real orders.")
    parser.add_argument("--self-demo", action="store_true", help="run deterministic in-memory demonstration")
    args = parser.parse_args()
    if args.self_demo:
        self_demo()
    else:
        parser.print_help()
