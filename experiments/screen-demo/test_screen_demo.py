"""Independent behavioral tests; native Windows desktop capture is not exercised.

Run: python -m unittest discover -s experiments/screen-demo -p test_screen_demo.py -v
OCR tests use actual generated image pixels and the local Tesseract executable.
"""

from dataclasses import replace
from pathlib import Path
import importlib.util
import json
import math
import os
import shutil
import tempfile
import unittest

import screen_demo as demo


NOW = 1000.0


def intent(**changes):
    return replace(
        demo.Intent(intent_id="DEMO001", symbol="AAPL", side="BUY", qty=1, revision=1),
        **changes)


def words(**changes):
    """An independent OCR output fixture, with the button inside the calibrated box."""
    fields = {
        "SCREEN": "PAPER_MOCK_V1", "ACCOUNT": "PAPER_MOCK", "SYMBOL": "AAPL",
        "SIDE": "BUY", "QTY": "1", "INTENT": "DEMO001", "REVISION": "1",
        "STATE": "READY", "LAYOUT": "STANDARD",
    }
    fields.update(changes)
    result = []
    for index, (key, value) in enumerate(fields.items()):
        if value is None:
            continue
        top = 20 + index * 35
        result.extend([
            {"text": key, "left": 60, "top": top, "width": 110, "height": 24},
            {"text": value, "left": 225, "top": top, "width": 210, "height": 24},
        ])
    result.append({"text": "EXECUTE", "left": 105, "top": 380,
                   "width": 105, "height": 24})
    return result


def observation(**changes):
    base = demo.parse_observation(words(), geometry=(800, 600), captured_at=NOW)
    return replace(base, **changes)


def filled(order):
    return {"status": "FILLED", "account": "PAPER_MOCK", "intent_id": order.intent_id,
            "symbol": order.symbol, "side": order.side, "qty": order.qty,
            "revision": order.revision}


class ObservationSafetyTests(unittest.TestCase):
    def test_visible_paper_fields_match_intent_and_locate_button(self):
        obs = observation()
        self.assertEqual((obs.account, obs.symbol, obs.side, obs.qty, obs.intent_id,
                          obs.revision, obs.state, obs.layout, obs.geometry),
                         ("PAPER_MOCK", "AAPL", "BUY", 1, "DEMO001", 1, "READY",
                          "STANDARD", (800, 600)))
        x, y = demo.validate_observation(obs, intent(), now=NOW)
        self.assertGreaterEqual(x, 60)
        self.assertLessEqual(x, 260)
        self.assertGreaterEqual(y, 360)
        self.assertLessEqual(y, 425)

    def test_required_fields_and_screen_sentinel_cannot_be_missing(self):
        for key in ("SCREEN", "ACCOUNT", "SYMBOL", "SIDE", "QTY", "INTENT",
                    "REVISION", "STATE", "LAYOUT"):
            with self.subTest(key=key), self.assertRaises(demo.SafetyError):
                obs = demo.parse_observation(words(**{key: None}),
                                             geometry=(800, 600), captured_at=NOW)
                demo.validate_observation(obs, intent(), now=NOW)
        with self.assertRaises(demo.SafetyError):
            demo.parse_observation(words(SCREEN="OTHER_SCREEN"), captured_at=NOW)

    def test_conflicting_or_repeated_ocr_fields_are_ambiguous(self):
        for key, value in (("ACCOUNT", "LIVE"), ("SYMBOL", "MSFT"),
                           ("QTY", "2"), ("SIDE", "SELL")):
            with self.subTest(key=key), self.assertRaises(demo.SafetyError):
                ambiguous = words() + [
                    {"text": key, "left": 440, "top": 500, "width": 80, "height": 24},
                    {"text": value, "left": 540, "top": 500, "width": 120, "height": 24},
                ]
                obs = demo.parse_observation(ambiguous, captured_at=NOW)
                demo.validate_observation(obs, intent(), now=NOW)

    def test_missing_duplicate_or_unexpected_execute_geometry_blocks(self):
        fixtures = [words()[:-1], words() + [dict(words()[-1], left=110)],
                    words()[:-1] + [dict(words()[-1], left=500)],
                    words()[:-1] + [dict(words()[-1], top=450)],
                    words()[:-1] + [dict(words()[-1], width=500)]]
        for fixture in fixtures:
            with self.subTest(fixture=fixture[-1]), self.assertRaises(demo.SafetyError):
                obs = demo.parse_observation(fixture, captured_at=NOW)
                demo.validate_observation(obs, intent(), now=NOW)

    def test_wrong_mode_instrument_side_quantity_revision_and_ui_state_block(self):
        cases = [dict(account="LIVE"), dict(account="PAPER"), dict(account="DEMO"),
                 dict(symbol="MSFT"), dict(side="SELL"), dict(qty=2),
                 dict(intent_id="OTHER001"), dict(revision=2),
                 dict(state="LOGGED_OUT"), dict(state="DIALOG"),
                 dict(state="PENDING"), dict(state="UNKNOWN"), dict(layout="SHIFTED")]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(demo.SafetyError):
                demo.validate_observation(observation(**changes), intent(), now=NOW)

    def test_old_future_nonfinite_and_invalid_geometry_frames_block(self):
        cases = [dict(captured_at=NOW - 6), dict(captured_at=NOW + 1),
                 dict(captured_at=math.nan), dict(captured_at=math.inf),
                 dict(geometry=(799, 600)), dict(geometry=(800, 601)),
                 dict(geometry=(0, 0)), dict(geometry=(math.nan, 600))]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(demo.SafetyError):
                demo.validate_observation(observation(**changes), intent(), now=NOW)

    def test_invalid_matching_intent_values_cannot_authorize_a_click(self):
        for quantity in (0, -1, 1.5, math.nan, math.inf, True):
            with self.subTest(qty=quantity), self.assertRaises(demo.SafetyError):
                order = intent(qty=quantity)
                obs = observation(qty=quantity)
                demo.validate_observation(obs, order, now=NOW)
        for revision in (0, -1, math.nan, math.inf, True):
            with self.subTest(revision=revision), self.assertRaises(demo.SafetyError):
                demo.validate_observation(observation(revision=revision),
                                          intent(revision=revision), now=NOW)

    def test_confirmation_requires_a_fresh_matching_visible_fill(self):
        ack = demo.confirm_from_observation(observation(state="FILLED"), intent(), now=NOW)
        for key, expected in filled(intent()).items():
            if key != "revision":
                self.assertEqual(ack[key], expected)
        bad = [dict(state="READY"), dict(state="REJECTED"), dict(account="LIVE"),
               dict(symbol="MSFT"), dict(side="SELL"), dict(qty=2),
               dict(intent_id="OTHER001"), dict(revision=2),
               dict(captured_at=NOW - 6), dict(geometry=(801, 600)), dict(layout="SHIFTED")]
        for changes in bad:
            with self.subTest(changes=changes), self.assertRaises(demo.SafetyError):
                obs = observation(**{"state": "FILLED", **changes})
                demo.confirm_from_observation(obs, intent(), now=NOW)


class ExecutionSafetyTests(unittest.TestCase):
    def test_valid_buy_then_sell_mock_orders_restore_initial_position(self):
        broker = demo.MockBroker()
        initial = dict(broker.positions)
        executor = demo.Executor()
        buy = intent()
        clicks = []
        ack = executor.execute(observation(), buy,
                               lambda x, y: (clicks.append((x, y)), broker.apply(buy)),
                               lambda: filled(buy), now=NOW)
        self.assertEqual(ack["status"], "FILLED")
        self.assertEqual(broker.positions["AAPL"], initial["AAPL"] + 1)
        sell = intent(intent_id="DEMO002", side="SELL", revision=2)
        executor.execute(observation(intent_id="DEMO002", side="SELL", revision=2),
                         sell, lambda x, y: (clicks.append((x, y)), broker.apply(sell)),
                         lambda: filled(sell), now=NOW)
        self.assertEqual(broker.positions, initial)
        self.assertEqual(len(broker.history), 2)
        self.assertEqual(len(clicks), 2)
        self.assertTrue(all(row["account"] == "PAPER_MOCK" for row in broker.history))

    def test_every_unsafe_observation_has_zero_clicks_and_zero_mock_orders(self):
        bad = [dict(account="LIVE"), dict(symbol="MSFT"), dict(side="SELL"),
               dict(qty=2), dict(intent_id="OTHER001"), dict(revision=2),
               dict(state="LOGGED_OUT"), dict(state="DIALOG"),
               dict(layout="SHIFTED"), dict(geometry=(900, 600)),
               dict(captured_at=NOW - 6)]
        for changes in bad:
            with self.subTest(changes=changes):
                broker, executor, clicks = demo.MockBroker(), demo.Executor(), []
                initial = dict(broker.positions)
                with self.assertRaises(demo.SafetyError):
                    executor.execute(observation(**changes), intent(),
                                     lambda x, y: (clicks.append((x, y)), broker.apply(intent())),
                                     lambda: filled(intent()), now=NOW)
                self.assertEqual(clicks, [])
                self.assertEqual(broker.history, [])
                self.assertEqual(broker.positions, initial)
                self.assertTrue(executor.halted)

    def test_missing_confirmation_after_accept_never_retries_or_duplicates(self):
        broker, executor, clicks = demo.MockBroker(), demo.Executor(), []
        initial = dict(broker.positions)

        def click(x, y):
            clicks.append((x, y))
            broker.apply(intent())

        with self.assertRaises(demo.SafetyError):
            executor.execute(observation(), intent(), click, lambda: None, now=NOW)
        self.assertTrue(executor.halted)
        for candidate in (intent(), intent(intent_id="DEMO002", revision=2)):
            with self.assertRaises(demo.SafetyError):
                executor.execute(observation(intent_id=candidate.intent_id,
                                              revision=candidate.revision), candidate,
                                 click, lambda: filled(candidate), now=NOW)
        self.assertEqual(len(clicks), 1)
        self.assertEqual(len(broker.history), 1)
        self.assertEqual(broker.positions["AAPL"], initial["AAPL"] + 1)

    def test_confirmations_must_match_all_requested_visible_fields(self):
        changes = [dict(status="PENDING"), dict(status="REJECTED"),
                   dict(account="LIVE"), dict(intent_id="OTHER001"),
                   dict(symbol="MSFT"), dict(side="SELL"), dict(qty=2), dict(qty=True)]
        for mismatch in changes:
            with self.subTest(mismatch=mismatch):
                executor, clicks = demo.Executor(), []
                ack = dict(filled(intent()), **mismatch)
                with self.assertRaises(demo.SafetyError):
                    executor.execute(observation(), intent(),
                                     lambda x, y: clicks.append((x, y)), lambda: ack, now=NOW)
                self.assertEqual(len(clicks), 1)
                self.assertTrue(executor.halted)

    def test_repeating_confirmed_intent_and_broker_duplicate_do_not_repeat(self):
        broker, executor, clicks = demo.MockBroker(), demo.Executor(), []

        def click(x, y):
            clicks.append((x, y))
            broker.apply(intent())

        executor.execute(observation(), intent(), click, lambda: filled(intent()), now=NOW)
        with self.assertRaises(demo.SafetyError):
            executor.execute(observation(), intent(), click, lambda: filled(intent()), now=NOW)
        before = dict(broker.positions)
        with self.assertRaises(demo.SafetyError):
            broker.apply(intent())
        self.assertEqual(broker.positions, before)
        self.assertEqual(len(clicks), 1)
        self.assertEqual(len(broker.history), 1)

    def test_emergency_stop_prevents_first_click(self):
        executor, clicks = demo.Executor(), []
        executor.stop()
        with self.assertRaises(demo.SafetyError):
            executor.execute(observation(), intent(), lambda x, y: clicks.append((x, y)),
                             lambda: filled(intent()), now=NOW)
        self.assertEqual(clicks, [])
        self.assertTrue(executor.halted)

    def test_pending_log_precedes_click_and_unknown_restart_is_halted(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "screen-attempts.jsonl"
            executor, clicks = demo.Executor(log_path=log), []

            def click(x, y):
                self.assertTrue(log.exists(), "pending must be durable before a click")
                self.assertIn("DEMO001", log.read_text(encoding="utf-8"))
                self.assertIn("PENDING", log.read_text(encoding="utf-8").upper())
                clicks.append((x, y))

            with self.assertRaises(demo.SafetyError):
                executor.execute(observation(), intent(), click, lambda: None, now=NOW)
            restarted = demo.Executor(log_path=log)
            self.assertTrue(restarted.halted)
            with self.assertRaises(demo.SafetyError):
                restarted.execute(observation(), intent(),
                                  lambda x, y: clicks.append((x, y)),
                                  lambda: filled(intent()), now=NOW)
            self.assertEqual(len(clicks), 1)

    def test_click_failure_after_mock_accept_is_not_retried_after_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "screen-attempts.jsonl"
            broker, clicks = demo.MockBroker(), []

            def click(x, y):
                clicks.append((x, y))
                broker.apply(intent())
                raise RuntimeError("window failed after accepting a simulated order")

            executor = demo.Executor(log_path=log)
            with self.assertRaises(demo.SafetyError):
                executor.execute(observation(), intent(), click, lambda: filled(intent()), now=NOW)
            restarted = demo.Executor(log_path=log)
            self.assertTrue(restarted.halted)
            with self.assertRaises(demo.SafetyError):
                restarted.execute(observation(), intent(), click, lambda: filled(intent()), now=NOW)
            self.assertEqual(len(clicks), 1)
            self.assertEqual(len(broker.history), 1)

    def test_confirmed_intent_remains_blocked_after_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "screen-attempts.jsonl"
            clicks = []
            executor = demo.Executor(log_path=log)
            executor.execute(observation(), intent(),
                             lambda x, y: clicks.append((x, y)),
                             lambda: filled(intent()), now=NOW)
            restarted = demo.Executor(log_path=log)
            with self.assertRaises(demo.SafetyError):
                restarted.execute(observation(), intent(),
                                  lambda x, y: clicks.append((x, y)),
                                  lambda: filled(intent()), now=NOW)
            self.assertEqual(len(clicks), 1)

    def test_corrupted_or_orphaned_journal_fails_closed(self):
        corrupt = ["{incomplete", "[]\n", json.dumps({"event": "UNKNOWN", "at": NOW}) + "\n",
                   json.dumps({"event": "CONFIRMED", "at": NOW,
                               "intent_id": "DEMO001"}) + "\n"]
        for content in corrupt:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as tmp:
                log = Path(tmp) / "screen-attempts.jsonl"
                log.write_text(content, encoding="utf-8")
                executor, clicks = demo.Executor(log_path=log), []
                self.assertTrue(executor.halted)
                with self.assertRaises(demo.SafetyError):
                    executor.execute(observation(), intent(),
                                     lambda x, y: clicks.append((x, y)),
                                     lambda: filled(intent()), now=NOW)
                self.assertEqual(clicks, [])


class NativeWindowGateTests(unittest.TestCase):
    """Pure HWND/PID gate tests; no desktop or Windows message is sent."""

    def test_only_exact_owned_mock_window_and_geometry_are_allowed(self):
        approved = dict(hwnd=7, expected_hwnd=7, owner_pid=os.getpid(),
                        current_pid=os.getpid(), geometry=(800, 600))
        demo.validate_window_target(**approved)
        changes = [dict(hwnd=8), dict(hwnd=0), dict(expected_hwnd=0),
                   dict(owner_pid=os.getpid() + 1), dict(owner_pid=0), dict(current_pid=0),
                   dict(geometry=(801, 600)), dict(geometry=(800, 599))]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(demo.SafetyError):
                demo.validate_window_target(**dict(approved, **change))


@unittest.skipUnless(importlib.util.find_spec("PIL") and shutil.which("tesseract"),
                     "actual OCR requires Pillow and local Tesseract")
class ActualImageOCRTests(unittest.TestCase):
    def test_actual_rendered_png_buy_and_sell_pixels_are_recognized(self):
        from PIL import Image
        for side, identifier, revision in (("BUY", "DEMO001", 1), ("SELL", "DEMO002", 2)):
            with self.subTest(side=side), tempfile.TemporaryDirectory() as tmp:
                order = intent(side=side, intent_id=identifier, revision=revision)
                frame = demo.render_frame(order)
                file = Path(tmp) / "observed-mock.png"
                frame.save(file)
                with Image.open(file) as decoded:
                    obs = demo.parse_observation(demo.ocr_words(decoded),
                                                 geometry=decoded.size, captured_at=NOW)
                self.assertEqual(obs.side, side)
                self.assertEqual(obs.intent_id, identifier)
                demo.validate_observation(obs, order, now=NOW)

    def test_actual_live_mode_and_dialog_images_never_authorize_click(self):
        for changes in (dict(account="LIVE"), dict(state="DIALOG"),
                        dict(state="LOGGED_OUT"), dict(layout="SHIFTED")):
            with self.subTest(changes=changes):
                frame = demo.render_frame(intent(), **changes)
                obs = demo.parse_observation(demo.ocr_words(frame),
                                             geometry=frame.size, captured_at=NOW)
                for field, expected in changes.items():
                    self.assertEqual(getattr(obs, field), expected)
                with self.assertRaises(demo.SafetyError):
                    demo.validate_observation(obs, intent(), now=NOW)

    def test_confirmation_is_derived_from_actual_filled_image_pixels(self):
        frame = demo.render_frame(intent(), state="FILLED")
        obs = demo.parse_observation(demo.ocr_words(frame), geometry=frame.size, captured_at=NOW)
        self.assertEqual(obs.state, "FILLED")
        ack = demo.confirm_from_observation(obs, intent(), now=NOW)
        self.assertEqual(ack["intent_id"], "DEMO001")
        self.assertEqual(ack["status"], "FILLED")


if __name__ == "__main__":
    unittest.main()
