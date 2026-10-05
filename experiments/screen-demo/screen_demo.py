"""Pixel/OCR experiment, restricted to its own fictional PAPER_MOCK window.

No broker integration, network client, credentials or global mouse input.
Native Windows behavior must be validated on Windows; --self-demo is a mock.
"""
from __future__ import annotations

import argparse
import csv
import ctypes
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, replace
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

ACCOUNT = "PAPER_MOCK"
SCREEN = "PAPER_MOCK_V1"
LAYOUT = "STANDARD"
GEOMETRY = (800, 600)
EXECUTE_RECT = (60, 360, 260, 425)
STOP_RECT = (520, 360, 720, 425)
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / ".development-output" / "screen-demo"


class SafetyError(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class Intent:
    intent_id: str = "DEMO001"
    symbol: str = "AAPL"
    side: str = "BUY"
    qty: int = 1
    revision: int = 1


@dataclass(frozen=True)
class Observation:
    account: str
    symbol: str
    side: str
    qty: int
    intent_id: str
    revision: int
    state: str
    layout: str
    geometry: tuple[int, int]
    captured_at: float
    execute_box: tuple[int, int, int, int]
    screen: str = SCREEN


def _finite(value):
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        return False


def _validate_intent(intent: Intent):
    if not isinstance(intent, Intent):
        raise SafetyError("INVALID_INTENT")
    if not isinstance(intent.intent_id, str) or not re.fullmatch(r"[A-Z0-9]{1,24}", intent.intent_id):
        raise SafetyError("INVALID_INTENT_ID")
    if not isinstance(intent.symbol, str) or not re.fullmatch(r"[A-Z]{1,10}", intent.symbol) or intent.side not in ("BUY", "SELL"):
        raise SafetyError("INVALID_INSTRUMENT_OR_SIDE")
    if type(intent.qty) is not int or not 1 <= intent.qty <= 100:
        raise SafetyError("INVALID_QUANTITY")
    if type(intent.revision) is not int or not 1 <= intent.revision <= 999999:
        raise SafetyError("INVALID_REVISION")


def parse_observation(words, *, geometry=GEOMETRY, captured_at=None) -> Observation:
    """Parse OCR words with local image coordinates; reject missing/duplicate fields."""
    if geometry != GEOMETRY:
        raise SafetyError("LAYOUT_GEOMETRY_MISMATCH")
    rows = []
    for word in words:
        value = str(word.get("text", "")).strip()
        if not value:
            continue
        if len(value) > 64 or not value.isascii():
            raise SafetyError("INVALID_OCR_TOKEN")
        try:
            left, top, width, height = (int(word[name]) for name in ("left", "top", "width", "height"))
        except (KeyError, ValueError, TypeError):
            raise SafetyError("INVALID_OCR_BOX") from None
        if left < 0 or top < 0 or width <= 0 or height <= 0 or left + width > geometry[0] or top + height > geometry[1]:
            raise SafetyError("INVALID_OCR_BOX")
        center = top + height / 2
        row = next((row for row in rows if abs(row[0] - center) < 12), None)
        if row is None:
            row = [center, []]
            rows.append(row)
        row[1].append((left, value, (left, top, left + width, top + height)))
    fields = {}
    execute_boxes = []
    labels = {"SCREEN", "ACCOUNT", "SYMBOL", "SIDE", "QTY", "INTENT", "REVISION", "STATE", "LAYOUT"}
    for _, entries in sorted(rows):
        entries.sort()
        values = [entry[1] for entry in entries]
        for entry in entries:
            if entry[1] == "EXECUTE":
                execute_boxes.append(entry[2])
        if values and values[0] in labels:
            if len(values) != 2 or values[0] in fields:
                raise SafetyError("AMBIGUOUS_OCR_FIELD")
            fields[values[0]] = values[1]
    if set(fields) != labels or len(execute_boxes) != 1:
        raise SafetyError("INCOMPLETE_OR_AMBIGUOUS_VIEW")
    if fields["SCREEN"] != SCREEN:
        raise SafetyError("WRONG_SCREEN")
    if not re.fullmatch(r"[0-9]{1,3}", fields["QTY"]) or not re.fullmatch(r"[0-9]{1,6}", fields["REVISION"]):
        raise SafetyError("INVALID_OCR_NUMBER")
    return Observation(
        account=fields["ACCOUNT"], symbol=fields["SYMBOL"], side=fields["SIDE"],
        qty=int(fields["QTY"]), intent_id=fields["INTENT"], revision=int(fields["REVISION"]),
        state=fields["STATE"], layout=fields["LAYOUT"], geometry=geometry,
        captured_at=time.time() if captured_at is None else captured_at,
        execute_box=execute_boxes[0], screen=fields["SCREEN"],
    )


def validate_observation(observation: Observation, intent: Intent, *, now=None, max_age_seconds=5.0):
    _validate_intent(intent)
    if not isinstance(observation, Observation):
        raise SafetyError("INVALID_OBSERVATION")
    now = time.time() if now is None else now
    if not _finite(now) or not _finite(observation.captured_at) or not _finite(max_age_seconds) or max_age_seconds <= 0:
        raise SafetyError("INVALID_CAPTURE_TIME")
    age = now - observation.captured_at
    if age < 0 or age > max_age_seconds:
        raise SafetyError("STALE_VIEW")
    if observation.geometry != GEOMETRY or observation.layout != LAYOUT or observation.screen != SCREEN:
        raise SafetyError("LAYOUT_MISMATCH")
    if observation.account != ACCOUNT:
        raise SafetyError("WRONG_ACCOUNT")
    if observation.state != "READY":
        raise SafetyError("VIEW_NOT_READY")
    if (observation.symbol, observation.side, observation.qty, observation.intent_id, observation.revision) != (
        intent.symbol, intent.side, intent.qty, intent.intent_id, intent.revision
    ) or type(observation.qty) is not int or type(observation.revision) is not int:
        raise SafetyError("INTENT_MISMATCH")
    box = observation.execute_box
    if not isinstance(box, (tuple, list)) or len(box) != 4 or any(type(value) is not int for value in box):
        raise SafetyError("INVALID_EXECUTE_BOX")
    left, top, right, bottom = box
    if not (EXECUTE_RECT[0] <= left < right <= EXECUTE_RECT[2] and EXECUTE_RECT[1] <= top < bottom <= EXECUTE_RECT[3]):
        raise SafetyError("EXECUTE_OUTSIDE_ALLOWED_REGION")
    return ((left + right) // 2, (top + bottom) // 2)


def confirm_from_observation(observation: Observation, intent: Intent, *, now=None, max_age_seconds=5.0):
    """A second fresh pixel/OCR view must show the matching terminal fill."""
    if not isinstance(observation, Observation) or observation.state != "FILLED":
        raise SafetyError("UNCERTAIN_CONFIRMATION")
    validate_observation(replace(observation, state="READY"), intent, now=now, max_age_seconds=max_age_seconds)
    return dict(account=observation.account, intent_id=observation.intent_id, symbol=observation.symbol,
                side=observation.side, qty=observation.qty, revision=observation.revision, status="FILLED")


def validate_window_target(*, hwnd, expected_hwnd, owner_pid, current_pid, geometry):
    if type(hwnd) is not int or hwnd <= 0 or hwnd != expected_hwnd:
        raise SafetyError("FOREIGN_WINDOW")
    if owner_pid != current_pid or current_pid != os.getpid():
        raise SafetyError("FOREIGN_PROCESS")
    if geometry != GEOMETRY:
        raise SafetyError("WINDOW_GEOMETRY_CHANGED")


class MockBroker:
    """Local fake shares and fills; no currency conversion or real trading."""
    def __init__(self):
        self.positions = {"AAPL": 5}
        self.history = []
        self._seen = set()

    def apply(self, intent: Intent):
        _validate_intent(intent)
        if intent.intent_id in self._seen:
            raise SafetyError("DUPLICATE_INTENT")
        current = self.positions.get(intent.symbol, 0)
        if intent.side == "SELL" and current < intent.qty:
            raise SafetyError("MOCK_INSUFFICIENT_POSITION")
        self.positions[intent.symbol] = current + (intent.qty if intent.side == "BUY" else -intent.qty)
        self._seen.add(intent.intent_id)
        receipt = dict(account=ACCOUNT, intent_id=intent.intent_id, symbol=intent.symbol,
                       side=intent.side, qty=intent.qty, status="FILLED", mock_price=100.0)
        self.history.append(receipt)
        return dict(receipt)


class Executor:
    def __init__(self, log_path=None):
        self.log_path = Path(log_path) if log_path is not None else None
        self.halted = False
        self.halt_reason = None
        self.submitted = set()
        self.events = []
        if self.log_path and self.log_path.exists():
            try:
                self.events = [json.loads(line) for line in self.log_path.read_text(encoding="utf-8").splitlines() if line]
                pending = set()
                for event in self.events:
                    if not isinstance(event, dict) or not _finite(event.get("at")):
                        raise ValueError("invalid log event")
                    kind = event["event"]
                    if kind == "PENDING":
                        if event["intent_id"] in self.submitted:
                            raise ValueError("duplicate pending ID")
                        _validate_intent(Intent(intent_id=event["intent_id"], symbol=event["symbol"],
                                                side=event["side"], qty=event["qty"]))
                        pending.add(event["intent_id"])
                        self.submitted.add(event["intent_id"])
                    elif kind == "CONFIRMED":
                        if event["intent_id"] not in pending:
                            raise ValueError("orphan confirmation")
                        pending.remove(event["intent_id"])
                    elif kind == "HALT":
                        if not isinstance(event.get("reason"), str) or not event["reason"]:
                            raise ValueError("invalid halt")
                        self.halted = True
                        self.halt_reason = event.get("reason", "RECOVERED_HALT")
                    else:
                        raise ValueError("unknown log event")
                if pending:
                    self.halted, self.halt_reason = True, "RECOVERED_UNCERTAIN_INTENT"
            except (OSError, ValueError, KeyError, TypeError, SafetyError):
                self.halted, self.halt_reason = True, "INVALID_EXECUTION_LOG"

    def _append(self, event, **fields):
        record = {"event": event, "at": time.time(), **fields}
        if self.log_path:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(record, sort_keys=True) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
        self.events.append(record)

    def stop(self, reason="OPERATOR_STOP"):
        self.halted, self.halt_reason = True, reason
        self._append("HALT", reason=reason)

    def execute(self, observation, intent, click: Callable, confirm: Callable, *, now=None):
        if self.halted:
            raise SafetyError("HALTED")
        try:
            point = validate_observation(observation, intent, now=now)
            if intent.intent_id in self.submitted:
                raise SafetyError("DUPLICATE_INTENT")
            # Durable record precedes dispatch; a restart cannot replay this ID.
            self._append("PENDING", intent_id=intent.intent_id, symbol=intent.symbol, side=intent.side, qty=intent.qty)
            self.submitted.add(intent.intent_id)
            click(*point)
            if self.halted:
                raise SafetyError("HALTED")
            receipt = confirm()
            expected = dict(account=ACCOUNT, intent_id=intent.intent_id, symbol=intent.symbol,
                            side=intent.side, qty=intent.qty, status="FILLED")
            if not isinstance(receipt, dict) or any(receipt.get(key) != value for key, value in expected.items()):
                raise SafetyError("UNCERTAIN_CONFIRMATION")
            if type(receipt.get("qty")) is not int:
                raise SafetyError("UNCERTAIN_CONFIRMATION")
            if "revision" in receipt and (type(receipt["revision"]) is not int or receipt["revision"] != intent.revision):
                raise SafetyError("UNCERTAIN_CONFIRMATION")
            if self.halted:
                raise SafetyError("HALTED")
            self._append("CONFIRMED", intent_id=intent.intent_id)
            return receipt
        except Exception as error:
            code = error.code if isinstance(error, SafetyError) else "EXECUTION_ERROR"
            # Even logging failure must leave this in-process executor halted.
            self.halted, self.halt_reason = True, code
            try:
                self._append("HALT", reason=code)
            except OSError:
                pass
            raise SafetyError(code) from None


def _font(size):
    paths = ["C:/Windows/Fonts/consola.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "DejaVuSansMono.ttf"]
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    raise SafetyError("READABLE_FONT_NOT_FOUND")


def render_frame(intent=Intent(), *, account=ACCOUNT, state="READY", layout=LAYOUT, geometry=GEOMETRY):
    """Identical pixels are displayed in Tk and used by Linux mock fixtures."""
    image = Image.new("RGB", geometry, "white")
    draw = ImageDraw.Draw(image)
    font = _font(23)
    fields = [("SCREEN", SCREEN), ("ACCOUNT", account), ("SYMBOL", intent.symbol), ("SIDE", intent.side),
              ("QTY", str(intent.qty)), ("INTENT", intent.intent_id), ("REVISION", str(intent.revision)),
              ("STATE", state), ("LAYOUT", layout)]
    for row, (key, value) in enumerate(fields):
        draw.text((35, 15 + row * 35), f"{key} {value}", font=font, fill="black")
    draw.rectangle(EXECUTE_RECT, fill="#d9f5db", outline="black", width=2)
    draw.text((100, 379), "EXECUTE", font=font, fill="black")
    draw.rectangle(STOP_RECT, fill="#ffd4d4", outline="black", width=2)
    draw.text((580, 379), "STOP", font=font, fill="black")
    draw.text((35, 465), "LOCAL MOCK ONLY", font=font, fill="black")
    draw.text((35, 505), "NO BROKER / NO REAL MONEY", font=font, fill="black")
    return image


def _resolve_tesseract(command):
    configured = command or os.environ.get("TESSERACT_CMD") or "tesseract"
    found = shutil.which(configured)
    if not found and Path(configured).is_file():
        found = str(Path(configured).resolve())
    if not found:
        raise SafetyError("TESSERACT_NOT_FOUND: install free Tesseract and set PATH or --tesseract")
    return found


def ocr_words(image, *, tesseract_cmd=None):
    command = _resolve_tesseract(tesseract_cmd)
    with tempfile.TemporaryDirectory(prefix="paper-screen-ocr-") as temporary:
        source = Path(temporary) / "capture.png"
        image.save(source)
        try:
            process = subprocess.run([command, str(source), "stdout", "--psm", "11", "-l", "eng", "tsv"],
                                     capture_output=True, text=True, timeout=10, check=True)
        except (OSError, subprocess.SubprocessError):
            raise SafetyError("OCR_FAILED") from None
    return [row for row in csv.DictReader(io.StringIO(process.stdout), delimiter="\t") if row.get("text", "").strip()]


def ocr_image(image, *, captured_at=None, tesseract_cmd=None):
    return parse_observation(ocr_words(image, tesseract_cmd=tesseract_cmd), geometry=image.size, captured_at=captured_at)


def render_fixtures(output):
    from dataclasses import replace
    directory = Path(output)
    directory.mkdir(parents=True, exist_ok=True)
    intent = Intent()
    cases = {"ready": ({}, intent), "wrong_account": ({"account": "LIVE"}, intent),
             "wrong_symbol": ({}, replace(intent, symbol="MSFT")), "wrong_side": ({}, replace(intent, side="SELL")),
             "wrong_qty": ({}, replace(intent, qty=2)), "wrong_intent": ({}, replace(intent, intent_id="OTHER001")),
             "wrong_revision": ({}, replace(intent, revision=2)), "dialog": ({"state": "DIALOG"}, intent),
             "logged_out": ({"state": "LOGGED_OUT"}, intent), "layout_drift": ({"layout": "SHIFTED"}, intent)}
    for name, (options, displayed) in cases.items():
        render_frame(displayed, **options).save(directory / f"{name}.png")
    (directory / "manifest.json").write_text(json.dumps({"scope": "RENDERED_MOCK_NOT_WINDOWS_DESKTOP",
        "intent": intent.__dict__, "cases": list(cases)}, indent=2), encoding="utf-8")
    return list(cases)


def self_demo(intent=Intent(), *, tesseract_cmd=None, output=None):
    """Real OCR, injected mock click/confirmation; never a Windows E2E claim."""
    directory = Path(output or DEFAULT_OUTPUT) / f"run-{time.time_ns()}"
    directory.mkdir(parents=True, exist_ok=False)
    broker, executor = MockBroker(), Executor(directory / "execution.jsonl")
    image = render_frame(intent)
    image.save(directory / "before.png")
    captured = time.time()
    observation = ocr_image(image, captured_at=captured, tesseract_cmd=tesseract_cmd)
    clicks, receipt = [], {}
    def click(x, y):
        clicks.append([x, y])
        receipt.update(broker.apply(intent))
    def confirm():
        after = render_frame(intent, state=receipt.get("status", "UNKNOWN"))
        after.save(directory / "after.png")
        captured = time.time()
        observed = ocr_image(after, captured_at=captured, tesseract_cmd=tesseract_cmd)
        return confirm_from_observation(observed, intent)
    result = executor.execute(observation, intent, click, confirm)
    return {"scope": "RENDERED_MOCK_OCR_ONLY", "nativeWindows": "UNTESTED", "clicks": clicks,
            "receipt": result, "positions": broker.positions, "events": executor.events, "artifacts": str(directory)}


def run_windows_demo(intent, *, tesseract_cmd=None, log_path=None):
    if sys.platform != "win32":
        raise SafetyError("WINDOWS_REQUIRED: use --self-demo for rendered mock OCR on other systems")
    _resolve_tesseract(tesseract_cmd)
    try:
        import tkinter as tk
        from tkinter import messagebox
        from PIL import ImageGrab, ImageTk
    except ImportError:
        raise SafetyError("TKINTER_REQUIRED: install Python with Tcl/Tk support") from None
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    from ctypes import wintypes
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetClientRect.restype = wintypes.BOOL
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SendMessageW.restype = ctypes.c_ssize_t
    user32.IsWindow.argtypes = [wintypes.HWND]
    user32.IsWindow.restype = wintypes.BOOL
    # Opt out of coordinate virtualization before creating this process's UI.
    try:
        user32.SetProcessDPIAware()
    except AttributeError:
        pass
    root = tk.Tk()
    root.title("Agencik: own window PAPER MOCK ONLY")
    root.resizable(False, False)
    canvas = tk.Canvas(root, width=GEOMETRY[0], height=GEOMETRY[1], highlightthickness=0, bd=0)
    canvas.pack()
    log_path = Path(log_path) if log_path else DEFAULT_OUTPUT / "native-execution.jsonl"
    broker, executor, receipt = MockBroker(), Executor(log_path), {}
    canvas_image = None
    executing = False
    dispatch_armed = False
    def draw(state="READY"):
        nonlocal canvas_image
        canvas_image = ImageTk.PhotoImage(render_frame(intent, state=state))
        canvas.delete("all")
        canvas.create_image(0, 0, image=canvas_image, anchor="nw")
    def stop(_event=None):
        executor.stop()
        draw("HALTED")
    def on_click(event):
        # Only armed programmatic dispatch can execute the local fake order.
        if STOP_RECT[0] <= event.x <= STOP_RECT[2] and STOP_RECT[1] <= event.y <= STOP_RECT[3]:
            stop()
        elif dispatch_armed and not executor.halted and EXECUTE_RECT[0] <= event.x <= EXECUTE_RECT[2] and EXECUTE_RECT[1] <= event.y <= EXECUTE_RECT[3]:
            receipt.update(broker.apply(intent))
            draw("FILLED")
    canvas.bind("<ButtonRelease-1>", on_click)
    root.bind("<Escape>", stop)
    root.protocol("WM_DELETE_WINDOW", lambda: (stop(), root.destroy()))
    draw("HALTED" if executor.halted else "READY")
    root.update()
    owned_hwnd = canvas.winfo_id()
    def check_window():
        if not user32.IsWindow(owned_hwnd):
            raise SafetyError("OWN_WINDOW_MISSING")
        pid, rectangle = wintypes.DWORD(), wintypes.RECT()
        if not user32.GetWindowThreadProcessId(owned_hwnd, ctypes.byref(pid)) or not user32.GetClientRect(owned_hwnd, ctypes.byref(rectangle)):
            raise SafetyError("OWN_WINDOW_QUERY_FAILED")
        validate_window_target(hwnd=canvas.winfo_id(), expected_hwnd=owned_hwnd, owner_pid=pid.value,
                               current_pid=os.getpid(), geometry=(rectangle.right, rectangle.bottom))
    def own_click(x, y):
        nonlocal dispatch_armed
        # Process queued ESC/STOP while dispatch is still disarmed.
        root.update()
        check_window()
        if executor.halted:
            raise SafetyError("HALTED")
        parameter = (y << 16) | x
        dispatch_armed = True
        try:
            user32.SendMessageW(owned_hwnd, 0x0201, 1, parameter)  # WM_LBUTTONDOWN
            user32.SendMessageW(owned_hwnd, 0x0202, 0, parameter)  # WM_LBUTTONUP
            root.update()
        finally:
            dispatch_armed = False
    def capture():
        check_window()
        root.update_idletasks()
        x, y = canvas.winfo_rootx(), canvas.winfo_rooty()
        captured = time.time()
        return ImageGrab.grab(bbox=(x, y, x + GEOMETRY[0], y + GEOMETRY[1]), all_screens=True), captured
    def responsive_ocr(image, captured):
        # OCR is local but may take seconds; keep ESC/STOP alive during it.
        import threading
        import queue
        results = queue.Queue()
        def work():
            try:
                results.put(ocr_image(image, captured_at=captured, tesseract_cmd=tesseract_cmd))
            except Exception as error:
                results.put(error)
        threading.Thread(target=work, daemon=True).start()
        while results.empty():
            root.update()
            if executor.halted:
                raise SafetyError("HALTED")
            time.sleep(0.02)
        result = results.get_nowait()
        # A fast OCR may finish before the wait loop: STOP must still win.
        root.update()
        if executor.halted:
            raise SafetyError("HALTED")
        if isinstance(result, Exception):
            raise result
        return result
    def visible_confirmation():
        image, captured = capture()
        image.save(log_path.parent / "native-after.png")
        return confirm_from_observation(responsive_ocr(image, captured), intent)
    def automate():
        nonlocal executing
        if executing:
            return
        if executor.halted:
            messagebox.showwarning(
                "Stopped",
                "HALT: " + str(executor.halt_reason or "UNKNOWN")
                + "\nNo automatic retry. Review the full journal for the first HALT."
                + "\nLog: " + str(log_path),
            )
            return
        try:
            executing = True
            image, captured = capture()
            log_path.parent.mkdir(parents=True, exist_ok=True)
            image.save(log_path.parent / "native-before.png")
            observation = responsive_ocr(image, captured)
            result = executor.execute(observation, intent, own_click, visible_confirmation)
            draw("FILLED")
            messagebox.showinfo("Local mock filled", json.dumps(result, indent=2) + "\nFake positions: " + str(broker.positions))
        except (SafetyError, tk.TclError, OSError) as error:
            code = error.code if isinstance(error, SafetyError) else "NATIVE_WINDOW_ERROR"
            if not executor.halted:
                executor.stop(code)
            try:
                window_exists = root.winfo_exists()
            except tk.TclError:
                window_exists = False
            if window_exists:
                draw("HALTED")
                messagebox.showwarning(
                    "HALT", code + "\nNo retry. No real broker was contacted."
                    + "\nLog: " + str(log_path),
                )
        finally:
            executing = False
    tk.Button(root, text="Run ONE screenshot/OCR/mock click", command=automate).pack(pady=8)
    tk.Label(root, text="ESC / red STOP: halt. Own window only. No real broker. Log: " + str(log_path)).pack(pady=4)
    root.mainloop()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--demo", action="store_true", help="Native Windows own-window screenshot/OCR demo")
    mode.add_argument("--self-demo", action="store_true", help="Rendered mock OCR and injected click, not Windows proof")
    mode.add_argument("--render-fixtures", metavar="OUT", help="Render local fictional OCR fixtures")
    parser.add_argument("--tesseract", help="Installed tesseract executable path; otherwise TESSERACT_CMD/PATH")
    parser.add_argument("--log", help="Native execution journal; default ignored .development-output/screen-demo")
    parser.add_argument("--output", help="Self-demo artifact directory; default ignored .development-output/screen-demo")
    parser.add_argument("--side", choices=("BUY", "SELL"), default="BUY")
    parser.add_argument("--symbol", default="AAPL")
    parser.add_argument("--qty", type=int, default=1)
    parser.add_argument("--intent", default="DEMO001")
    options = parser.parse_args(argv)
    try:
        intent = Intent(intent_id=options.intent, symbol=options.symbol, side=options.side, qty=options.qty)
        _validate_intent(intent)
        if options.render_fixtures:
            print(json.dumps({"scope": "RENDERED_MOCK_ONLY", "fixtures": render_fixtures(options.render_fixtures)}))
        elif options.self_demo:
            print(json.dumps(self_demo(intent, tesseract_cmd=options.tesseract, output=options.output), indent=2))
        else:
            run_windows_demo(intent, tesseract_cmd=options.tesseract, log_path=options.log)
        return 0
    except SafetyError as error:
        print("HALT: " + error.code, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
