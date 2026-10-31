"""Inspect one colony's automation serializer layout; never enable automation."""
from pathlib import Path
import sys, json, struct, hashlib, re
import pefile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native/research'))
from stellaris_memory_probe import ReadOnlyProcess, number, ProbeError
from colony_ownership_probe import owned_colony_relationship
from colony_settings_probe import colony_category_membership
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--pid', type=int, required=True)
parser.add_argument('--colony-id', type=int, required=True)
parser.add_argument('--planet-id', type=int)
parser.add_argument('--country-id', type=int)
parser.add_argument('--settings', action='store_true', help='Read serializer-backed category list; requires ownership arguments')
args=parser.parse_args()
if args.settings and args.planet_id is None:raise SystemExit('settings requires planet-id and country-id')
if (args.planet_id is None)!=(args.country_id is None):raise SystemExit('planet-id and country-id must be supplied together')
exe=Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
with exe.open('rb') as stream:
    if hashlib.file_digest(stream,'sha256').hexdigest()!='400df27c82ddc845aa9dce79bd468d81f18f060d299cd263e3afa93aef4f7a83':
        raise ProbeError('unsupported_executable')
memory=ReadOnlyProcess(args.pid, str(exe))
try:
    expected=bytes.fromhex('0fb6462c8881280f0000')
    if memory.read(memory.base+0x6B5137,len(expected))!=expected:raise ProbeError('colony_enable_execute_fingerprint_mismatch')
    database=number(memory,memory.base+0x3114E28)
    count=struct.unpack('<I',memory.read(database+0x20,4))[0]
    index=args.colony_id&0xffffff
    if not 0<=args.colony_id<0xffffffff or index>=count:raise ProbeError('colony_ref_out_of_range')
    table=number(memory,database+0x18)
    colony=number(memory,table+index*16+8)
    if struct.unpack('<I',memory.read(colony+0x10,4))[0]!=args.colony_id:raise ProbeError('colony_ref_generation_mismatch')
    wrapper=number(memory,colony+0xF00)
    serializer=number(memory,wrapper+8)
    relationship=owned_colony_relationship(memory,memory.base,args.planet_id,args.country_id,args.colony_id) if args.planet_id is not None else None
    enabled=memory.read(colony+0xF28,1)[0]
    if enabled not in (0,1):raise ProbeError('automation_enabled_byte_unknown')
    report={'pid':args.pid,'colonyId':args.colony_id,'readOnly':True,'commandsIssued':0,
            'wrapperVtableRva':hex(wrapper-memory.base),'serializerThunkRva':hex(serializer-memory.base),
            'observedEnabledByte':enabled,'colonyEnabledOffsetCandidate':'0xF28',
            'ownershipVerified':False,'apiCertified':False,
            'limitations':'No ownership, budget, scope, enable or disable dynamic acceptance is implied by this layout probe.'}
    if relationship:
        report['relationship']=relationship
        report['limitations']='Ownership is corroborated only relative to the supplied country; the caller must independently bind the local player. Budget, settings, candidate DLL runtime and enable/disable acceptance remain unverified.'
    if args.settings:
        # Read instructions from the pinned on-disk image and compare loaded code.
        pe=pefile.PE(str(exe),fast_load=True)
        for rva,size in [(0xE66309,0x20),(0xE648C5,0x43),(0xE64A18,0x13),(0xE66458,0x12),(0x15BAF9,0x10)]:
            if memory.read(memory.base+rva,size)!=pe.get_data(rva,size):raise ProbeError('category_layout_runtime_fingerprint_mismatch')
        definition_bytes=(exe.parent/'common/colony_automation_categories/00_categories.txt').read_bytes()
        definitions=definition_bytes.decode('utf-8-sig')
        known_keys=set(re.findall(r'^(planet_automation_[a-z0-9_]+)\s*=',definitions,re.MULTILINE))
        if not known_keys:raise ProbeError('local_category_definitions_unknown')
        report['categoryMembership']=colony_category_membership(memory,colony,known_keys)
        report['categoryMembership']['definitionsSha256']=hashlib.sha256(definition_bytes).hexdigest()
        report['limitations']+=' Category list membership is serializer-backed; effective mod configuration, execution policy and spending guarantees remain unverified.'
    name='live-readonly-relative-country-settings.json' if args.settings else ('live-readonly-relative-country.json' if relationship else 'live-readonly.json')
    out=Path(__file__).resolve().parents[1]/'.local/hybrid-control/colony-layout-inventory'/name
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))
finally:memory.close()
