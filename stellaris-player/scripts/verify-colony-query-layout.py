"""Emit exact-build fingerprints for the read-only single-colony candidate."""
from pathlib import Path
import hashlib, struct, json, re
import pefile
root=Path(__file__).resolve().parents[2]
exe=Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
with exe.open('rb') as stream:
    digest=hashlib.file_digest(stream,'sha256').hexdigest()
if digest!='400df27c82ddc845aa9dce79bd468d81f18f060d299cd263e3afa93aef4f7a83':
    raise SystemExit('Unsupported executable; no colony layout generated')
image=pefile.PE(str(exe),fast_load=True).get_memory_mapped_image()
assert image[0x6B5137:0x6B5141]==bytes.fromhex('0fb6462c8881280f0000')
assert image[0x6B8660:0x6B8666]==bytes.fromhex('b8fa2a0000c3')
checks={'enable_byte':(0x6B5137,10),'colony_ref_lookup':(0x6B5106,42),'single_colony_range':(0x6B4ED6,20),'enable_factory':(0x6B9650,77),'enable_token':(0x6B8660,6),'category_array':(0xE66309,32),'category_serialize':(0xE648C5,67),'category_restore':(0xE64A18,19),'category_colony_backlink':(0xE66458,18),'category_string':(0x15BAF9,16)}
definitions=(exe.parent/'common/colony_automation_categories/00_categories.txt').read_bytes()
keys=re.findall(r'^(planet_automation_[a-z0-9_]+)\s*=',definitions.decode('utf-8-sig'),re.MULTILINE)
assert keys and len(set(keys))==len(keys) and len(keys)<=128
header=['#pragma once','#include <cstring>','namespace bridge::colony_query_layout {','inline constexpr uintptr_t Enabled = 0xF28;','inline bool Matches(uintptr_t base) {','    __try {']
for name,(rva,size) in checks.items():
    values=','.join(hex(b) for b in image[rva:rva+size])
    header.extend([f'        static constexpr unsigned char {name}[] = {{{values}}};',f'        if (memcmp((void*)(base+0x{rva:X}),{name},sizeof({name}))) return false;'])
header.extend(['        return true;','    } __except (EXCEPTION_EXECUTE_HANDLER) { return false; }','}','}'])
header[-1:-1]=['inline constexpr const char* CategoryKeys[] = {'+','.join(json.dumps(key) for key in keys)+'};', 'inline constexpr const char* CategoryDefinitionsSha256 = '+json.dumps(hashlib.sha256(definitions).hexdigest())+';']
path=root/'.local/research/stellaris-mcp-native/stellaris_bridge/include/colony_query_layout.hpp'
path.write_text('\n'.join(header)+'\n',encoding='utf-8')
out=Path(__file__).resolve().parents[1]/'.local/hybrid-control/colony-layout-inventory/query-layout-proof.json'
out.write_text(json.dumps({'exeSha256':digest,'scope':'read-only state and serializer category membership; execution semantics and spending control unverified','categoryDefinitionsSha256':hashlib.sha256(definitions).hexdigest(),'categoryKeys':keys,'checks':{k:{'rva':hex(r),'bytes':image[r:r+n].hex()} for k,(r,n) in checks.items()},'commandsIssued':0},indent=2),encoding='utf-8')
print(json.dumps({'header':str(path),'checks':len(checks),'commandsIssued':0}))
