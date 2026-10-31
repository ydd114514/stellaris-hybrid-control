# SPDX-License-Identifier: GPL-3.0-only
"""Offline contract checks: no process discovery or game access on import."""
import importlib.util
from pathlib import Path
import struct
import unittest

SPEC = importlib.util.spec_from_file_location("memory_probe", Path(__file__).resolve().parents[1] / "native/research/stellaris_memory_probe.py")
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class Memory:
    def __init__(self):
        self.bytes = {}
        self.reads = []

    def put(self, address, data):
        self.bytes.update((address + index, value) for index, value in enumerate(data))

    def value(self, address, value, fmt="<Q"):
        self.put(address, struct.pack(fmt, value))

    def read(self, address, size):
        self.reads.append((address, size))
        try:
            return bytes(self.bytes[address + i] for i in range(size))
        except KeyError as error:
            raise probe.ProbeError("unreadable") from error


class NativeReadContracts(unittest.TestCase):
    def setUp(self):
        self.memory = Memory()
        self.base, self.database, self.entries, self.fleet = 0x140000000, 0x200000, 0x300000, 0x400000
        self.id = 0x01000002
        for address, value, fmt in [
            (self.base + probe.FLEET_DATABASE, self.database, "<Q"),
            (self.base + probe.NULL_FLEET, 0, "<Q"),
            (self.database + 0x20, 3, "<I"),
            (self.database + 0x18, self.entries, "<Q"),
            (self.entries + 2 * 16 + 8, self.fleet, "<Q"),
            (self.fleet + 0x30, self.id, "<I"),
        ]:
            self.memory.value(address, value, fmt)

    def add_coordinate(self, *, code=b"\x48\x8d\x41\x58\xc3", vtable=None):
        getter, provider_vtable = self.base + 0x2000, self.base + 0x2300000
        self.memory.value(self.fleet + 0x38, provider_vtable)
        self.memory.value(provider_vtable + 8, getter)
        self.memory.put(getter, code.ljust(32, b"\x90"))
        coordinate = self.fleet + 0x38 + 0x58
        self.memory.value(coordinate, vtable or self.base + probe.COORDINATE_VTABLE)
        self.memory.value(coordinate + 0x20, 121, "<I")

    def test_reads_coordinate_without_executing_getter(self):
        self.add_coordinate()
        self.assertEqual(probe.inspect_fleet(self.memory, self.base, self.id),
                         {"id": self.id, "resolved": True, "systemId": 121, "coordinateStatus": "live"})

    def test_generation_bits_prevent_reused_handle(self):
        self.memory.value(self.fleet + 0x30, 2, "<I")
        self.assertIsNone(probe.resolve_fleet(self.memory, self.base, self.id))

    def test_out_of_range_index_never_reads_entry(self):
        self.assertIsNone(probe.resolve_fleet(self.memory, self.base, 99))
        self.assertFalse(any(self.entries <= address < self.entries + 10000 for address, size in self.memory.reads))

    def test_unknown_instruction_does_not_guess_coordinate(self):
        self.add_coordinate(code=b"\xe8\x00\x00\x00\x00\xc3")
        result = probe.inspect_fleet(self.memory, self.base, self.id)
        self.assertNotIn("systemId", result)
        self.assertTrue(result["coordinateStatus"].startswith("unsupported_coordinate_getter"))

    def test_coordinate_vtable_mismatch_fails(self):
        self.add_coordinate(vtable=self.base + 0x5000)
        with self.assertRaisesRegex(probe.ProbeError, "coordinate_type_mismatch"):
            probe.inspect_fleet(self.memory, self.base, self.id)

    def test_bounded_relative_getter_thunk(self):
        start, target = self.base + 0x2000, self.base + 0x2200
        self.memory.put(start, (b"\x48\x83\xe9\x38\xe9" + struct.pack("<i", target - start - 9)).ljust(32, b"\x90"))
        self.memory.put(target, b"\x48\x8d\x81\x90\x00\x00\x00\xc3".ljust(32, b"\x90"))
        self.assertEqual(probe.coordinate_getter(self.memory, self.base, start, self.fleet + 0x38), self.fleet + 0x90)

    def test_getter_outside_game_code_is_rejected(self):
        with self.assertRaisesRegex(probe.ProbeError, "getter_outside_verified_text"):
            probe.coordinate_getter(self.memory, self.base, self.fleet, self.fleet + 0x38)

    def test_fleet_and_ship_handles_are_distinct(self):
        self.memory.value(self.fleet + 0x320, 0x600000)
        self.memory.value(self.fleet + 0x32C, 1, "<I")
        self.memory.value(0x600000, 1241, "<I")
        self.assertEqual(probe.fleet_ship_ids(self.memory, self.base, self.id), [1241])

    def test_ship_zero_handle_is_kept_and_unbounded_array_is_rejected(self):
        self.memory.value(self.fleet + 0x320, 0x600000)
        self.memory.value(self.fleet + 0x32C, 1, "<I")
        self.memory.value(0x600000, 0, "<I")
        self.assertEqual(probe.fleet_ship_ids(self.memory, self.base, self.id), [0])
        self.memory.value(self.fleet + 0x32C, 100000, "<I")
        with self.assertRaisesRegex(probe.ProbeError, "invalid_fleet_ship_array"):
            probe.fleet_ship_ids(self.memory, self.base, self.id)


if __name__ == "__main__":
    unittest.main()
