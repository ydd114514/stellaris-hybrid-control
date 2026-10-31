"""Read-only disassembly inventory; this does not certify or expose a write API."""
from pathlib import Path
import hashlib
import json
import struct
import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

exe = Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
expected = '400df27c82ddc845aa9dce79bd468d81f18f060d299cd263e3afa93aef4f7a83'
with exe.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
if digest != expected:
    raise SystemExit('Unsupported executable; no layout assumptions applied')
pe = pefile.PE(str(exe), fast_load=True)
image = pe.get_memory_mapped_image()
base = pe.OPTIONAL_HEADER.ImageBase
out = Path(__file__).resolve().parents[1] / '.local/hybrid-control/colony-layout-inventory'
out.mkdir(parents=True, exist_ok=True)
functions = {'enable_factory': (0x6B9650, 0x50), 'settings_factory': (0x6B96A0, 0x70),
             'manager_serializer': (0x7F6C30, 0x500),
             'colony_serializer': (0xDA76E0, 0x3000),
             'enable_execute': (0x6B4ED0, 0x280),
             'enable_valid': (0x6B5150, 0x240),
             'settings_apply': (0xE66300, 0x500),
             'automation_serializer_thunk': (0x1BAB870, 0x80),
             'automation_serialize': (0xE64880, 0x170),
             'automation_deserialize': (0xE649F0, 0x300),
             'category_key_copy': (0x154A60, 0x190),
             'category_key_construct': (0x15BAF0, 0x150)}
tables = {'enable': 0x23919F0, 'settings': 0x2391430}
vtable_entries = {}
for name, table in tables.items():
    entries = []
    for index in range(18):
        rva = struct.unpack_from('<Q', image, table + 8 * index)[0] - base
        if not 0x1000 <= rva < 0x2100000:
            break
        entries.append(hex(rva))
        functions[f'{name}_vt_{index}'] = (rva, 0x300)
    vtable_entries[name] = entries
decoder = Cs(CS_ARCH_X86, CS_MODE_64)
for name, (rva, size) in functions.items():
    lines = [f'{ins.address-base:08x} {ins.mnemonic} {ins.op_str}'
             for ins in decoder.disasm(image[rva:rva+size], base+rva)]
    (out / f'{name}.asm').write_text('\n'.join(lines)+'\n', encoding='utf-8')
manifest = {'exeSha256': digest, 'vtableEntries': vtable_entries,
            'functions': {name: hex(rva) for name, (rva, _) in functions.items()},
            'liveReads': False, 'commandsIssued': 0, 'writeApiCertified': False,
            'limitations': 'Bounded disassembly may include adjacent code. Function boundaries, colony handles, range semantics, ownership and spend controls still require proof.'}
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({'directory': str(out), 'functions': len(functions), 'commandsIssued': 0}))
