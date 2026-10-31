"""Bounded Stellaris-only Win32 bridge; stdlib only, one JSON request per process.

Focus activation is available only through the explicit focus command, bound to
an exact executable path. Observe/execute never activate a window. No console
commands, game-memory access or persistent hooks. Importing this module and the
offline tests do not enumerate, capture or send desktop input.
"""
from __future__ import annotations

import base64
import ctypes as C
import hashlib
import json
import math
import ntpath
import re
import struct
import sys
import time
import zlib
from dataclasses import dataclass

DWORD, WORD, LONG, UINT, BOOL = C.c_uint32, C.c_uint16, C.c_int32, C.c_uint32, C.c_int32
HANDLE, ULONG_PTR = C.c_void_p, C.c_size_t
MAX_REQUEST = 32768
MAX_PIXELS = 16_777_216
MOVE, ABSOLUTE, VIRTUALDESK = 0x0001, 0x8000, 0x4000
LEFTDOWN, LEFTUP, RIGHTDOWN, RIGHTUP, MIDDLEDOWN, MIDDLEUP, WHEEL = 2, 4, 8, 16, 32, 64, 0x800
KEYUP, SCANCODE, EXTENDEDKEY = 2, 8, 1
BUTTONS = {"left": (LEFTDOWN, LEFTUP), "right": (RIGHTDOWN, RIGHTUP), "middle": (MIDDLEDOWN, MIDDLEUP)}


class BridgeError(Exception):
    pass


class POINT(C.Structure):
    _fields_ = [("x", LONG), ("y", LONG)]


class RECT(C.Structure):
    _fields_ = [("left", LONG), ("top", LONG), ("right", LONG), ("bottom", LONG)]


class FILETIME(C.Structure):
    _fields_ = [("low", DWORD), ("high", DWORD)]


class MOUSEINPUT(C.Structure):
    _fields_ = [("dx", LONG), ("dy", LONG), ("mouseData", DWORD), ("dwFlags", DWORD), ("time", DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(C.Structure):
    _fields_ = [("wVk", WORD), ("wScan", WORD), ("dwFlags", DWORD), ("time", DWORD), ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(C.Structure):
    _fields_ = [("uMsg", DWORD), ("wParamL", WORD), ("wParamH", WORD)]


class INPUTUNION(C.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(C.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", DWORD), ("u", INPUTUNION)]


class BITMAPINFOHEADER(C.Structure):
    _fields_ = [("biSize", DWORD), ("biWidth", LONG), ("biHeight", LONG), ("biPlanes", WORD), ("biBitCount", WORD), ("biCompression", DWORD), ("biSizeImage", DWORD), ("biXPelsPerMeter", LONG), ("biYPelsPerMeter", LONG), ("biClrUsed", DWORD), ("biClrImportant", DWORD)]


class BITMAPINFO(C.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", DWORD * 3)]


def finite(value, name, minimum, maximum, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= value <= maximum or not math.isfinite(value) or integer and int(value) != value:
        raise BridgeError(f"{name}必须是{minimum}至{maximum}之间的{'整数' if integer else '有限数值'}。")
    return int(value) if integer else value


def canonical_game_path(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str) or len(value) > 32767 or "\x00" in value or not ntpath.isabs(value) or ntpath.basename(value).lower() != "stellaris.exe":
        raise BridgeError("游戏路径必须是 stellaris.exe 的完整路径。")
    return ntpath.normcase(ntpath.normpath(value.removeprefix("\\\\?\\")))


# Game interaction keys only. In particular: no OEM3/console, Windows/Alt,
# function keys used for saving/loading, or arbitrary modifier combinations.
KEYS = {chr(value): value for value in range(ord("A"), ord("Z") + 1)}
KEYS.update({str(value): ord(str(value)) for value in range(10)})
KEYS.update({"SPACE": 0x20, "ESC": 0x1B, "ENTER": 0x0D, "TAB": 9, "BACKSPACE": 8,
             "LEFT": 0x25, "UP": 0x26, "RIGHT": 0x27, "DOWN": 0x28, "HOME": 0x24, "END": 0x23,
             "PAGEUP": 0x21, "PAGEDOWN": 0x22, "PLUS": 0x6B, "MINUS": 0x6D,
             "F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73, "F6": 0x75, "F7": 0x76, "F8": 0x77, "F10": 0x79})
ALIASES = {"ESCAPE": "ESC", "RETURN": "ENTER", "SPACEBAR": "SPACE", "ARROWLEFT": "LEFT", "ARROWRIGHT": "RIGHT", "ARROWUP": "UP", "ARROWDOWN": "DOWN"}


def parse_key(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 32:
        raise BridgeError("按键格式无效。")
    key = ALIASES.get(value.strip().upper(), value.strip().upper())
    if key in KEYS:
        return [KEYS[key]]
    # These combinations assign/select game control groups. Save/load, desktop
    # shortcuts and general-purpose CTRL combinations are deliberately absent.
    if re.fullmatch(r"CTRL\+[0-9]", key):
        return [0x11, ord(key[-1])]
    if re.fullmatch(r"SHIFT\+[0-9]", key):
        return [0x10, ord(key[-1])]
    raise BridgeError("该按键不在游戏白名单内；控制台、保存、加载及系统组合键不可执行。")


def validate_action(value):
    if not isinstance(value, dict):
        raise BridgeError("游戏动作必须是对象。")
    action = dict(value)
    kind = action.get("type")
    if kind == "click":
        finite(action.get("x"), "横坐标", 0, 1000); finite(action.get("y"), "纵坐标", 0, 1000)
        if not isinstance(action.get("button", "left"), str) or action.get("button", "left") not in BUTTONS:
            raise BridgeError("只支持左键、右键或中键。")
        action["count"] = finite(action.get("count", 1), "点击次数", 1, 2, integer=True)
    elif kind == "key":
        parse_key(action.get("key"))
    elif kind == "scroll":
        action["amount"] = finite(action.get("amount"), "滚动格数", -10, 10, integer=True)
        if ("x" in action) != ("y" in action):
            raise BridgeError("滚动位置必须同时提供横纵坐标。")
        if "x" in action:
            finite(action["x"], "横坐标", 0, 1000); finite(action["y"], "纵坐标", 0, 1000)
    elif kind == "drag":
        for key in ("fromX", "fromY", "toX", "toY"):
            finite(action.get(key), "拖动坐标", 0, 1000)
        if not isinstance(action.get("button", "left"), str) or action.get("button", "left") not in BUTTONS:
            raise BridgeError("只支持左键、右键或中键拖动。")
    elif kind == "wait":
        finite(action.get("seconds"), "等待秒数", 0, 3)
    else:
        raise BridgeError("不支持这种游戏动作。")
    return action


def mouse_input(flags, data=0, x=0, y=0):
    result = INPUT(); result.type = 0
    result.mi = MOUSEINPUT(x, y, data & 0xFFFFFFFF, flags, 0, 0)
    return result


def keyboard_input(scan, up=False):
    result = INPUT(); result.type = 1
    result.ki = KEYBDINPUT(0, scan & 0xFF, SCANCODE | (EXTENDEDKEY if scan & 0xFF00 == 0xE000 else 0) | (KEYUP if up else 0), 0, 0)
    return result


def encode_png(width, height, bgra):
    """Encode a top-down 32bpp Windows DIB as RGB PNG; ignore undefined alpha."""
    if isinstance(width, bool) or isinstance(height, bool) or not isinstance(width, int) or not isinstance(height, int) or not 1 <= width <= 8192 or not 1 <= height <= 8192 or width * height > MAX_PIXELS or len(bgra) != width * height * 4:
        raise BridgeError("截图尺寸或像素数据无效。")
    rgb = bytearray(width * height * 3)
    rgb[0::3] = bgra[2::4]; rgb[1::3] = bgra[1::4]; rgb[2::3] = bgra[0::4]
    compressor = zlib.compressobj(3)
    compressed = []
    row_size = width * 3
    for row in range(height):
        compressed.append(compressor.compress(b"\0" + rgb[row * row_size:(row + 1) * row_size]))
    compressed.append(compressor.flush())
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", b"".join(compressed)) + chunk(b"IEND", b"")


def make_preview(png, target_width):
    """Downsample our own unfiltered RGB PNG for the remote visual model.

    The original stays untouched for OCR/evidence. Coordinates remain 0..1000.
    Only PNGs produced by encode_png are accepted, no general image decoder.
    """
    finite(target_width, "模型预览宽度", 320, 1920, integer=True)
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        raise BridgeError("模型预览图片无效。")
    width, height, depth, color = struct.unpack(">IIBB", png[16:26])
    if depth != 8 or color != 2 or width * height > MAX_PIXELS:
        raise BridgeError("模型预览像素格式无效。")
    if width <= target_width:
        return width, height, png
    compressed, offset = [], 8
    while offset + 12 <= len(png):
        length = struct.unpack(">I", png[offset:offset + 4])[0]
        kind = png[offset + 4:offset + 8]
        if offset + 12 + length > len(png):
            raise BridgeError("模型预览PNG长度无效。")
        if kind == b"IDAT":
            compressed.append(png[offset + 8:offset + 8 + length])
        offset += length + 12
    decoder = zlib.decompressobj()
    expected = (width * 3 + 1) * height
    rgb = decoder.decompress(b"".join(compressed), expected + 1)
    if len(rgb) != expected or not decoder.eof:
        raise BridgeError("模型预览PNG解码失败。")
    target_height = max(1, round(height * target_width / width))
    output = bytearray(target_width * target_height * 4)
    stride = width * 3 + 1
    step = width // target_width if width % target_width == 0 else None
    for y in range(target_height):
        row_at = min(height - 1, y * height // target_height) * stride
        if rgb[row_at] != 0:
            raise BridgeError("模型预览只支持本地无滤镜PNG。")
        row = rgb[row_at + 1:row_at + stride]
        start, end = y * target_width * 4, (y + 1) * target_width * 4
        if step:
            output[start:end:4] = row[2::3 * step]
            output[start + 1:end:4] = row[1::3 * step]
            output[start + 2:end:4] = row[0::3 * step]
        else:
            for x in range(target_width):
                source = min(width - 1, x * width // target_width) * 3
                pixel = start + x * 4
                output[pixel:pixel + 3] = row[source:source + 3][::-1]
    return target_width, target_height, encode_png(target_width, target_height, output)


def validate_capture_pixels(bgra):
    """Reject loading/capture blanks even when the cursor adds a few pixels.

    Count complete RGB triples rather than separate channel totals, and inspect
    all pixels so a sampling grid cannot miss sparse star-map details. Near-white
    RGB >= 250 must occupy 99.5%; the dark check deliberately counts only exact
    RGB zero at the stricter 99.9%, preserving low-intensity deep-space scenes.
    DIB alpha remains entirely ignored.
    """
    if not bgra or len(bgra) % 4:
        raise BridgeError("游戏截图像素不完整，请重新观察。")
    pixels = len(bgra) // 4
    white = black = 0
    for blue, green, red in zip(bgra[0::4], bgra[1::4], bgra[2::4]):
        if blue >= 250 and green >= 250 and red >= 250:
            white += 1
        elif blue == 0 and green == 0 and red == 0:
            black += 1
    if white * 1000 >= pixels * 995 or black * 1000 >= pixels * 999:
        raise BridgeError("游戏仍在加载或未取得有效画面，暂不操作；请等待画面正常后重新观察。")


@dataclass(frozen=True)
class Window:
    hwnd: int; pid: int; created: int; path: str; title: str
    left: int; top: int; width: int; height: int; foreground: bool; minimized: bool

    @property
    def identity(self):
        return f"{self.hwnd}:{self.pid}:{self.created}"

    def public(self):
        return {"windowId": self.identity, "hwnd": str(self.hwnd), "pid": self.pid, "processCreatedAt": str(self.created), "executable": self.path,
                "title": self.title, "x": self.left, "y": self.top, "width": self.width, "height": self.height,
                "foreground": self.foreground, "minimized": self.minimized}


class NativeWin32:
    def __init__(self):
        if sys.platform != "win32" or C.sizeof(C.c_void_p) != 8:
            raise BridgeError("游戏窗口桥需要 Windows 和64位 Python。")
        self.user = C.WinDLL("user32", use_last_error=True)
        self.kernel = C.WinDLL("kernel32", use_last_error=True)
        self.gdi = C.WinDLL("gdi32", use_last_error=True)
        self.enum_callback = C.WINFUNCTYPE(BOOL, HANDLE, C.c_ssize_t)
        signatures = [
            (self.user, "EnumWindows", [self.enum_callback, C.c_ssize_t], BOOL),
            (self.user, "IsWindow", [HANDLE], BOOL), (self.user, "IsWindowVisible", [HANDLE], BOOL), (self.user, "IsIconic", [HANDLE], BOOL),
            (self.user, "GetForegroundWindow", [], HANDLE), (self.user, "GetWindowThreadProcessId", [HANDLE, C.POINTER(DWORD)], DWORD),
            (self.user, "ShowWindow", [HANDLE, C.c_int], BOOL), (self.user, "SetForegroundWindow", [HANDLE], BOOL),
            (self.user, "GetWindowTextW", [HANDLE, C.c_wchar_p, C.c_int], C.c_int),
            (self.user, "GetClientRect", [HANDLE, C.POINTER(RECT)], BOOL), (self.user, "ClientToScreen", [HANDLE, C.POINTER(POINT)], BOOL),
            (self.user, "GetCursorPos", [C.POINTER(POINT)], BOOL), (self.user, "GetSystemMetrics", [C.c_int], C.c_int),
            (self.user, "SendInput", [UINT, C.POINTER(INPUT), C.c_int], UINT), (self.user, "MapVirtualKeyW", [UINT, UINT], UINT),
            (self.user, "GetDC", [HANDLE], HANDLE), (self.user, "ReleaseDC", [HANDLE, HANDLE], C.c_int),
            (self.kernel, "OpenProcess", [DWORD, BOOL, DWORD], HANDLE), (self.kernel, "CloseHandle", [HANDLE], BOOL),
            (self.kernel, "QueryFullProcessImageNameW", [HANDLE, DWORD, C.c_wchar_p, C.POINTER(DWORD)], BOOL),
            (self.kernel, "GetProcessTimes", [HANDLE, C.POINTER(FILETIME), C.POINTER(FILETIME), C.POINTER(FILETIME), C.POINTER(FILETIME)], BOOL),
            (self.gdi, "CreateCompatibleDC", [HANDLE], HANDLE), (self.gdi, "CreateCompatibleBitmap", [HANDLE, C.c_int, C.c_int], HANDLE),
            (self.gdi, "SelectObject", [HANDLE, HANDLE], HANDLE), (self.gdi, "DeleteObject", [HANDLE], BOOL), (self.gdi, "DeleteDC", [HANDLE], BOOL),
            (self.gdi, "BitBlt", [HANDLE, C.c_int, C.c_int, C.c_int, C.c_int, HANDLE, C.c_int, C.c_int, DWORD], BOOL),
            (self.gdi, "GetDIBits", [HANDLE, HANDLE, UINT, UINT, C.c_void_p, C.POINTER(BITMAPINFO), UINT], C.c_int),
        ]
        for dll, name, arguments, result in signatures:
            function = getattr(dll, name); function.argtypes = arguments; function.restype = result
        if hasattr(self.user, "SetThreadDpiAwarenessContext"):
            function = self.user.SetThreadDpiAwarenessContext; function.argtypes = [HANDLE]; function.restype = HANDLE
            if not function(C.c_void_p(-4)):
                raise BridgeError("无法启用准确的游戏窗口 DPI 坐标。")
        else:
            raise BridgeError("游戏窗口桥需要支持每显示器 DPI 的 Windows。")

    def inspect(self, hwnd, game_path):
        if not self.user.IsWindow(hwnd) or not self.user.IsWindowVisible(hwnd):
            raise BridgeError("游戏窗口已关闭或不可见。")
        pid = DWORD()
        if not self.user.GetWindowThreadProcessId(hwnd, C.byref(pid)):
            raise BridgeError("无法确认游戏窗口进程。")
        process = self.kernel.OpenProcess(0x1000, False, pid.value)
        if not process:
            raise BridgeError("无法读取游戏进程身份。")
        try:
            path = C.create_unicode_buffer(32768); length = DWORD(len(path))
            if not self.kernel.QueryFullProcessImageNameW(process, 0, path, C.byref(length)):
                raise BridgeError("无法确认游戏程序路径。")
            normalized = ntpath.normcase(ntpath.normpath(path.value.removeprefix("\\\\?\\")))
            if ntpath.basename(normalized) != "stellaris.exe" or game_path and normalized != game_path:
                raise BridgeError("目标窗口不是指定的群星游戏进程。")
            created, exited, kernel, user = FILETIME(), FILETIME(), FILETIME(), FILETIME()
            if not self.kernel.GetProcessTimes(process, C.byref(created), C.byref(exited), C.byref(kernel), C.byref(user)):
                raise BridgeError("无法确认游戏进程创建时间。")
            timestamp = (created.high << 32) | created.low
        finally:
            self.kernel.CloseHandle(process)
        rect, origin = RECT(), POINT(0, 0)
        if not self.user.GetClientRect(hwnd, C.byref(rect)) or not self.user.ClientToScreen(hwnd, C.byref(origin)):
            raise BridgeError("无法读取游戏客户区。")
        title = C.create_unicode_buffer(512); self.user.GetWindowTextW(hwnd, title, len(title))
        return Window(hwnd, pid.value, timestamp, path.value, title.value, origin.x, origin.y, rect.right - rect.left, rect.bottom - rect.top,
                      self.user.GetForegroundWindow() == hwnd, bool(self.user.IsIconic(hwnd)))

    def list_windows(self, game_path):
        windows = []
        def visit(hwnd, _):
            try:
                window = self.inspect(hwnd, game_path)
                if len(windows) < 32:
                    windows.append(window)
            except BridgeError:
                pass
            return True
        callback = self.enum_callback(visit)
        if not self.user.EnumWindows(callback, 0):
            raise BridgeError("无法列出游戏窗口。")
        return windows

    def desktop_rect(self):
        return tuple(self.user.GetSystemMetrics(metric) for metric in (76, 77, 78, 79))

    def focus(self, window, game_path):
        # Standard Windows activation only. No synthetic Alt keys, thread-input
        # attachment, foreground lock changes, or retries against other windows.
        current = self.inspect(window.hwnd, game_path)
        if current.identity != window.identity:
            raise BridgeError("游戏窗口身份已变化，未尝试激活。")
        if current.minimized:
            self.user.ShowWindow(window.hwnd, 9)  # SW_RESTORE; return value is previous visibility, not success.
            current = self.inspect(window.hwnd, game_path)
            if current.identity != window.identity:
                raise BridgeError("游戏窗口身份在恢复时发生变化，未继续激活。")
        self.user.SetForegroundWindow(window.hwnd)
        current = self.inspect(window.hwnd, game_path)
        if current.identity != window.identity:
            raise BridgeError("游戏窗口身份在激活时发生变化，操作已停止。")
        if current.minimized or not current.foreground:
            raise BridgeError("Windows 未允许将指定群星窗口置于前台；请手动切到群星后重试。")
        return current

    def cursor(self):
        point = POINT()
        if not self.user.GetCursorPos(C.byref(point)):
            raise BridgeError("无法读取鼠标位置。")
        return point.x, point.y

    def scan(self, vk):
        scan = self.user.MapVirtualKeyW(vk, 4)
        if not scan:
            raise BridgeError("该按键无法映射到游戏键盘。")
        return scan

    def send(self, inputs):
        array = (INPUT * len(inputs))(*inputs)
        return self.user.SendInput(len(inputs), array, C.sizeof(INPUT))

    def capture(self, window):
        screen = self.user.GetDC(None)
        if not screen:
            raise BridgeError("无法取得屏幕截图设备。")
        memory = bitmap = previous = None
        selected = False
        try:
            memory = self.gdi.CreateCompatibleDC(screen); bitmap = self.gdi.CreateCompatibleBitmap(screen, window.width, window.height)
            if not memory or not bitmap:
                raise BridgeError("无法创建游戏截图缓冲。")
            previous = self.gdi.SelectObject(memory, bitmap)
            if not previous or previous == C.c_void_p(-1).value:
                raise BridgeError("无法选择游戏截图缓冲。")
            selected = True
            if not self.gdi.BitBlt(memory, 0, 0, window.width, window.height, screen, window.left, window.top, 0x00CC0020 | 0x40000000):
                raise BridgeError("游戏客户区截图失败。")
            self.gdi.SelectObject(memory, previous); selected = False
            info = BITMAPINFO(); info.bmiHeader = BITMAPINFOHEADER(40, window.width, -window.height, 1, 32, 0, window.width * window.height * 4, 0, 0, 0, 0)
            pixels = C.create_string_buffer(window.width * window.height * 4)
            if self.gdi.GetDIBits(memory, bitmap, 0, window.height, pixels, C.byref(info), 0) != window.height:
                raise BridgeError("无法读取完整游戏截图像素。")
            validate_capture_pixels(pixels.raw)
            return encode_png(window.width, window.height, pixels.raw)
        finally:
            if selected:
                self.gdi.SelectObject(memory, previous)
            if bitmap:
                self.gdi.DeleteObject(bitmap)
            if memory:
                self.gdi.DeleteDC(memory)
            self.user.ReleaseDC(None, screen)


class Bridge:
    def __init__(self, api, sleep=time.sleep, now=lambda: int(time.time() * 1000)):
        self.api, self.sleep, self.now = api, sleep, now

    def emit(self, inputs):
        if self.api.send(inputs) != len(inputs):
            raise BridgeError("系统未完整接受游戏输入，已尝试释放按键。")

    def release(self):
        # Emergency cleanup contains no keydown, pointer motion, focus or capture.
        keys = sorted(set(KEYS.values()) | {0x10, 0x11})
        self.emit([keyboard_input(self.api.scan(key), True) for key in keys] + [mouse_input(up) for _, up in BUTTONS.values()])
        return {"ok": True, "at": self.now(), "message": "已发送游戏白名单按键和鼠标释放。"}

    def handle(self, request):
        if not isinstance(request, dict):
            raise BridgeError("请求必须是 JSON 对象。")
        command = request.get("command")
        if command == "release":
            return self.release()
        if command not in ("doctor", "list", "observe", "execute", "focus"):
            raise BridgeError("不支持这种游戏桥命令。")
        game_path = canonical_game_path(request.get("gamePath"))
        if command == "focus" and not game_path:
            raise BridgeError("显式激活游戏必须提供 stellaris.exe 的精确完整路径。")
        action = validate_action(request.get("action")) if command == "execute" else None
        windows = self.api.list_windows(game_path)
        if command in ("doctor", "list"):
            return {"ok": True, "at": self.now(), "windows": [window.public() for window in windows], "message": "已列出群星窗口；尚未截图或发送输入。"}
        expected = request.get("windowId", request.get("expectedWindow"))
        if isinstance(expected, dict):
            expected = expected.get("windowId")
        if expected is not None and (not isinstance(expected, str) or not re.fullmatch(r"\d+:\d+:\d+", expected)):
            raise BridgeError("游戏窗口身份无效，请重新观察。")
        candidates = [window for window in windows if window.identity == expected] if expected else windows if command == "focus" else [window for window in windows if window.foreground]
        if len(candidates) != 1:
            raise BridgeError("未找到唯一的目标游戏窗口，请手动将群星切到前台后重试。")
        baseline = candidates[0]
        if command == "focus":
            if canonical_game_path(baseline.path) != game_path:
                raise BridgeError("待激活窗口不属于指定的 stellaris.exe，未尝试激活。")
            self.api.focus(baseline, game_path)
            window = self.api.inspect(baseline.hwnd, game_path)
            if window.identity != baseline.identity or canonical_game_path(window.path) != game_path:
                raise BridgeError("激活后游戏进程身份发生变化，操作已停止。")
            if window.minimized or not window.foreground:
                raise BridgeError("Windows 未允许将指定群星窗口置于前台；请手动切到群星后重试。")
            return {"ok": True, "at": self.now(), "windowId": window.identity, "window": window.public(), "message": "已按显式启动请求激活指定群星窗口；没有发送键鼠输入。"}
        expected_width = request.get("expectedWidth", baseline.width); expected_height = request.get("expectedHeight", baseline.height)
        finite(expected_width, "预期窗口宽度", 1, 8192, integer=True); finite(expected_height, "预期窗口高度", 1, 8192, integer=True)

        def guard():
            window = self.api.inspect(baseline.hwnd, game_path)
            if window.identity != baseline.identity:
                raise BridgeError("游戏窗口身份已变化，请重新观察。")
            if not window.foreground or window.minimized:
                raise BridgeError("群星已失去前台或被最小化，操作已停止。")
            if window.width != expected_width or window.height != expected_height:
                raise BridgeError("游戏客户区尺寸已变化，请重新观察。")
            if window.width * window.height > MAX_PIXELS:
                raise BridgeError("游戏截图尺寸超过上限。")
            left, top, width, height = self.api.desktop_rect()
            if width < 2 or height < 2 or window.left < left or window.top < top or window.left + window.width > left + width or window.top + window.height > top + height:
                raise BridgeError("游戏客户区未完整显示在屏幕内。")
            return window

        window = guard()
        if command == "observe":
            png = self.api.capture(window); guard()
            result = {"ok": True, "id": hashlib.sha256(png).hexdigest(), "at": self.now(), "windowId": window.identity,
                    "window": window.public(), "width": window.width, "height": window.height, "imageBase64": base64.b64encode(png).decode("ascii"), "mimeType": "image/png"}
            if request.get("previewWidth") is not None:
                preview_width, preview_height, preview = make_preview(png, request["previewWidth"])
                result["modelImage"] = {"width": preview_width, "height": preview_height, "imageBase64": base64.b64encode(preview).decode("ascii"), "mimeType": "image/png"}
            return result

        def move(x, y):
            current = guard()
            px = current.left + round(x / 1000 * (current.width - 1)); py = current.top + round(y / 1000 * (current.height - 1))
            left, top, width, height = self.api.desktop_rect()
            self.emit([mouse_input(MOVE | ABSOLUTE | VIRTUALDESK, x=round((px - left) * 65535 / (width - 1)), y=round((py - top) * 65535 / (height - 1)))])

        kind = action["type"]
        if kind == "key":
            scans = [self.api.scan(key) for key in parse_key(action["key"])]
            guard()
            try:
                self.emit([keyboard_input(scan) for scan in scans]); self.sleep(0.04)
            finally:
                self.emit([keyboard_input(scan, True) for scan in reversed(scans)])
        elif kind == "click":
            down, up = BUTTONS[action.get("button", "left")]
            for _ in range(action.get("count", 1)):
                move(action["x"], action["y"])
                # Let the game process cursor motion before the button event;
                # otherwise low-FPS frames can hit-test the previous position.
                self.sleep(0.06); guard()
                try:
                    self.emit([mouse_input(down)]); self.sleep(0.035)
                finally:
                    self.emit([mouse_input(up)])
                guard()
            if request.get("parkCursor") is True and action.get("button", "left") == "left":
                self.sleep(0.06); guard(); move(650, 850)
        elif kind == "scroll":
            if "x" in action:
                move(action["x"], action["y"])
            current = guard(); x, y = self.api.cursor()
            if not current.left <= x < current.left + current.width or not current.top <= y < current.top + current.height:
                raise BridgeError("鼠标不在游戏客户区内，未发送滚动。")
            if action["amount"]:
                self.emit([mouse_input(WHEEL, action["amount"] * 120)])
        elif kind == "drag":
            down, up = BUTTONS[action.get("button", "left")]
            move(action["fromX"], action["fromY"]); guard()
            try:
                self.emit([mouse_input(down)])
                for step in range(1, 17):
                    self.sleep(0.04)
                    fraction = step / 16
                    move(action["fromX"] + (action["toX"] - action["fromX"]) * fraction, action["fromY"] + (action["toY"] - action["fromY"]) * fraction)
            finally:
                self.emit([mouse_input(up)])
        elif kind == "wait":
            remaining = action["seconds"]
            while remaining > 0:
                delay = min(remaining, 0.05); self.sleep(delay); remaining -= delay; guard()
        guard()
        return {"ok": True, "at": self.now(), "windowId": window.identity, "window": window.public(), "actionType": kind, "message": "本地游戏动作已执行；游戏内结果仍需下一次观察确认。"}


def read_request(raw):
    if len(raw) > MAX_REQUEST:
        raise BridgeError("游戏桥请求超过32 KiB。")
    try:
        request = json.loads(raw.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError, RecursionError):
        raise BridgeError("游戏桥请求不是有效的 UTF-8 JSON。") from None
    if not isinstance(request, dict):
        raise BridgeError("游戏桥请求必须是 JSON 对象。")
    return request


def main():
    try:
        request = read_request(sys.stdin.buffer.read(MAX_REQUEST + 1))
        result = Bridge(NativeWin32()).handle(request)
    except BridgeError as error:
        result = {"ok": False, "error": str(error), "message": str(error)}
    except Exception:
        result = {"ok": False, "error": "游戏窗口桥执行失败，未继续发送动作。", "message": "游戏窗口桥执行失败，未继续发送动作。"}
    sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
