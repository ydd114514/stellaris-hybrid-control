"""Offline tests: no Win32 DLL loading, game enumeration, screenshots or input."""
import base64
import ctypes
import importlib.util
import pathlib
import struct
import sys
import unittest
import zlib
from dataclasses import replace
from types import SimpleNamespace

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "native" / "windows_bridge.py"
SPEC = importlib.util.spec_from_file_location("tested_windows_bridge", MODULE_PATH)
bridge = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)


class FakeWin32:
    def __init__(self):
        self.window = bridge.Window(0x123456789, 42, 133000000000000001, r"D:\Games\Stellaris\stellaris.exe", "群星",
                                    -1280, 100, 1000, 600, True, False)
        self.inputs = []; self.enumerations = 0; self.captures = 0; self.inspections = 0
        self.position = (-1000, 300); self.elapsed = 0; self.after_sleep = None; self.after_capture = None
        self.partial = False; self.inspect_override = None
        self.focus_calls = []; self.focus_allowed = True; self.after_focus = None
        self.extra_windows = []

    def list_windows(self, _):
        self.enumerations += 1
        return [self.window, *self.extra_windows]

    def inspect(self, hwnd, game_path):
        self.inspections += 1
        return self.inspect_override or self.window

    def desktop_rect(self):
        return (-1920, 0, 3840, 1080)

    def focus(self, window, game_path):
        self.focus_calls.append((window.identity, game_path))
        if self.focus_allowed:
            self.window = replace(self.window, foreground=True, minimized=False)
        if self.after_focus:
            self.after_focus()

    def cursor(self):
        return self.position

    def scan(self, key):
        return key

    def send(self, values):
        for value in values:
            clone = bridge.INPUT.from_buffer_copy(bytes(value))
            self.inputs.append((clone, self.window.foreground))
            if clone.type == 0 and clone.mi.dwFlags & bridge.MOVE:
                self.position = (-1920 + round(clone.mi.dx * 3839 / 65535), round(clone.mi.dy * 1079 / 65535))
        if self.partial:
            self.partial = False
            return max(0, len(values) - 1)
        return len(values)

    def capture(self, _):
        self.captures += 1
        if self.after_capture:
            self.after_capture()
        return b"offline fixture image"

    def sleep(self, seconds):
        self.elapsed += seconds
        if self.after_sleep:
            self.after_sleep()


class WindowsBridgeOfflineTests(unittest.TestCase):
    def make(self):
        api = FakeWin32()
        return api, bridge.Bridge(api, sleep=api.sleep, now=lambda: 1700000000000)

    def test_win64_input_abi_has_hardware_union_alignment(self):
        self.assertEqual(ctypes.sizeof(bridge.BITMAPINFOHEADER), 40)
        if ctypes.sizeof(ctypes.c_void_p) == 8:
            self.assertEqual(ctypes.sizeof(bridge.INPUT), 40)
            self.assertEqual(bridge.INPUT.u.offset, 8)
            self.assertEqual(ctypes.sizeof(bridge.MOUSEINPUT), 32)
            self.assertEqual(bridge.MOUSEINPUT.dwExtraInfo.offset, 24)
            self.assertEqual(ctypes.sizeof(bridge.KEYBDINPUT), 24)
        extended = bridge.keyboard_input(0xE04D, True)
        self.assertEqual(extended.ki.wScan, 0x4D)
        self.assertEqual(extended.ki.dwFlags, bridge.SCANCODE | bridge.EXTENDEDKEY | bridge.KEYUP)

    def test_png_fixture_matches_png_spec_rgb_order_crc_and_top_down_rows(self):
        pixels = bytes([0, 0, 255, 0, 0, 255, 0, 9, 255, 0, 0, 255, 255, 255, 255, 0])
        png = bridge.encode_png(2, 2, pixels)
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        offset = 8; chunks = {}
        while offset < len(png):
            length = struct.unpack_from(">I", png, offset)[0]
            kind = png[offset + 4:offset + 8]; data = png[offset + 8:offset + 8 + length]
            checksum = struct.unpack_from(">I", png, offset + length + 8)[0]
            self.assertEqual(checksum, zlib.crc32(kind + data) & 0xFFFFFFFF)
            chunks[kind] = chunks.get(kind, b"") + data; offset += length + 12
        self.assertEqual(struct.unpack(">IIBBBBB", chunks[b"IHDR"]), (2, 2, 8, 2, 0, 0, 0))
        self.assertEqual(zlib.decompress(chunks[b"IDAT"]), b"\0\xff\0\0\0\xff\0\0\0\0\xff\xff\xff\xff")
        for arguments in [(0, 1, b""), (1, 1, b""), (8192, 8192, b"")]:
            with self.assertRaises(bridge.BridgeError):
                bridge.encode_png(*arguments)

    def test_untrusted_input_rejects_nan_large_payload_arrays_and_saved_shortcuts(self):
        for raw in (b'{"x":NaN}', b'{"x":Infinity}', b"[]", b"\xff", b" " * (bridge.MAX_REQUEST + 1)):
            with self.assertRaises(bridge.BridgeError):
                bridge.read_request(raw)
        for key in ("CTRL+S", "ctrl+s", "ALT+TAB", "ALT+F4", "WIN+L", "`", "~", "F5", "F9", "CTRL+SHIFT+S", "CTRL+O", "CTRL+V"):
            with self.subTest(key=key), self.assertRaises(bridge.BridgeError):
                bridge.parse_key(key)
        self.assertEqual(bridge.parse_key("space"), [0x20])
        self.assertEqual(bridge.parse_key("CTRL+1"), [0x11, ord("1")])
        for path in ("stellaris.exe", r"D:\Games\notepad.exe", "D:\\Games\\stellaris.exe\x00"):
            with self.assertRaises(bridge.BridgeError):
                bridge.canonical_game_path(path)

    def test_blank_capture_detection_ignores_uninitialized_alpha(self):
        for raw in (b"\0\0\0\0\0\0\0\xff", b"\xff\xff\xff\0\xff\xff\xff\x40", b"", b"\0"):
            with self.assertRaises(bridge.BridgeError):
                bridge.validate_capture_pixels(raw)
        # A dark scene with actual non-black content, and opaque/transparent
        # colored pixels, remain valid captures.
        bridge.validate_capture_pixels(b"\0\0\0\0\0\0\x01\0")
        bridge.validate_capture_pixels(b"\0\0\xff\0")

    def test_white_loading_frame_with_small_cursor_is_rejected(self):
        # Native-size reported failure: a 2560x1440 white client area with a
        # small 24x32 cursor. Alpha varies and must not affect the decision.
        width, height = 2560, 1440
        frame = bytearray(b"\xff\xff\xff\0" * (width * height))
        for row in range(32):
            offset = ((height // 2 + row) * width + width // 2) * 4
            frame[offset:offset + 24 * 4] = b"\0\0\0\xff" * 24
        with self.assertRaisesRegex(bridge.BridgeError, "游戏仍在加载或未取得有效画面，暂不操作"):
            bridge.validate_capture_pixels(frame)

    def test_near_white_loading_background_with_small_decoration_is_rejected(self):
        frame = b"\xfb\xfc\xfd\x40" * 39920 + b"\x40\x60\x80\0" * 80
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_capture_pixels(frame)

    def test_black_capture_with_only_cursor_is_rejected(self):
        width, height = 1920, 1080
        frame = bytearray(b"\0\0\0\x80" * (width * height))
        for row in range(24):
            offset = ((height // 2 + row) * width + width // 2) * 4
            frame[offset:offset + 24 * 4] = b"\xff\xff\xff\0" * 24
        with self.assertRaises(bridge.BridgeError):
            bridge.validate_capture_pixels(frame)

    def test_valid_dark_star_map_and_light_menu_keep_visible_detail(self):
        # Deep-space gradients may be near-black almost everywhere; exact-zero
        # counting must preserve them, including dim values of only 1 or 2.
        dark = bytearray()
        for row in range(144):
            for column in range(256):
                if (column * 13 + row * 19) % 191 == 0:
                    dark.extend(b"\x90\xb0\xff\0")
                else:
                    dark.extend(bytes((1 + (column % 3), 1 + (row % 2), 2, (column + row) % 256)))
        bridge.validate_capture_pixels(dark)
        # Even a true-black star field remains usable when stars/UI occupy
        # more than 0.1%; do not conflate all dark frames with empty captures.
        bridge.validate_capture_pixels(b"\0\0\0\xff" * 39760 + b"\x20\x80\xd0\0" * 240)
        # A bright menu with meaningful controls is different from blank white.
        bridge.validate_capture_pixels(b"\xff\xff\xff\0" * 39600 + b"\x20\x40\x70\xff" * 400)

    def test_invalid_capture_cannot_produce_observation_or_input(self):
        api, worker = self.make()
        def invalid_capture(_):
            bridge.validate_capture_pixels(b"\xff\xff\xff\0" * 9990 + b"\0\0\0\xff" * 10)
            self.fail("无信息画面不能返回给模型")
        api.capture = invalid_capture
        with self.assertRaises(bridge.BridgeError):
            worker.handle({"command": "observe"})
        self.assertEqual(api.inputs, [])

    def test_invalid_actions_are_rejected_before_desktop_enumeration(self):
        api, worker = self.make()
        bad_actions = [{"type": "click", "x": True, "y": 0}, {"type": "click", "x": 1001, "y": 0},
                       {"type": "click", "x": 0, "y": 0, "count": 3}, {"type": "key", "key": "ALT+TAB"},
                       {"type": "scroll", "amount": 11}, {"type": "scroll", "amount": 1, "x": 3},
                       {"type": "wait", "seconds": 3.1}, {"type": "drag", "fromX": 0, "fromY": 0, "toX": -1, "toY": 0}]
        for action in bad_actions:
            with self.subTest(action=action), self.assertRaises(bridge.BridgeError):
                worker.handle({"command": "execute", "action": action})
        self.assertEqual(api.enumerations, 0); self.assertEqual(api.inputs, [])

    def test_doctor_never_captures_or_inputs_even_when_game_is_not_foreground(self):
        api, worker = self.make(); api.window = replace(api.window, foreground=False, minimized=True)
        result = worker.handle({"command": "doctor"})
        self.assertTrue(result["ok"]); self.assertEqual(len(result["windows"]), 1)
        self.assertEqual(result["windows"][0]["hwnd"], str(0x123456789))
        self.assertEqual(api.captures, 0); self.assertEqual(api.inputs, [])

    def test_minimized_nonforeground_resize_and_reused_handle_fail_without_input(self):
        for change in ({"foreground": False}, {"minimized": True}, {"width": 999}, {"created": 7}, {"pid": 43}):
            api, worker = self.make(); baseline = api.window
            api.inspect_override = replace(baseline, **change)
            with self.subTest(change=change), self.assertRaises(bridge.BridgeError):
                worker.handle({"command": "execute", "windowId": baseline.identity, "expectedWidth": 1000, "expectedHeight": 600,
                               "action": {"type": "click", "x": 500, "y": 500}})
            self.assertEqual(api.inputs, []); self.assertEqual(api.captures, 0)

    def test_observation_is_discarded_if_focus_changes_during_capture(self):
        api, worker = self.make()
        api.after_capture = lambda: setattr(api, "window", replace(api.window, foreground=False))
        with self.assertRaises(bridge.BridgeError):
            worker.handle({"command": "observe"})
        self.assertEqual(api.captures, 1); self.assertEqual(api.inputs, [])
        api.after_capture = None; api.window = replace(api.window, foreground=True)
        result = worker.handle({"command": "observe"})
        self.assertEqual(result["at"], 1700000000000)
        self.assertEqual(base64.b64decode(result["imageBase64"]), b"offline fixture image")
        self.assertEqual(result["windowId"], api.window.identity)

    def test_click_1000_boundary_stays_inside_client_on_negative_monitor(self):
        api, worker = self.make()
        result = worker.handle({"command": "execute", "expectedWindow": api.window.public(), "action": {"type": "click", "x": 1000, "y": 1000, "count": 1.0}})
        self.assertTrue(result["ok"])
        self.assertEqual(api.position, (-281, 699))
        self.assertEqual([item.mi.dwFlags for item, _ in api.inputs], [bridge.MOVE | bridge.ABSOLUTE | bridge.VIRTUALDESK, bridge.LEFTDOWN, bridge.LEFTUP])

    def test_partial_keyboard_injection_releases_all_keys(self):
        api, worker = self.make(); api.partial = True
        with self.assertRaises(bridge.BridgeError):
            worker.handle({"command": "execute", "action": {"type": "key", "key": "CTRL+1"}})
        releases = [item.ki.wScan for item, _ in api.inputs if item.type == 1 and item.ki.dwFlags & bridge.KEYUP]
        self.assertEqual(releases, [ord("1"), 0x11])

    def test_drag_loses_focus_stops_motion_and_releases_button(self):
        api, worker = self.make()
        def steal_focus():
            if api.elapsed >= 0.12:
                api.window = replace(api.window, foreground=False)
        api.after_sleep = steal_focus
        with self.assertRaises(bridge.BridgeError):
            worker.handle({"command": "execute", "action": {"type": "drag", "fromX": 0, "fromY": 0, "toX": 1000, "toY": 1000}})
        self.assertLess(api.elapsed, 1)
        after_loss = [item for item, foreground in api.inputs if not foreground]
        self.assertEqual(len(after_loss), 1); self.assertEqual(after_loss[0].mi.dwFlags, bridge.LEFTUP)
        self.assertEqual(api.inputs[-1][0].mi.dwFlags, bridge.LEFTUP)

    def test_scroll_without_position_cannot_target_other_window_under_cursor(self):
        api, worker = self.make(); api.position = (1500, 900)
        with self.assertRaises(bridge.BridgeError):
            worker.handle({"command": "execute", "action": {"type": "scroll", "amount": -1}})
        self.assertEqual(api.inputs, [])
        result = worker.handle({"command": "execute", "action": {"type": "scroll", "amount": -1, "x": 500, "y": 500}})
        self.assertTrue(result["ok"])
        self.assertEqual(api.inputs[-1][0].mi.mouseData, (-120) & 0xFFFFFFFF)

    def test_wait_is_bounded_and_wakes_on_focus_change_without_sending_input(self):
        api, worker = self.make()
        api.after_sleep = lambda: setattr(api, "window", replace(api.window, foreground=False))
        with self.assertRaises(bridge.BridgeError):
            worker.handle({"command": "execute", "action": {"type": "wait", "seconds": 3}})
        self.assertLessEqual(api.elapsed, 0.05); self.assertEqual(api.inputs, [])

    def test_emergency_release_needs_no_game_focus_and_contains_only_keyup(self):
        api, worker = self.make(); api.window = replace(api.window, foreground=False)
        self.assertTrue(worker.handle({"command": "release"})["ok"])
        self.assertEqual(api.enumerations, 0); self.assertEqual(api.captures, 0)
        for item, _ in api.inputs:
            if item.type == 1:
                self.assertTrue(item.ki.dwFlags & bridge.KEYUP)
            else:
                self.assertIn(item.mi.dwFlags, (bridge.LEFTUP, bridge.RIGHTUP, bridge.MIDDLEUP))

    def test_explicit_focus_requires_exact_game_path_and_sends_no_input(self):
        api, worker = self.make(); api.window = replace(api.window, foreground=False, minimized=True)
        for game_path in (None, '', r'D:\Games\notepad.exe', 'stellaris.exe'):
            with self.assertRaises(bridge.BridgeError):
                worker.handle({"command": "focus", "gamePath": game_path})
        self.assertEqual(api.enumerations, 0); self.assertEqual(api.focus_calls, [])
        with self.assertRaises(bridge.BridgeError):
            worker.handle({"command": "focus", "gamePath": r'D:\OtherGame\stellaris.exe'})
        self.assertEqual(api.focus_calls, [])
        result = worker.handle({"command": "focus", "gamePath": api.window.path})
        self.assertTrue(result["ok"]); self.assertEqual(result["windowId"], api.window.identity)
        self.assertTrue(result["window"]["foreground"]); self.assertFalse(result["window"]["minimized"])
        self.assertEqual(len(api.focus_calls), 1); self.assertEqual(api.inputs, []); self.assertEqual(api.captures, 0)

    def test_ambiguous_focus_requires_window_identity_and_does_not_choose_another_process(self):
        api, worker = self.make(); api.window = replace(api.window, foreground=False)
        api.extra_windows = [replace(api.window, hwnd=99, pid=99)]
        with self.assertRaises(bridge.BridgeError):
            worker.handle({"command": "focus", "gamePath": api.window.path})
        self.assertEqual(api.focus_calls, [])
        result = worker.handle({"command": "focus", "gamePath": api.window.path, "windowId": api.window.identity})
        self.assertTrue(result["ok"]); self.assertEqual(len(api.focus_calls), 1)
        self.assertEqual(api.inputs, [])

    def test_focus_denial_or_identity_change_never_reports_success(self):
        api, worker = self.make(); api.window = replace(api.window, foreground=False); api.focus_allowed = False
        with self.assertRaisesRegex(bridge.BridgeError, "Windows 未允许"):
            worker.handle({"command": "focus", "gamePath": api.window.path})
        api.focus_allowed = True
        api.after_focus = lambda: setattr(api, "window", replace(api.window, created=777))
        with self.assertRaisesRegex(bridge.BridgeError, "身份发生变化"):
            worker.handle({"command": "focus", "gamePath": api.window.path})
        self.assertEqual(api.inputs, []); self.assertEqual(api.captures, 0)

    def test_observe_and_execute_never_focus_after_user_switches_away(self):
        api, worker = self.make(); api.window = replace(api.window, foreground=False)
        for command in ("observe", "execute"):
            with self.assertRaises(bridge.BridgeError):
                worker.handle({"command": command, "gamePath": api.window.path, "action": {"type": "click", "x": 500, "y": 500}})
        self.assertEqual(api.focus_calls, []); self.assertEqual(api.inputs, []); self.assertEqual(api.captures, 0)

    def test_native_focus_uses_restore_only_when_minimized_and_rechecks_actual_foreground(self):
        # Exercise the native focus method against fake function bindings. No
        # NativeWin32 constructor or Windows DLL is loaded by this test.
        state = {"window": self.make()[0].window, "calls": []}
        native = bridge.NativeWin32.__new__(bridge.NativeWin32)
        native.inspect = lambda hwnd, game_path: state["window"]
        def restore(hwnd, command):
            state["calls"].append(("ShowWindow", hwnd, command))
            state["window"] = replace(state["window"], minimized=False)
            return False  # Previous visibility is not an activation result.
        def activate(hwnd):
            state["calls"].append(("SetForegroundWindow", hwnd))
            state["window"] = replace(state["window"], foreground=True)
            return True
        native.user = SimpleNamespace(ShowWindow=restore, SetForegroundWindow=activate)
        state["window"] = replace(state["window"], minimized=True, foreground=False)
        baseline = state["window"]
        self.assertTrue(native.focus(baseline, baseline.path).foreground)
        self.assertEqual([call[0] for call in state["calls"]], ["ShowWindow", "SetForegroundWindow"])
        self.assertEqual(state["calls"][0][-1], 9)
        state["calls"].clear(); native.focus(state["window"], baseline.path)
        self.assertEqual([call[0] for call in state["calls"]], ["SetForegroundWindow"])
        state["window"] = replace(state["window"], foreground=False)
        native.user.SetForegroundWindow = lambda hwnd: True  # A true API return alone is insufficient.
        with self.assertRaisesRegex(bridge.BridgeError, "Windows 未允许"):
            native.focus(state["window"], baseline.path)


class PreviewTests(unittest.TestCase):
    def test_preview_retains_aspect_ratio_and_rgb_color_order(self):
        pixels = bytes([0, 0, 255, 0]) * 320 + bytes([255, 0, 0, 0]) * 320
        source = bridge.encode_png(640, 4, pixels * 4)
        width, height, preview = bridge.make_preview(source, 320)
        self.assertEqual((width, height), (320, 2))
        offset, chunks = 8, []
        while offset + 12 <= len(preview):
            length = struct.unpack('>I', preview[offset:offset + 4])[0]
            if preview[offset + 4:offset + 8] == b'IDAT':
                chunks.append(preview[offset + 8:offset + 8 + length])
            offset += length + 12
        raw = zlib.decompress(b''.join(chunks))
        self.assertEqual(raw[1:4], bytes([255, 0, 0]))
        self.assertEqual(raw[1 + 160 * 3:4 + 160 * 3], bytes([0, 0, 255]))

    def test_preview_rejects_oversized_dimensions_and_invalid_payload(self):
        source = bridge.encode_png(640, 4, bytes(640 * 4 * 4))
        for width in (True, 0, 8192, 320.5):
            with self.assertRaises(bridge.BridgeError):
                bridge.make_preview(source, width)
        with self.assertRaises(bridge.BridgeError):
            bridge.make_preview(b'bad-image', 320)


if __name__ == "__main__":
    unittest.main()
