# SPDX-License-Identifier: GPL-3.0-only
"""Bounded exact-build job facts through ReadProcessMemory only.

Field evidence: 4.5.2 SDK CColony/CPopJob and outliner_manager.cpp
GetPlanetJobsJson/SafeReadPdxString. No category offset, game call, or writes.
The controller must independently verify the local player and world before
and after this non-atomic read; ownership alone is not local-player identity.
"""
import re
from colony_ownership_probe import owned_colony_relationship, resolve_ref
from stellaris_memory_probe import number, ProbeError

JOB_DATABASE = 0x3114CC8
COLONY_DATABASE = 0x3114E28
MAX_JOB_REFS = 64  # Stricter than native <256; keep the entire JSON below 64 KiB.
WORKFORCE_SCALE = 100000
MAX_NORMAL_RAW = 100000000000000
RAW_FIELDS = (
    ('current_workforce', 'raw_workforce', 0x90),
    ('max_workforce', 'raw_max_workforce', 0x98),
    ('bonus_workforce', 'raw_bonus_workforce', 0xA0),
    ('workforce_limit', 'raw_workforce_limit', 0xA8),
)


def validate_planet_jobs_request(request):
    for field in ('countryId', 'planetId', 'colonyId'):
        value = request.get(field)
        if type(value) is not int or not 0 <= value < 0xFFFFFFFF:
            raise ProbeError('planet_jobs_requires_explicit_' + field)
    pid = request.get('pid')
    if type(pid) is not int or not 0 < pid <= 0xFFFFFFFF:
        raise ProbeError('planet_jobs_requires_explicit_pid')
    creation = request.get('creationTime')
    if not isinstance(creation, str) or not re.fullmatch(r'[0-9]{1,20}', creation):
        raise ProbeError('planet_jobs_requires_explicit_creationTime')


def job_type_key(memory, job_type):
    if not 0x10000 <= job_type < 0x7FFFFFFFFFFF:
        raise ProbeError('job_type_pointer_unknown')
    # RawPdxString: union inline[16]/heap_ptr, uint64 size, uint64 capacity.
    address = job_type + 0x20
    size = number(memory, address + 0x10)
    capacity = number(memory, address + 0x18)
    if not 1 <= size <= 128 or not size <= capacity <= 65536:
        raise ProbeError('job_key_bounds_unknown')
    if capacity < 16:
        if size >= 16:
            raise ProbeError('job_key_inline_bounds_unknown')
        data = address
    else:
        data = number(memory, address)
        if not 0x10000 <= data < 0x7FFFFFFFFFFF:
            raise ProbeError('job_key_heap_pointer_unknown')
    try:
        key = memory.read(data, size).decode('ascii')
    except UnicodeDecodeError as error:
        raise ProbeError('job_key_encoding_unknown') from error
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key):
        raise ProbeError('job_key_identifier_unknown')
    return key


def _snapshot(memory, base, planet_id, country_id, colony_id):
    relationship = owned_colony_relationship(memory, base, planet_id, country_id, colony_id)
    colony = resolve_ref(memory, base, COLONY_DATABASE, colony_id, 0x10)
    data = number(memory, colony + 0x38)
    count = number(memory, colony + 0x44, '<I')
    if count > MAX_JOB_REFS or count and data < 0x10000:
        raise ProbeError('job_array_bounds_unknown')
    refs = tuple(number(memory, data + index * 4, '<I') for index in range(count))
    if len(set(refs)) != len(refs):
        raise ProbeError('duplicate_job_reference')
    rows = []
    for handle in refs:
        job = resolve_ref(memory, base, JOB_DATABASE, handle, 0x10)
        if number(memory, job + 0x1B0, '<I') != colony_id:
            raise ProbeError('job_colony_backlink_mismatch')
        job_type = number(memory, job + 0x18)
        key = job_type_key(memory, job_type)
        raw = tuple(number(memory, job + offset, '<q') for _, _, offset in RAW_FIELDS)
        rows.append((handle, job, job_type, key, raw))
    return relationship, colony, data, refs, tuple(rows)


def _scaled(raw):
    # Negative and huge values may be engine sentinels. Keep their raw decimal
    # values rather than guessing unlimited, zero, or maximum capacity.
    return raw / WORKFORCE_SCALE if 0 <= raw < MAX_NORMAL_RAW else None


def read_planet_jobs(memory, base, planet_id, country_id, colony_id):
    result = {'known': False, 'readOnly': True, 'planetId': planet_id,
              'colonyId': colony_id, 'countryId': country_id,
              'ownershipRelationshipVerified': False, 'playerBindingVerified': False,
              'coverageComplete': False, 'stableRead': False, 'atomicSnapshot': False,
              'jobCount': None, 'flat_jobs': [], 'source': 'live-process-readonly'}
    try:
        for value in (planet_id, country_id, colony_id):
            if type(value) is not int or not 0 <= value < 0xFFFFFFFF:
                raise ProbeError('invalid_planet_job_binding')
        before = _snapshot(memory, base, planet_id, country_id, colony_id)
        after = _snapshot(memory, base, planet_id, country_id, colony_id)
        if before != after:
            raise ProbeError('planet_jobs_changed_during_read')
        rows = []
        for handle, _, _, key, raw_values in before[4]:
            row = {'job_id': handle, 'job_key': key}
            for (scaled_key, raw_key, _), raw in zip(RAW_FIELDS, raw_values):
                row[scaled_key] = _scaled(raw)
                row[raw_key] = str(raw)
            rows.append(row)
        result.update(known=True, ownershipRelationshipVerified=True,
                      coverageComplete=True, stableRead=True, jobCount=len(rows), flat_jobs=rows)
    except (ProbeError, OSError, ValueError, KeyError, TypeError) as error:
        result['error'] = str(error)
    return result
