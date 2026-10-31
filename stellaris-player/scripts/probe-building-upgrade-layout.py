"""Read only the pinned building definition upgrade arrays; never call game code."""
import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native/research'))
from stellaris_memory_probe import ReadOnlyProcess,number,ProbeError,BUILD_SHA256
exe=Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
with exe.open('rb') as stream:
    if hashlib.file_digest(stream,'sha256').hexdigest()!=BUILD_SHA256:raise ProbeError('unsupported_executable')
m=ReadOnlyProcess(int(sys.argv[1]),str(exe))
def string(p):
    n=number(m,p+16);cap=number(m,p+24)
    if not 0<n<=512:raise ProbeError('definition_key_unknown')
    return m.read(p if cap<16 else number(m,p),n).decode('utf-8')
try:
    db=number(m,m.base+0x31128E0);data=number(m,db+0x50);count=number(m,db+0x5c,'<I')
    if not 0<count<=10000:raise ProbeError('definition_count_unknown')
    rows=[]
    for i in range(count):
        p=number(m,data+i*8)
        if not p:continue
        key=string(p+0x20);arr=p+0x4c8
        ptr=number(m,arr+8);n=number(m,arr+0x14,'<I')
        if key in ['building_colony_shelter','building_capital']:
            vt=number(m,p)
            if n>32 or n and not ptr:raise ProbeError('upgrade_array_bounds')
            rows.append({'key':key,'vtableRva':hex(vt-m.base),'parserInterfaceVtableRva':hex(number(m,p+0x40)-m.base),'count':n,'upgradeKeys':[string(ptr+j*0x30+0x10) for j in range(n)],'arrayBytes':m.read(arr,24).hex()})
    report={'readOnly':True,'pid':int(sys.argv[1]),'definitionCount':count,'parserFieldInstruction':m.read(m.base+0x468f0b,15).hex(),'selectedArrays':rows}
    out=Path('.local/hybrid-control/building-upgrade-layout-live.json');out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))
finally:m.close()
