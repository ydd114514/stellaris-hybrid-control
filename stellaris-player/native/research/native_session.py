# SPDX-License-Identifier: GPL-3.0-only
"""Identity and bounded, read-only ship handles for the current bridge process."""
import ctypes as C
import hashlib
import json
import sys
from pathlib import Path
from stellaris_memory_probe import ReadOnlyProcess, ProbeError, BUILD_SHA256, ANCHORS, fleet_ship_ids
from war_state import read_wars,read_war_goal_window
from load_native_bridge import find_module
from planet_jobs_probe import read_planet_jobs, validate_planet_jobs_request

GAME_PATH = "D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe"


class FileTime(C.Structure):
    _fields_ = [("low", C.c_uint32), ("high", C.c_uint32)]


def pipe_server_pid():
    kernel = C.WinDLL("kernel32", use_last_error=True)
    kernel.WaitNamedPipeW.argtypes = [C.c_wchar_p, C.c_uint32]
    kernel.CreateFileW.argtypes = [C.c_wchar_p, C.c_uint32, C.c_uint32, C.c_void_p, C.c_uint32, C.c_uint32, C.c_void_p]
    kernel.CreateFileW.restype = C.c_void_p
    kernel.GetNamedPipeServerProcessId.argtypes = [C.c_void_p, C.POINTER(C.c_uint32)]
    kernel.CloseHandle.argtypes = [C.c_void_p]
    pipe = "\\\\.\\pipe\\stellaris_mcp_bridge"
    if not kernel.WaitNamedPipeW(pipe, 2000):
        raise ProbeError("bridge_pipe_busy_or_missing")
    handle = kernel.CreateFileW(pipe, 0xC0000000, 0, None, 3, 0, None)
    if handle in (None, C.c_void_p(-1).value):
        raise ProbeError("cannot_inspect_pipe_owner")
    try:
        pid = C.c_uint32()
        if not kernel.GetNamedPipeServerProcessId(handle, C.byref(pid)):
            raise ProbeError("cannot_resolve_pipe_owner")
        return pid.value
    finally:
        kernel.CloseHandle(handle)


def inspect(request):
    if request.get("op") == "planet_jobs":
        validate_planet_jobs_request(request)
    pid = pipe_server_pid() if request.get("op") == "identity" else request.get("pid")
    if type(pid) is not int or pid <= 0:
        raise ProbeError("invalid_game_pid")
    with Path(GAME_PATH).open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != BUILD_SHA256:
            raise ProbeError("unsupported_game_binary")
    memory = ReadOnlyProcess(pid, GAME_PATH)
    try:
        for rva, prefix in ANCHORS:
            code = bytes.fromhex(prefix)
            if memory.read(memory.base + rva, len(code)) != code:
                raise ProbeError("game_function_anchor_mismatch")
        times = [FileTime() for _ in range(4)]
        memory.kernel.GetProcessTimes.argtypes = [C.c_void_p] + [C.POINTER(FileTime)] * 4
        if not memory.kernel.GetProcessTimes(memory.handle, *(C.byref(x) for x in times)):
            raise ProbeError("cannot_bind_process_creation")
        creation = str((times[0].high << 32) | times[0].low)
        if request.get("creationTime", creation) != creation:
            raise ProbeError("game_process_identity_changed")
        result = {"ok": True, "pid": pid, "creationTime": creation}
        if request.get("op") == "planet_jobs":
            result["planetJobs"] = read_planet_jobs(memory, memory.base, request["planetId"], request["countryId"], request["colonyId"])
        if request.get("op") == "bridge_module":
            found=find_module(memory.kernel,pid,"stellaris_bridge.dll")
            result["bridgeModule"]={"known":True,"loaded":found is not None,"path":found[1] if found else None}
        if request.get("op") == "ships":
            ids = request.get("fleetIds")
            if not isinstance(ids, list) or len(ids) > 32 or any(type(x) is not int or not 0 <= x < 0xFFFFFFFF for x in ids):
                raise ProbeError("invalid_fleet_ids")
            result["fleets"] = [{"fleetId": value, "shipIds": fleet_ship_ids(memory, memory.base, value)} for value in ids]
            if "countryId" in request:
                result["wars"]=read_wars(memory,request["countryId"])
                result["warGoalsWindow"]=read_war_goal_window(memory)
        return result
    finally:
        memory.close()


if __name__ == "__main__":
    try:
        result = inspect(json.loads(sys.stdin.buffer.read(32768)))
    except (ProbeError, OSError, ValueError, KeyError, TypeError) as error:
        result = {"ok": False, "error": str(error)}
    print(json.dumps(result))
