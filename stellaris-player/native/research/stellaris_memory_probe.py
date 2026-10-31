# SPDX-License-Identifier: GPL-3.0-only
"""Read-only, exact-build Stellaris research probe; never submits game actions.

PDX database layout and 4.5.2 Windows profile: V2t-Nostalgia/OGAS,
commit 0c402a226c835d3d31eefbe2a168283517549373. See README.md.
No scanning, WriteProcessMemory, injected code, screenshots or input emulation.
Fleet IDs are seeded by the separate player's-save observer. That seed does
not establish current-world identity or current ownership on its own.
"""
from __future__ import annotations

import ctypes as C
import hashlib
import json
import ntpath
from pathlib import Path
import struct
import sys
import time

BUILD_SHA256 = "400df27c82ddc845aa9dce79bd468d81f18f060d299cd263e3afa93aef4f7a83"
PROFILE = "stellaris-4.5.2-windows-steam-25664273"
IMAGE_SIZE = 0x37F2000
ANCHORS = (
    (0x332EF0, "488bc48850105553565741544155"),
    (0x5F88A0, "48895c240848896c2410488974241857"),
    (0xA56E40, "48895c240848897424105748"),
    (0x86DC40, "48895c240848896c24104889"),
    (0x91D520, "b8552c0000c3"),
)
FLEET_DATABASE, NULL_FLEET = 0x31129D8, 0x3112EB8
COORDINATE_VTABLE = 0x2344DF0


class ProbeError(Exception):
    pass


def number(memory, address, fmt="<Q"):
    return struct.unpack(fmt, memory.read(address, struct.calcsize(fmt)))[0]


def resolve_fleet(memory, base, fleet_id):
    database = number(memory, base + FLEET_DATABASE)
    if not database:
        raise ProbeError("fleet_database_unavailable")
    count = number(memory, database + 0x20, "<I")
    index = fleet_id & 0xFFFFFF
    if count > 1000000 or index >= count:
        return None
    entries = number(memory, database + 0x18)
    if not entries:
        return None
    fleet = number(memory, entries + index * 0x10 + 8)
    if not fleet or fleet == number(memory, base + NULL_FLEET):
        return None
    # Validate the whole handle, including generation bits, before reading it.
    return fleet if number(memory, fleet + 0x30, "<I") == fleet_id else None


def coordinate_getter(memory, base, function, provider):
    """Recognize a few pure pointer getters without running game code.

    Any other instruction stops this probe rather than guessing a field offset.
    """
    rcx = provider
    for _ in range(4):
        if not base + 0x1000 <= function < base + 0x2215690:
            raise ProbeError("getter_outside_verified_text")
        code = memory.read(function, 32)
        cursor = 0
        for _ in range(5):
            rest = code[cursor:]
            if rest.startswith(b"\x48\x83\xe9") or rest.startswith(b"\x48\x83\xc1"):
                delta = struct.unpack("<b", rest[3:4])[0]
                rcx += -delta if rest[2] == 0xE9 else delta
                cursor += 4
            elif rest.startswith(b"\x48\x8d\x41") and rest[4:5] == b"\xc3":
                return rcx + struct.unpack("<b", rest[3:4])[0]
            elif rest.startswith(b"\x48\x8d\x81") and rest[7:8] == b"\xc3":
                return rcx + struct.unpack("<i", rest[3:7])[0]
            elif rest.startswith(b"\x48\x8b\xc1\xc3"):
                return rcx
            elif rest.startswith(b"\xe9"):
                function = function + cursor + 5 + struct.unpack("<i", rest[1:5])[0]
                break
            else:
                raise ProbeError("unsupported_coordinate_getter:" + rest[:16].hex())
        else:
            raise ProbeError("getter_instruction_limit")
    raise ProbeError("getter_jump_limit")


def inspect_fleet(memory, base, fleet_id):
    fleet = resolve_fleet(memory, base, fleet_id)
    if fleet is None:
        return {"id": fleet_id, "resolved": False}
    result = {"id": fleet_id, "resolved": True}
    provider = fleet + 0x38
    vtable = number(memory, provider)
    if not base <= vtable < base + IMAGE_SIZE - 16:
        raise ProbeError("coordinate_provider_vtable_invalid")
    getter = number(memory, vtable + 8)
    try:
        coordinate = coordinate_getter(memory, base, getter, provider)
    except ProbeError as error:
        return {**result, "coordinateStatus": str(error), "getterRva": hex(getter - base)}
    if number(memory, coordinate) != base + COORDINATE_VTABLE:
        raise ProbeError("coordinate_type_mismatch")
    # OGAS's native FTL-command builder verifies the system handle at +0x20.
    result.update(systemId=number(memory, coordinate + 0x20, "<I"), coordinateStatus="live")
    if resolve_fleet(memory, base, fleet_id) != fleet:
        raise ProbeError("fleet_changed_during_read")
    return result


def fleet_ship_ids(memory, base, fleet_id):
    """CFleet::ships from Yidhar/stellaris-mcp 6cc8e820's 4.5.2 SDK.

    LeaderLocation type 2 identifies a CShip, not a CFleet (OGAS leader_actions).
    Initial ship/fleet handles can coincide; newly built ones usually differ.
    """
    fleet = resolve_fleet(memory, base, fleet_id)
    if fleet is None:
        raise ProbeError("fleet_not_found")
    data = number(memory, fleet + 0x320)
    count = number(memory, fleet + 0x32C, "<I")
    if not data or not 1 <= count <= 128:
        raise ProbeError("invalid_fleet_ship_array")
    ids = [number(memory, data + index * 4, "<I") for index in range(count)]
    if resolve_fleet(memory, base, fleet_id) != fleet or number(memory, fleet + 0x320) != data or number(memory, fleet + 0x32C, "<I") != count:
        raise ProbeError("fleet_ship_array_changed_during_read")
    return ids


class ReadOnlyProcess:
    def __init__(self, pid, expected_path):
        if sys.platform != "win32":
            raise ProbeError("windows_required")
        self.kernel = C.WinDLL("kernel32", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [C.c_uint32, C.c_int, C.c_uint32]
        self.kernel.OpenProcess.restype = C.c_void_p
        self.kernel.CloseHandle.argtypes = [C.c_void_p]
        self.kernel.ReadProcessMemory.argtypes = [C.c_void_p, C.c_void_p, C.c_void_p, C.c_size_t, C.POINTER(C.c_size_t)]
        self.kernel.ReadProcessMemory.restype = C.c_int
        self.kernel.QueryFullProcessImageNameW.argtypes = [C.c_void_p, C.c_uint32, C.c_wchar_p, C.POINTER(C.c_uint32)]
        self.kernel.QueryFullProcessImageNameW.restype = C.c_int
        # PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, with no write rights.
        self.handle = self.kernel.OpenProcess(0x1010, False, pid)
        if not self.handle:
            raise ProbeError("cannot_open_readonly_game_process")
        try:
            path = C.create_unicode_buffer(32768)
            length = C.c_uint32(len(path))
            if not self.kernel.QueryFullProcessImageNameW(self.handle, 0, path, C.byref(length)):
                raise ProbeError("cannot_verify_game_process_path")
            if ntpath.normcase(ntpath.normpath(path.value)) != ntpath.normcase(ntpath.normpath(expected_path)):
                raise ProbeError("game_process_path_mismatch")
            self.base = self.module_base(pid)
        except Exception:
            self.close()
            raise

    def module_base(self, pid):
        class Module(C.Structure):
            _fields_ = [("size", C.c_uint32), ("moduleId", C.c_uint32),
                        ("pid", C.c_uint32), ("globalUse", C.c_uint32),
                        ("processUse", C.c_uint32), ("base", C.c_void_p),
                        ("imageSize", C.c_uint32), ("handle", C.c_void_p),
                        ("name", C.c_wchar * 256), ("path", C.c_wchar * 260)]
        self.kernel.CreateToolhelp32Snapshot.argtypes = [C.c_uint32, C.c_uint32]
        self.kernel.CreateToolhelp32Snapshot.restype = C.c_void_p
        self.kernel.Module32FirstW.argtypes = [C.c_void_p, C.POINTER(Module)]
        self.kernel.Module32FirstW.restype = C.c_int
        snapshot = self.kernel.CreateToolhelp32Snapshot(0x18, pid)
        if snapshot in (None, C.c_void_p(-1).value):
            raise ProbeError("module_snapshot_failed")
        try:
            entry = Module()
            entry.size = C.sizeof(Module)
            if not self.kernel.Module32FirstW(snapshot, C.byref(entry)):
                raise ProbeError("main_module_missing")
            if entry.name.lower() != "stellaris.exe" or entry.imageSize != IMAGE_SIZE:
                raise ProbeError("main_module_profile_mismatch")
            return entry.base
        finally:
            self.kernel.CloseHandle(snapshot)

    def read(self, address, size):
        if not isinstance(address, int) or address < 0x10000 or not 1 <= size <= 4096:
            raise ProbeError("invalid_read_range")
        buffer = C.create_string_buffer(size)
        received = C.c_size_t()
        if not self.kernel.ReadProcessMemory(self.handle, address, buffer, size, C.byref(received)) or received.value != size:
            raise ProbeError("game_memory_read_failed")
        return buffer.raw

    def close(self):
        if getattr(self, "handle", None):
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def probe(request):
    started = time.monotonic()
    path, pid, ids = request.get("gamePath"), request.get("pid"), request.get("fleetIds")
    if not isinstance(path, str) or not ntpath.isabs(path) or ntpath.basename(path).lower() != "stellaris.exe":
        raise ProbeError("absolute_game_path_required")
    if type(pid) is not int or not 1 <= pid <= 0xFFFFFFFF:
        raise ProbeError("invalid_pid")
    if not isinstance(ids, list) or not 1 <= len(ids) <= 64 or any(type(x) is not int or not 0 <= x < 0xFFFFFFFF for x in ids):
        raise ProbeError("invalid_fleet_ids")
    with Path(path).open("rb") as binary:
        digest = hashlib.file_digest(binary, "sha256").hexdigest()
    if digest != BUILD_SHA256:
        raise ProbeError("unsupported_game_binary")
    memory = ReadOnlyProcess(pid, path)
    try:
        for rva, prefix in ANCHORS:
            expected = bytes.fromhex(prefix)
            if memory.read(memory.base + rva, len(expected)) != expected:
                raise ProbeError("live_game_function_anchor_mismatch")
        fleets = [inspect_fleet(memory, memory.base, value) for value in dict.fromkeys(ids)]
        if request.get("includeShipIds") is True:
            for fleet in fleets:
                if fleet["resolved"]:
                    fleet["shipIds"] = fleet_ship_ids(memory, memory.base, fleet["id"])
        return {"ok": True, "source": "live-process-readonly", "profile": PROFILE,
                "pid": pid, "atomicSnapshot": False, "actionsEnabled": False,
                "worldAndOwnershipVerified": False, "fleets": fleets,
                "elapsedMs": round((time.monotonic() - started) * 1000)}
    finally:
        memory.close()


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(32769)
        if len(raw) > 32768:
            raise ProbeError("request_too_large")
        response = probe(json.loads(raw))
    except (ProbeError, OSError, ValueError, KeyError, TypeError) as error:
        response = {"ok": False, "error": str(error)}
    print(json.dumps(response, ensure_ascii=True))
