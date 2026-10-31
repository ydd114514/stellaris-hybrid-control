"""Bounded read-only learned-tech membership for an independently bound country."""
from pathlib import Path
import sys,json,hashlib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native/research'))
from stellaris_memory_probe import ReadOnlyProcess,number,ProbeError,BUILD_SHA256
from colony_ownership_probe import resolve_ref
exe=Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
with exe.open('rb') as f:
    if hashlib.file_digest(f,'sha256').hexdigest()!=BUILD_SHA256:raise ProbeError('unsupported_executable')
m=ReadOnlyProcess(int(sys.argv[1]),str(exe))
def string(p):
    n=number(m,p+16);cap=number(m,p+24)
    if not 0<n<=256:raise ProbeError('technology_key_unknown')
    return m.read(p if cap<16 else number(m,p),n).decode('utf-8')
try:
    country=resolve_ref(m,m.base,0x3114C38,int(sys.argv[2]),0x20)
    status=country+0x1620;data=number(m,status+0x20);count=number(m,status+0x2c,'<I')
    if not 0<count<=2048:raise ProbeError('learned_technology_count_unknown')
    rows=[]
    for i in range(count):
        entry=data+i*0x28;level=number(m,entry+8,'<I');key=string(number(m,entry+0x10)+0x20)
        if not key.startswith('tech_') or level>1000:raise ProbeError('learned_technology_shape_unknown')
        rows.append({'key':key,'level':level})
    report={'readOnly':True,'pid':int(sys.argv[1]),'countryId':int(sys.argv[2]),'count':count,'upgradeTechnology':[r for r in rows if r['key'] in ['tech_colonial_centralization','tech_planetary_unification']],'techKeys':[r['key'] for r in rows]}
    target=Path('.local/hybrid-control/learned-upgrade-tech-live.json');target.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
finally:m.close()
