# SPDX-License-Identifier: GPL-3.0-only
"""Load the pinned MIT Stellaris MCP release into an explicitly selected game.

Uses the adjacent GPL read-only preflight. Only LoadLibraryW runs on a remote
thread; gameplay calls are left to the bridge's game-thread queue. No unload.
"""
import ctypes as C
import hashlib
import json
import ntpath
from pathlib import Path
import sys
import time
from stellaris_memory_probe import ReadOnlyProcess, ProbeError, BUILD_SHA256, ANCHORS

DLL_SHA256 = "33397bfb804c299ca289c358808abee64f1cd146478229de8170b2f984cc302d"
FIRST_CONTACT_DLL_SHA256 = "f0feb0e36157c94734675e7585b565d87d93ad310c03147d414d408202fa1dd9"
SHIPYARDS_DLL_SHA256 = "82c0914d3890fc87a6f222fa38c7a2a4ba31e44271f58efbab33989c961ade5b"
REVIEWED_DLL_HASHES = {DLL_SHA256, "4a54662dd9c9555ccdf5eedaf6ef611f30d139dfc3459c2d3135d57363059d8e", "4d432e4870604616b9d10f473391052a2d91e2af7c6d77a23055c9c378926503", "4ae2db8d1486ea5309426c82c107d34f3a323fa2129dbd5c21fa28dff0168770", "5e2b06ef9ab68e964cb454d3d3b2a6aecaedafb13571004027540dc10069569d", "b9b953e3c719edab57573a5793e859eb970598f1cc124033e21b07bb8c24d3d0", "940def49e90ec99129b795a38debe7f610f344e89850b9a080304a539f3790b4", "d5c793eb0e5ca5053d0ae99280478ef200e6d38343d9932f77f3e5df08a1f3db", "c9bfd884df419b8ce15fda1c13fb63238dfc44d12ea2035272fbbe7cd1fd3489", "0d8d251686406cd1aaf5da3225576f0ff4d7769a468db2a77578c0469a0fb581", "00ea2aaf737484ee22cc2dfb27a0e6562b93ea7594e0161f9d731dcedaaf149d"}


REVIEWED_DLL_HASHES.add(FIRST_CONTACT_DLL_SHA256)
# cyberfish-0.6.4-shipyards: construction-20261029 manifest and runtime verified.
REVIEWED_DLL_HASHES.add(SHIPYARDS_DLL_SHA256)

# Reviewed engine quote build; main-thread command Execute call-site proof archived.

# Reviewed engine quote build; main-thread command Execute call-site proof archived.
REVIEWED_DLL_HASHES.add("247259c0c4a8e83387bbe47aad21be01f4213ccca309db9b5001b09ab8a1e029")
GESTALT_WAR_DLL_SHA256 = "cc4ca2a860e8e1a7e6fa4febd7e9446c7e227e26d7b920f1f48ca8bab1f1f22f"
REVIEWED_DLL_HASHES.add(GESTALT_WAR_DLL_SHA256)
# Survey pilot: current EXE fingerprints, source review and Release build;
# runtime acceptance is separate and must not be inferred from this allowlist.
REVIEWED_DLL_HASHES.add("1ac53fa552f851e6a684a8c0cee0a76f7b9d462a5be15b1ba97e8e17c5c1b231")

# Explicit read-only colony candidate loader admission, not runtime acceptance.
# Production bootstrap still selects only its existing 0.6.6/0.6.7 paths.
REVIEWED_DLL_HASHES.add("bbeb50b3ec826fded88e7054c9691ff13cdc5b71e95fa8ed0c59cb9c6d459a6b")
# Pinned monthly candidate: loader admission for unified execution acceptance.
# This does not certify settlement or change the default production bridge.
REVIEWED_DLL_HASHES.add("8d8dff1c8fc20a6b1865cc6becd408acb053f15b72c62fe0a4b85af8b934539d")

# Monthly quote/product guard candidate admission; runtime acceptance is separate.
REVIEWED_DLL_HASHES.add("249b1011e5c4861efe208c95514a0327e11af5d0cfc1a0a6911884ed5eea354a")
# Corrected parser secondary-interface/CStringToken upgrade-path candidate.
# Pinned static proof and Release build passed; runtime acceptance is separate.
REVIEWED_DLL_HASHES.add("2da799dc0857599f726a76e6f0c67e93107da4ed6ea3e374220e450e60d2b5be")
# Main-thread dynamic upkeep/storage candidate. Compiled and boundary-tested;
# admission allows explicit acceptance only, not a production/default promotion.
REVIEWED_DLL_HASHES.add("84c5e4c4a5e062a85a59448ae5b5f69a1a36e00dc561b1517f9432be18ef4758")

# Explicit claim-cost/capped-send acceptance build; not production promotion.
REVIEWED_DLL_HASHES.add("b9936cf0d5ae7a11537916daaf5631f3f20a1b4562da3df8e69462f5e0bc6e52")

# P0 paused country-AI research candidate; loader admission only.
# No autonomous-operation or production acceptance is implied.
REVIEWED_DLL_HASHES.add("1315317a17fc0fd5a294311fd2595a897030c94d5ebf3d8d67523aa13354b292")

# Explicit r2 serialized-execution receipt fix; not production promotion.
REVIEWED_DLL_HASHES.add("f3e0cfa9cfaa64e567d297af1899a9a2b3c329f9ba00cab75c36a061d941556e")

# Explicit bounded P1 pilot admission; not production or core-goal acceptance.
REVIEWED_DLL_HASHES.add("740c408ea7fb5503349417945a1c3d7550e9b6938bb645fc551340b97c60a452")

# Explicit P1 r2 Post-gate/Clone-lifetime correction, pending live acceptance.
REVIEWED_DLL_HASHES.add("53356faf2a90c123b3ba39a03498518ebd231b6e093530d4cad8f6241cbb7368")

class Module(C.Structure):
    _fields_ = [("size", C.c_uint32), ("id", C.c_uint32), ("pid", C.c_uint32),
                ("globalUse", C.c_uint32), ("processUse", C.c_uint32),
                ("base", C.c_void_p), ("imageSize", C.c_uint32), ("handle", C.c_void_p),
                ("name", C.c_wchar * 256), ("path", C.c_wchar * 260)]


def find_module(kernel, pid, name):
    kernel.Module32FirstW.argtypes = [C.c_void_p, C.POINTER(Module)]
    kernel.Module32NextW.argtypes = [C.c_void_p, C.POINTER(Module)]
    snapshot = kernel.CreateToolhelp32Snapshot(0x18, pid)
    if snapshot in (None, C.c_void_p(-1).value):
        raise ProbeError("module_snapshot_failed")
    try:
        row = Module()
        row.size = C.sizeof(row)
        ok = kernel.Module32FirstW(snapshot, C.byref(row))
        while ok:
            if row.name.lower() == name.lower():
                return row.base, row.path
            ok = kernel.Module32NextW(snapshot, C.byref(row))
        return None
    finally:
        kernel.CloseHandle(snapshot)


def reviewed_compatible_library(existing_path, compatible_paths):
    """Reuse only an explicitly selected path with a reviewed on-disk hash.

    This never loads an alternative library. The caller still checks the actual
    bridge version/features through ping before issuing gameplay commands.
    """
    # The bootstrap's base mode names five reviewed superset generations.
    # This is a reuse-only bound, not permission to load an alternative DLL.
    if not isinstance(compatible_paths, list) or len(compatible_paths) > 5:
        raise ProbeError("invalid_compatible_library_list")
    for candidate in compatible_paths:
        if not isinstance(candidate, str):
            raise ProbeError("invalid_compatible_library_path")
        if ntpath.normcase(candidate) != ntpath.normcase(existing_path):
            continue
        file = Path(candidate).resolve(strict=True)
        if file.name.lower() != "stellaris_bridge.dll":
            raise ProbeError("unexpected_library_name")
        with file.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest not in REVIEWED_DLL_HASHES:
            raise ProbeError("binary_sha256_mismatch:" + file.name)
        return digest
    return None


def process_creation_time(kernel,handle):
    class ProcessFileTime(C.Structure):
        _fields_=[("low",C.c_uint32),("high",C.c_uint32)]
    times=[ProcessFileTime() for _ in range(4)]
    kernel.GetProcessTimes.argtypes=[C.c_void_p]+[C.POINTER(ProcessFileTime)]*4
    if not kernel.GetProcessTimes(handle,*(C.byref(value) for value in times)):
        raise ProbeError("cannot_verify_process_creation_time")
    return str((times[0].high<<32)|times[0].low)


def load(pid, game_path, dll_path, compatible_paths=None, expected_creation_time=None):
    started = time.monotonic()
    if expected_creation_time is not None and (not isinstance(expected_creation_time,str) or not expected_creation_time.isascii() or not expected_creation_time.isdigit() or len(expected_creation_time)>20):
        raise ProbeError("invalid_expected_process_creation_time")
    dll = Path(dll_path).resolve(strict=True)
    if dll.name.lower() != "stellaris_bridge.dll":
        raise ProbeError("unexpected_library_name")
    dll_digest = None
    for file, expected in [(Path(game_path), BUILD_SHA256), (dll, None)]:
        with file.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
            if expected is not None and digest != expected or expected is None and digest not in REVIEWED_DLL_HASHES:
                raise ProbeError("binary_sha256_mismatch:" + file.name)
            if expected is None:
                dll_digest = digest
    preflight = ReadOnlyProcess(pid, game_path)
    try:
        if expected_creation_time is not None and process_creation_time(preflight.kernel,preflight.handle)!=expected_creation_time:
            raise ProbeError("game_process_creation_changed")
        for offset, prefix in ANCHORS:
            code = bytes.fromhex(prefix)
            if preflight.read(preflight.base + offset, len(code)) != code:
                raise ProbeError("live_game_anchor_mismatch")
        k = preflight.kernel
        existing = find_module(k, pid, dll.name)
        if existing:
            if ntpath.normcase(existing[1]) != ntpath.normcase(str(dll)):
                compatible_digest = reviewed_compatible_library(existing[1], compatible_paths or [])
                if compatible_digest:
                    return {"ok": True, "status": "already_loaded_compatible", "pid": pid,
                            "dllSha256": compatible_digest}
                raise ProbeError("different_bridge_already_loaded_restart_required")
            return {"ok": True, "status": "already_loaded", "pid": pid}
        k.VirtualAllocEx.argtypes = [C.c_void_p, C.c_void_p, C.c_size_t, C.c_uint32, C.c_uint32]
        k.VirtualAllocEx.restype = C.c_void_p
        k.VirtualFreeEx.argtypes = [C.c_void_p, C.c_void_p, C.c_size_t, C.c_uint32]
        k.WriteProcessMemory.argtypes = [C.c_void_p, C.c_void_p, C.c_void_p, C.c_size_t, C.POINTER(C.c_size_t)]
        k.GetModuleHandleW.argtypes = [C.c_wchar_p]
        k.GetModuleHandleW.restype = C.c_void_p
        k.GetProcAddress.argtypes = [C.c_void_p, C.c_char_p]
        k.GetProcAddress.restype = C.c_void_p
        k.GetModuleHandleExW.argtypes = [C.c_uint32, C.c_void_p, C.POINTER(C.c_void_p)]
        k.GetModuleFileNameW.argtypes = [C.c_void_p, C.c_wchar_p, C.c_uint32]
        k.CreateRemoteThread.argtypes = [C.c_void_p, C.c_void_p, C.c_size_t, C.c_void_p, C.c_void_p, C.c_uint32, C.c_void_p]
        k.CreateRemoteThread.restype = C.c_void_p
        k.WaitForSingleObject.argtypes = [C.c_void_p, C.c_uint32]
        proc = k.OpenProcess(0x43A, False, pid)
        if not proc:
            raise ProbeError("cannot_open_selected_game_for_loading")
        remote, thread, pending = None, None, False
        try:
            # Recheck path on the new handle so a recycled PID cannot slip past preflight.
            actual, count = C.create_unicode_buffer(32768), C.c_uint32(32768)
            if not k.QueryFullProcessImageNameW(proc, 0, actual, C.byref(count)) or ntpath.normcase(actual.value) != ntpath.normcase(game_path):
                raise ProbeError("game_identity_changed")
            if expected_creation_time is not None and process_creation_time(k,proc)!=expected_creation_time:
                raise ProbeError("game_process_creation_changed")
            fn = k.GetProcAddress(k.GetModuleHandleW("kernel32.dll"), b"LoadLibraryW")
            local_owner = C.c_void_p()
            if not fn or not k.GetModuleHandleExW(6, fn, C.byref(local_owner)):
                raise ProbeError("load_library_address_unavailable")
            owner_path = C.create_unicode_buffer(32768)
            if not k.GetModuleFileNameW(local_owner, owner_path, len(owner_path)):
                raise ProbeError("load_library_module_unavailable")
            remote_owner = find_module(k, pid, ntpath.basename(owner_path.value))
            if not remote_owner:
                raise ProbeError("remote_system_library_unavailable")
            remote_fn = remote_owner[0] + fn - local_owner.value
            encoded = str(dll).encode("utf-16le") + b"\0\0"
            remote = k.VirtualAllocEx(proc, None, len(encoded), 0x3000, 4)
            written = C.c_size_t()
            if not remote or not k.WriteProcessMemory(proc, remote, encoded, len(encoded), C.byref(written)) or written.value != len(encoded):
                raise ProbeError("library_path_transfer_failed")
            thread = k.CreateRemoteThread(proc, None, 0, remote_fn, remote, 0, None)
            if not thread:
                raise ProbeError("library_load_thread_failed")
            waited = k.WaitForSingleObject(thread, 5000)
            if waited != 0:
                pending = True
                raise ProbeError("library_load_pending_do_not_retry")
            loaded = find_module(k, pid, dll.name)
            if not loaded or ntpath.normcase(loaded[1]) != ntpath.normcase(str(dll)):
                raise ProbeError("library_not_present_after_load")
            return {"ok": True, "status": "loaded", "pid": pid, "dllSha256": dll_digest,
                    "elapsedMs": round((time.monotonic() - started) * 1000)}
        finally:
            if remote and not pending:
                k.VirtualFreeEx(proc, remote, 0, 0x8000)
            if thread:
                k.CloseHandle(thread)
            k.CloseHandle(proc)
    finally:
        preflight.close()


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.buffer.read(32768))
        result = load(request["pid"], request["gamePath"], request["dllPath"], request.get("compatibleDllPaths", []), request.get("expectedCreationTime"))
    except (ProbeError, OSError, ValueError, KeyError, TypeError) as error:
        result = {"ok": False, "error": str(error)}
    print(json.dumps(result, ensure_ascii=True))

# v1.5 default-allow/reserved gate; compiled for one consolidated T6, not live acceptance.
REVIEWED_DLL_HASHES.add("29005423ccc42cc7c55990b214f258dfba51c6c135d3ae70daf67d6eca59d2c1")
