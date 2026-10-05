"""Independent behavior tests for the isolated PAPER_MOCK execution adapter.

Run with: python -m unittest discover -s experiments/ibkr-paper -p 'test_*.py' -v
All state and orders are temporary and in memory. No broker or network is used.
"""

import json
import math
from pathlib import Path
import tempfile
import unittest

from adapter import ExecutionController, InputError, MockBroker, SafetyError


class TestClock:
    def __init__(self):
        self.now = 1_800_000_000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class AdapterBehaviorTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_directory.cleanup)
        self.path = Path(self.temp_directory.name) / "execution-state.json"
        self.clock = TestClock()
        self.broker = MockBroker(clock=self.clock)
        self.broker.set_quote("AAPL", 10)
        self.controller = self.new_controller()

    def new_controller(self, **options):
        return ExecutionController(self.path, self.broker, clock=self.clock, **options)

    def activate(self, controller=None):
        controller = controller or self.controller
        controller.reconcile()
        controller.approve()
        controller.enable()
        return controller

    def intent(self, intent_id="intent-1", **updates):
        payload = {
            "id": intent_id,
            "symbol": "AAPL",
            "side": "BUY",
            "quantity": 2,
            "priceLimit": 10,
        }
        payload.update(updates)
        return payload

    def test_starts_disabled_and_needs_explicit_approval(self):
        status = self.controller.status()
        self.assertFalse(status["enabled"])
        self.assertFalse(status["approved"])
        self.assertFalse(status["real_connection"])
        self.assertEqual(status["mode"], "PAPER_MOCK")
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(self.intent())
        with self.assertRaises(SafetyError):
            self.controller.enable()
        self.assertEqual(self.broker.submission_count, 0)

    def test_same_intent_id_is_idempotent_even_after_restart(self):
        self.activate()
        original = self.controller.submit_intent(self.intent())
        duplicate = self.controller.submit_intent(dict(self.intent()))
        self.assertEqual(original["order_id"], duplicate["order_id"])
        self.assertEqual(self.broker.submission_count, 1)
        self.assertEqual(len(self.broker.open_orders()), 1)

        restarted = self.new_controller()
        self.activate(restarted)
        duplicate_after_restart = restarted.submit_intent(self.intent())
        self.assertEqual(original["order_id"], duplicate_after_restart["order_id"])
        self.assertEqual(self.broker.submission_count, 1)
        self.assertEqual(restarted.status()["intent_count"], 1)

    def test_reusing_id_with_changed_payload_is_rejected(self):
        self.activate()
        self.controller.submit_intent(self.intent())
        with self.assertRaises(InputError):
            self.controller.submit_intent(self.intent(quantity=3))
        self.assertEqual(self.broker.submission_count, 1)
        self.assertEqual(self.controller.get_intent("intent-1")["quantity"], 2)

    def test_timeout_after_accept_never_resubmits_and_blocks_new_orders(self):
        self.activate()
        self.broker.timeout_after_accept = True
        unknown = self.controller.submit_intent(self.intent())
        self.assertEqual(unknown["status"], "UNKNOWN")
        self.assertTrue(self.controller.status()["halted"])
        self.assertEqual(self.broker.submission_count, 1)
        self.assertEqual(len(self.broker.open_orders()), 1)

        # An identical retry reconciles the lookup, never another submission.
        repeated = self.controller.submit_intent(self.intent())
        self.assertEqual(repeated["status"], "ACCEPTED")
        self.assertTrue(self.controller.status()["halted"])
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(self.intent("intent-2"))
        self.assertEqual(self.broker.submission_count, 1)

        self.broker.timeout_after_accept = False
        self.controller.reconcile()
        recovered = self.controller.get_intent("intent-1")
        self.assertEqual(recovered["status"], "ACCEPTED")
        self.assertTrue(self.controller.status()["halted"])
        self.assertEqual(self.broker.submission_count, 1)

    def test_restart_after_timeout_recovers_existing_order(self):
        self.activate()
        self.broker.timeout_after_accept = True
        self.controller.submit_intent(self.intent())
        restarted = self.new_controller()
        self.assertFalse(restarted.status()["enabled"])
        self.assertFalse(restarted.status()["approved"])
        self.assertTrue(restarted.status()["halted"])
        restarted.reconcile()
        self.assertEqual(restarted.get_intent("intent-1")["status"], "ACCEPTED")
        self.assertEqual(self.broker.submission_count, 1)
        self.assertEqual(len(self.broker.open_orders()), 1)

    def test_partial_fill_is_reconciled_once_and_survives_restart(self):
        self.activate()
        accepted = self.controller.submit_intent(self.intent())
        self.broker.fill(accepted["order_id"], 1)
        self.controller.reconcile()
        partial = self.controller.get_intent("intent-1")
        self.assertEqual(partial["status"], "PARTIALLY_FILLED")
        self.assertEqual(partial["filled_quantity"], 1)
        self.assertEqual(len(self.broker.executions()), 1)

        restarted = self.new_controller()
        restarted.reconcile()
        restarted.reconcile()
        restored = restarted.get_intent("intent-1")
        self.assertEqual(restored["filled_quantity"], 1)
        self.assertEqual(len(restored["executions"]), 1)
        self.assertFalse(restarted.status()["halted"])
        self.assertFalse(restarted.status()["enabled"])
        self.assertEqual(self.broker.submission_count, 1)

        self.activate(restarted)
        self.broker.fill(accepted["order_id"], 1)
        restarted.reconcile()
        self.assertEqual(restarted.get_intent("intent-1")["status"], "FILLED")
        self.assertEqual(restarted.get_intent("intent-1")["filled_quantity"], 2)
        self.assertEqual(len(self.broker.executions()), 2)
        self.assertEqual(len(self.broker.open_orders()), 0)

    def test_position_mismatch_halts_and_cannot_be_resumed_unreconciled(self):
        self.activate()
        accepted = self.controller.submit_intent(self.intent())
        self.broker.fill(accepted["order_id"], 1)
        self.controller.reconcile()
        self.broker.set_position("AAPL", 9)
        with self.assertRaises(SafetyError):
            self.controller.reconcile()
        self.assertTrue(self.controller.status()["halted"])
        with self.assertRaises(SafetyError):
            self.controller.resume()
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(self.intent("intent-2"))
        self.assertEqual(self.broker.submission_count, 1)

    def test_buy_then_sell_reconciles_to_flat_without_short_position(self):
        self.activate()
        buy = self.controller.submit_intent(self.intent())
        self.broker.fill(buy["order_id"], 2)
        self.controller.reconcile()
        self.assertEqual(self.broker.positions(), {"AAPL": 2})
        sell = self.controller.submit_intent(self.intent("sell-1", side="SELL"))
        self.broker.fill(sell["order_id"], 2)
        self.controller.reconcile()
        self.assertEqual(self.controller.get_intent("sell-1")["status"], "FILLED")
        self.assertEqual(self.broker.positions(), {})
        self.assertEqual(self.broker.submission_count, 2)
        self.assertFalse(self.controller.status()["halted"])

    def test_sell_without_owned_shares_is_blocked(self):
        self.activate()
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(self.intent(side="SELL"))
        self.assertEqual(self.broker.submission_count, 0)

    def test_live_mode_is_rejected_without_broker_submission(self):
        self.controller.reconcile()
        with self.assertRaises(SafetyError):
            self.controller.approve(mode="LIVE")
        self.assertFalse(self.controller.status()["approved"])
        self.assertEqual(self.broker.submission_count, 0)

    def test_wrong_account_blocks_execution(self):
        with self.assertRaises(SafetyError):
            controller = self.new_controller(account_id="DIFFERENT-ACCOUNT")
            self.activate(controller)
            controller.submit_intent(self.intent())
        self.assertEqual(self.broker.submission_count, 0)

    def test_stale_quote_blocks_execution(self):
        self.activate()
        self.clock.advance(31)
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(self.intent())
        self.assertEqual(self.broker.submission_count, 0)

    def test_future_quote_blocks_execution(self):
        self.activate()
        self.broker.set_quote("AAPL", 10, timestamp=self.clock() + 60)
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(self.intent())
        self.assertEqual(self.broker.submission_count, 0)

    def test_missing_quote_blocks_execution(self):
        self.activate()
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(self.intent(symbol="MISSING"))
        self.assertEqual(self.broker.submission_count, 0)

    def test_notional_limit_blocks_a_small_quantity_with_large_value(self):
        self.activate()
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(self.intent(quantity=6))
        self.assertEqual(self.broker.submission_count, 0)

    def test_quantity_limit_blocks_even_when_notional_is_small(self):
        self.activate()
        self.broker.set_quote("CHEAP", 1)
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(
                self.intent(symbol="CHEAP", quantity=11, priceLimit=1)
            )
        self.assertEqual(self.broker.submission_count, 0)

    def test_invalid_quantity_and_price_are_rejected_before_submission(self):
        self.activate()
        for quantity in (True, False, 0, -1, 1.5, "2", None):
            with self.subTest(quantity=quantity):
                with self.assertRaises(InputError):
                    self.controller.submit_intent(self.intent(quantity=quantity))
        for price in (True, False, 0, -1, math.nan, math.inf, -math.inf, "10", None):
            with self.subTest(price=price):
                with self.assertRaises(InputError):
                    self.controller.submit_intent(self.intent(priceLimit=price))
        self.assertEqual(self.broker.submission_count, 0)

    def test_corrupt_state_is_preserved_and_never_replaced_with_defaults(self):
        self.activate()
        self.controller.submit_intent(self.intent())
        corrupt = b'{"intents": [BROKEN'
        self.path.write_bytes(corrupt)
        with self.assertRaises(SafetyError):
            self.new_controller()
        self.assertEqual(self.path.read_bytes(), corrupt)
        self.assertEqual(self.broker.submission_count, 1)

    def test_json_with_wrong_shape_is_not_silently_bootstrapped(self):
        self.path.write_text(json.dumps([]), encoding="utf-8")
        with self.assertRaises(SafetyError):
            self.new_controller()
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8")), [])
        self.assertEqual(self.broker.submission_count, 0)

    def test_corrupt_position_without_execution_history_cannot_reset_on_restart(self):
        state = json.loads(self.path.read_text(encoding="utf-8"))
        state["positions"] = {"AAPL": 5}
        corrupt = json.dumps(state, indent=2).encode("utf-8")
        self.path.write_bytes(corrupt)
        with self.assertRaises(SafetyError):
            self.new_controller()
        self.assertEqual(self.path.read_bytes(), corrupt)
        self.assertEqual(self.broker.submission_count, 0)

    def test_inconsistent_persistent_fill_history_is_preserved_and_rejected(self):
        self.activate()
        accepted = self.controller.submit_intent(self.intent())
        self.broker.fill(accepted["order_id"], 1)
        self.controller.reconcile()
        original = json.loads(self.path.read_text(encoding="utf-8"))
        for field, value in (("filled_quantity", 2), ("executions", [])):
            with self.subTest(field=field):
                state = json.loads(json.dumps(original))
                state["intents"]["intent-1"][field] = value
                corrupt = json.dumps(state, indent=2).encode("utf-8")
                self.path.write_bytes(corrupt)
                with self.assertRaises(SafetyError):
                    self.new_controller()
                self.assertEqual(self.path.read_bytes(), corrupt)
                self.assertEqual(self.broker.submission_count, 1)

    def test_disappearing_broker_execution_history_halts_without_erasing_fill(self):
        self.activate()
        accepted = self.controller.submit_intent(self.intent())
        self.broker.fill(accepted["order_id"], 1)
        self.controller.reconcile()
        self.broker.executions = lambda: []
        with self.assertRaises(SafetyError):
            self.controller.reconcile()
        self.assertTrue(self.controller.status()["halted"])
        self.assertEqual(self.controller.get_intent("intent-1")["filled_quantity"], 1)
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(self.intent("intent-2"))
        self.assertEqual(self.broker.submission_count, 1)

    def test_duplicate_broker_execution_id_halts_instead_of_double_counting(self):
        self.activate()
        accepted = self.controller.submit_intent(self.intent())
        self.broker.fill(accepted["order_id"], 1)
        self.controller.reconcile()
        execution = self.broker.executions()[0]
        self.broker.executions = lambda: [dict(execution), dict(execution)]
        with self.assertRaises(SafetyError):
            self.controller.reconcile()
        self.assertTrue(self.controller.status()["halted"])
        self.assertEqual(self.controller.get_intent("intent-1")["filled_quantity"], 1)
        self.assertEqual(self.broker.positions(), {"AAPL": 1})
        self.assertEqual(self.broker.submission_count, 1)

    def test_empty_new_broker_cannot_reset_existing_persistent_orders(self):
        self.activate()
        self.controller.submit_intent(self.intent())
        empty_broker = MockBroker(clock=self.clock)
        empty_broker.set_quote("AAPL", 10)
        restarted = ExecutionController(self.path, empty_broker, clock=self.clock)
        with self.assertRaises(SafetyError) as failure:
            restarted.reconcile()
        self.assertEqual(failure.exception.code, "CONFIRMED_ORDER_MISSING")
        self.assertTrue(restarted.status()["halted"])
        self.assertEqual(restarted.status()["intent_count"], 1)
        self.assertEqual(empty_broker.submission_count, 0)
        self.assertEqual(self.broker.submission_count, 1)

    def test_broker_read_timeout_halts_and_preserves_confirmed_order(self):
        self.activate()
        self.controller.submit_intent(self.intent())

        def unavailable_order_status(_identifier):
            raise TimeoutError("injected unavailable broker")

        self.broker.order_status = unavailable_order_status
        with self.assertRaises(SafetyError) as failure:
            self.controller.reconcile()
        self.assertEqual(failure.exception.code, "BROKER_READ_UNAVAILABLE")
        self.assertTrue(self.controller.status()["halted"])
        self.assertEqual(self.controller.get_intent("intent-1")["status"], "ACCEPTED")
        self.assertEqual(self.broker.submission_count, 1)

    def test_malformed_open_orders_response_halts_without_submitting(self):
        responses = (None, "unavailable", {}, [None], ["invalid"], [{"id": []}])
        for index, response in enumerate(responses):
            with self.subTest(response=response):
                broker = MockBroker(clock=self.clock)
                controller = ExecutionController(
                    self.path.parent / ("open-orders-" + str(index) + ".json"),
                    broker,
                    clock=self.clock,
                )
                self.activate(controller)
                broker.open_orders = lambda: response
                with self.assertRaises(SafetyError):
                    controller.reconcile()
                self.assertTrue(controller.status()["halted"])
                self.assertFalse(controller.status()["enabled"])
                self.assertEqual(broker.submission_count, 0)

    def test_malformed_execution_response_halts_without_submitting(self):
        responses = (
            None, "unavailable", {}, [None], ["invalid"],
            [{"execution_id": "broken-id", "intent_id": []}],
        )
        for index, response in enumerate(responses):
            with self.subTest(response=response):
                broker = MockBroker(clock=self.clock)
                controller = ExecutionController(
                    self.path.parent / ("executions-" + str(index) + ".json"),
                    broker,
                    clock=self.clock,
                )
                self.activate(controller)
                broker.executions = lambda: response
                with self.assertRaises(SafetyError):
                    controller.reconcile()
                self.assertTrue(controller.status()["halted"])
                self.assertFalse(controller.status()["enabled"])
                self.assertEqual(broker.submission_count, 0)

    def test_cancel_response_loss_reconciles_without_resubmission(self):
        self.activate()
        self.controller.submit_intent(self.intent())
        original_cancel = self.broker.cancel
        attempts = []

        def cancel_then_timeout(order_id):
            attempts.append(order_id)
            original_cancel(order_id)
            raise TimeoutError("injected cancellation response loss")

        self.broker.cancel = cancel_then_timeout
        uncertain = self.controller.cancel_intent("intent-1")
        self.assertEqual(uncertain["status"], "UNKNOWN")
        self.assertTrue(self.controller.status()["halted"])
        self.controller.reconcile()
        self.assertEqual(self.controller.get_intent("intent-1")["status"], "CANCELLED")
        self.assertEqual(len(attempts), 1)
        self.assertEqual(len(self.broker.open_orders()), 0)
        self.assertEqual(self.broker.submission_count, 1)
        self.assertTrue(self.controller.status()["halted"])

    def test_broker_rejection_is_persisted_without_retry(self):
        self.activate()
        self.broker.reject_next = True
        rejected = self.controller.submit_intent(self.intent())
        self.assertEqual(rejected["status"], "REJECTED")
        self.controller.reconcile()
        self.controller.submit_intent(self.intent())
        self.assertEqual(self.broker.submission_count, 1)
        self.assertEqual(len(self.broker.open_orders()), 0)
        self.assertEqual(len(self.broker.executions()), 0)
        restarted = self.new_controller()
        self.assertEqual(restarted.get_intent("intent-1")["status"], "REJECTED")

    def test_cancel_records_terminal_status_without_erasing_partial_fill(self):
        self.activate()
        accepted = self.controller.submit_intent(self.intent())
        self.broker.fill(accepted["order_id"], 1)
        self.controller.reconcile()
        self.controller.cancel_intent("intent-1")
        self.controller.reconcile()
        cancelled = self.controller.get_intent("intent-1")
        self.assertEqual(cancelled["status"], "CANCELLED")
        self.assertEqual(cancelled["filled_quantity"], 1)
        self.assertEqual(len(cancelled["executions"]), 1)
        self.assertEqual(len(self.broker.open_orders()), 0)
        self.assertEqual(self.broker.submission_count, 1)
        restarted = self.new_controller()
        restarted.reconcile()
        self.assertEqual(restarted.get_intent("intent-1")["status"], "CANCELLED")
        self.assertEqual(restarted.get_intent("intent-1")["filled_quantity"], 1)

    def test_manual_halt_persists_and_resume_does_not_enable_implicitly(self):
        self.activate()
        self.controller.halt("TEST_OPERATOR_STOP")
        with self.assertRaises(SafetyError):
            self.controller.submit_intent(self.intent())
        restarted = self.new_controller()
        self.assertTrue(restarted.status()["halted"])
        restarted.reconcile()
        restarted.resume()
        self.assertFalse(restarted.status()["halted"])
        self.assertFalse(restarted.status()["enabled"])
        self.assertFalse(restarted.status()["approved"])
        with self.assertRaises(SafetyError):
            restarted.submit_intent(self.intent())
        self.activate(restarted)
        restarted.submit_intent(self.intent())
        self.assertEqual(self.broker.submission_count, 1)


if __name__ == "__main__":
    unittest.main()
