"""Offline fake-memory coverage only; no native process or pipe access."""
import struct
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native/research'))
from planet_jobs_probe import read_planet_jobs, validate_planet_jobs_request, MAX_JOB_REFS
from stellaris_memory_probe import ProbeError
from colony_ownership_test import fixture as ownership_fixture
import native_session


def fixture(key='coordinator', handle=0x01000002):
    memory, base = ownership_fixture()
    database, table, job, job_type, data = 0xB0000, 0xC0000, 0xD0000, 0xE0000, 0xF0000
    memory.put(base + 0x3114CC8, database)
    memory.put(database + 0x18, table)
    memory.put(database + 0x20, 8, '<I')
    memory.put(table + (handle & 0xFFFFFF) * 16 + 8, job)
    memory.put(job + 0x10, handle, '<I')
    memory.put(job + 0x1B0, 0, '<I')
    memory.put(job + 0x18, job_type)
    memory.put(0x90000 + 0x38, data)
    memory.put(0x90000 + 0x44, 1, '<I')
    memory.put(data, handle, '<I')
    for offset, value in [(0x90, 12345000), (0x98, 20000000), (0xA0, 0), (0xA8, 0)]:
        memory.put(job + offset, value, '<q')
    address = job_type + 0x20
    memory.put(address + 0x10, len(key))
    memory.put(address + 0x18, 15 if len(key) < 16 else len(key))
    if len(key) < 16:
        string_data = address
    else:
        string_data = 0x110000
        memory.put(address, string_data)
    for index, byte in enumerate(key.encode('ascii')):
        memory.bytes[string_data + index] = byte
    return memory, base, job, data, job_type


class PlanetJobs(unittest.TestCase):
    def test_returns_full_handle_flat_hive_job_and_zero_limit_without_inventing_strata(self):
        memory, base, _, _, _ = fixture()
        result = read_planet_jobs(memory, base, 3, 0, 0)
        self.assertTrue(result['known'])
        self.assertTrue(result['coverageComplete'])
        self.assertTrue(result['stableRead'])
        self.assertTrue(result['ownershipRelationshipVerified'])
        self.assertFalse(result['playerBindingVerified'])
        self.assertFalse(result['atomicSnapshot'])
        self.assertNotIn('strata', result)
        self.assertEqual(result['jobCount'], 1)
        row = result['flat_jobs'][0]
        self.assertEqual(row['job_id'], 0x01000002)
        self.assertEqual(row['job_key'], 'coordinator')
        self.assertEqual(row['current_workforce'], 123.45)
        self.assertEqual(row['max_workforce'], 200)
        self.assertEqual(row['workforce_limit'], 0)
        self.assertEqual(row['raw_workforce_limit'], '0')

    def test_large_or_negative_sentinels_are_retained_exactly_without_defaulting_to_maximum(self):
        memory, base, job, _, _ = fixture()
        memory.put(job + 0xA8, -1, '<q')
        memory.put(job + 0x98, 0x7FFFFFFFFFFFFFFF, '<q')
        result = read_planet_jobs(memory, base, 3, 0, 0)
        self.assertTrue(result['known'])
        row = result['flat_jobs'][0]
        self.assertIsNone(row['max_workforce'])
        self.assertIsNone(row['workforce_limit'])
        self.assertEqual(row['raw_max_workforce'], '9223372036854775807')
        self.assertEqual(row['raw_workforce_limit'], '-1')

    def test_heap_keys_and_empty_lists_have_complete_bounded_coverage(self):
        memory, base, _, _, _ = fixture('long_coordinator_job_type')
        self.assertEqual(read_planet_jobs(memory, base, 3, 0, 0)['flat_jobs'][0]['job_key'], 'long_coordinator_job_type')
        memory.put(0x90000 + 0x44, 0, '<I')
        memory.put(0x90000 + 0x38, 0)
        result = read_planet_jobs(memory, base, 3, 0, 0)
        self.assertTrue(result['known'])
        self.assertEqual(result['flat_jobs'], [])
        self.assertEqual(result['jobCount'], 0)

    def test_oversize_lists_stale_fullrefs_foreign_jobs_and_invalid_strings_stay_unknown(self):
        for mutate in [
            lambda m, j, d, t: m.put(0x90000 + 0x44, MAX_JOB_REFS + 1, '<I'),
            lambda m, j, d, t: m.put(j + 0x10, 2, '<I'),
            lambda m, j, d, t: m.put(j + 0x1B0, 1, '<I'),
            lambda m, j, d, t: m.put(0x30000 + 0xD0, 1, '<I'),
            lambda m, j, d, t: m.put(t + 0x30, 129),
            lambda m, j, d, t: m.put(t + 0x38, 1),
            lambda m, j, d, t: m.bytes.__setitem__(t + 0x20, 255),
            lambda m, j, d, t: m.put(0x90000 + 0x44, 2, '<I') or m.put(d + 4, 0x01000002, '<I'),
        ]:
            memory, base, job, data, job_type = fixture()
            mutate(memory, job, data, job_type)
            result = read_planet_jobs(memory, base, 3, 0, 0)
            self.assertFalse(result['known'])
            self.assertFalse(result['coverageComplete'])
            self.assertEqual(result['flat_jobs'], [])

    def test_concurrent_array_identity_and_workforce_changes_never_return_partial_facts(self):
        for changed_address, value, fmt in [
            (0x90000 + 0x44, 0, '<I'),
            (0x90000 + 0x38, 0x120000, '<Q'),
            (0xD0000 + 0x90, 1, '<q'),
            (0x30000 + 0xD0, 1, '<I'),
        ]:
            memory, base, _, _, _ = fixture()
            original = memory.read
            ownership_reads = 0
            def changing(address, size):
                nonlocal ownership_reads
                if address == 0x30000 + 0xD0:
                    ownership_reads += 1
                    if ownership_reads == 2:
                        memory.put(changed_address, value, fmt)
                return original(address, size)
            memory.read = changing
            result = read_planet_jobs(memory, base, 3, 0, 0)
            self.assertFalse(result['known'])
            self.assertFalse(result['stableRead'])
            self.assertEqual(result['flat_jobs'], [])

    def test_missing_explicit_binding_is_rejected_before_opening_any_process_or_pipe(self):
        valid = {'op': 'planet_jobs', 'pid': 12, 'creationTime': '12345', 'countryId': 0, 'planetId': 3, 'colonyId': 0}
        validate_planet_jobs_request(valid)
        with patch.object(native_session, 'pipe_server_pid', side_effect=AssertionError('must not connect')), \
             patch.object(native_session, 'ReadOnlyProcess', side_effect=AssertionError('must not open process')):
            for field in ('pid', 'creationTime', 'countryId', 'planetId', 'colonyId'):
                invalid = dict(valid)
                del invalid[field]
                with self.assertRaises(ProbeError):
                    native_session.inspect(invalid)
        for field, value in [('pid', True), ('countryId', True), ('planetId', -1), ('colonyId', 0xFFFFFFFF), ('creationTime', 12345)]:
            invalid = {**valid, field: value}
            with self.assertRaises(ProbeError):
                validate_planet_jobs_request(invalid)


if __name__ == '__main__':
    unittest.main()
