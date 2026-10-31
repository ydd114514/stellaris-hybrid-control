"""Verify the supported EXE offline and emit fingerprints for survey state reads."""
from pathlib import Path
import hashlib
import json
import struct
import argparse
import pefile

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--exe', type=Path, default=Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe'))
exe = parser.parse_args().exe
expected = '400df27c82ddc845aa9dce79bd468d81f18f060d299cd263e3afa93aef4f7a83'
with exe.open('rb') as f:
    actual = hashlib.file_digest(f, 'sha256').hexdigest()
if actual != expected:
    raise SystemExit('Unsupported game executable: survey layouts require new verification')
pe = pefile.PE(str(exe), fast_load=True)
image = pe.get_memory_mapped_image()
base = pe.OPTIONAL_HEADER.ImageBase
# Separate engine paths agree: BuildOrdersString reads the root; ClearOrders walks
# next+8 and replaces the root with the same null object used by the order ctor.
checks = {
    'root_read': (0xC755AD, bytes.fromhex('488b89c8020000')),
    'clear_root': (0xC6AE90, bytes.fromhex('488b89c8020000')),
    'next_order': (0xC6AED5, bytes.fromhex('488b4f08')),
    'order_token': (0xC6AEE7, bytes.fromhex('8b4718')),
    'automation_size': (0xCD8132, bytes.fromhex('b978000000')),
    'automation_flags_copy': (0x1265A3A, bytes.fromhex('0fb7473066894370')),
    'survey_bit': (0xCF2A1A, bytes.fromhex('0fb67d70')),
    'engine_run_bit_set': (0xCF366D, bytes.fromhex('b80004000066094770')),
    'engine_run_bit_clear': (0xCF33DE, bytes.fromhex('b8fffb000066214770')),
}
for name, (rva, data) in checks.items():
    if image[rva:rva + len(data)] != data:
        raise SystemExit('Survey layout fingerprint failed: ' + name)
serializer = struct.unpack_from('<Q', image, 0x23D4120 + 16)[0] - base
assert serializer == 0xCF2800
assert struct.unpack_from('<Q', image, 0x23D4120 + 0x100)[0] - base == 0xCD8120
for rva, expected_vtable in [(0xCD815E,0x22FE568),(0xCD8186,0x23D40C8),(0xCD81AC,0x22FE5B0)]:
    assert rva + 7 + struct.unpack_from('<i', image, rva + 3)[0] == expected_vtable
assert image[0xCF2A1E:0xCF2A25] == bytes.fromhex('40d0ef4080e701')
assert image[0xCF2A25:0xCF2A2A] == bytes.fromhex('ba4c300000')
for rva in [0x1265934, 0xC6B01C]:
    target = rva + 7 + struct.unpack_from('<i', image, rva + 3)[0]
    assert target == 0x3112F78
bridge = root / '.local/research/stellaris-mcp-native/stellaris_bridge/include'
lines = ['#pragma once', '#include <cstring>', 'namespace bridge::survey_layout {',
         'inline constexpr uintptr_t Root = 0x2C8, Next = 8, Token = 0x18;',
         'inline constexpr uintptr_t NullGlobal = 0x3112F78, AutomationVtable = 0x23D4120;',
         'inline constexpr uintptr_t Clone = 0xCD8120;',
         'inline constexpr uintptr_t ArrayVtables[] = {0x22FE568,0x23D40C8,0x22FE5B0};',
         'inline bool Matches(uintptr_t base) {']
for name, (rva, data) in checks.items():
    literals = ','.join('0x%02x' % b for b in data)
    lines += [f'  const unsigned char {name}[] = {{{literals}}};',
              f'  if (memcmp((const void*)(base+0x{rva:X}), {name}, sizeof({name}))) return false;']
lines += ['  return true;', '}', '}']
(bridge / 'survey_layout.hpp').write_text('\n'.join(lines) + '\n', encoding='utf-8')
out = root / '.local/hybrid-control/native-analysis/survey-layout-proof.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({'exe_sha256':actual, 'runtime_verified':False,
    'checks':{n:{'rva':hex(r),'bytes':b.hex()} for n,(r,b) in checks.items()},
    'null_global':'0x3112f78','automation_vtable':'0x23d4120'}, indent=2))
print('Survey read layout fingerprints verified; header generated. No game connection.')
