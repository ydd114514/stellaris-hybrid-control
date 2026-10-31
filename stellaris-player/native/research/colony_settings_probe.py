# SPDX-License-Identifier: GPL-3.0-only
"""Read serializer-backed category membership; never call or modify game code.

Only reports list membership, not category execution or any spending guarantee.
Caller must verify executable fingerprints and colony ownership independently.
"""
import re
from stellaris_memory_probe import number, ProbeError

def category_key(memory, category, known_keys):
    if category < 0x10000: raise ProbeError('category_pointer_unknown')
    string = category + 0x20  # E64903 passes key+10; 15BAF9 adds another +10 for its string
    size = number(memory, string+0x10)
    capacity = number(memory, string+0x18)
    if not 1 <= size <= 128 or capacity < size or capacity > 65536:
        raise ProbeError('category_key_bounds_unknown')
    if capacity < 16:
        address = string
    else:
        address = number(memory, string)
        if address < 0x10000: raise ProbeError('category_string_pointer_unknown')
    try: key = memory.read(address,size).decode('ascii')
    except UnicodeDecodeError: raise ProbeError('category_key_encoding_unknown')
    if not re.fullmatch(r'[a-z][a-z0-9_]*',key) or key not in known_keys:
        raise ProbeError('category_key_not_in_local_definitions')
    return key

def colony_category_membership(memory,colony,known_keys):
    # CColony+F00 owns this object: E66300 apply, E64880 serializer.
    # No meaning is assigned to absent categories or country defaults here.
    if number(memory,colony+0xF08) != colony:
        raise ProbeError('automation_colony_backlink_mismatch')
    count = number(memory,colony+0xF24,'<I')
    if count > min(128,len(known_keys)): raise ProbeError('category_count_out_of_bounds')
    data = number(memory,colony+0xF18)
    if count and data < 0x10000: raise ProbeError('category_array_pointer_unknown')
    keys=[category_key(memory,number(memory,data+i*8),known_keys) for i in range(count)]
    if len(set(keys)) != len(keys): raise ProbeError('duplicate_category_membership')
    # Reject list mutation observed during these external reads.
    if number(memory,colony+0xF24,'<I') != count or number(memory,colony+0xF18) != data:
        raise ProbeError('category_membership_changed_during_read')
    return {'known':True,'memberKeys':keys,'memberCount':count,
            'executionSemanticsVerified':False,'budgetKnown':False}
