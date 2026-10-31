# SPDX-License-Identifier: GPL-3.0-only
import sys,json,re
from pathlib import Path
from stellaris_memory_probe import ReadOnlyProcess,number,resolve_fleet,ProbeError
m=ReadOnlyProcess(int(sys.argv[1]),'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
sdk=Path('../.local/research/stellaris-mcp-native/stellaris_bridge/include/sdk/stellaris_sdk.hpp').read_text(encoding='utf-8')
def lookup(kind,identifier):
    db=int(re.search(r'uintptr_t '+kind+r' = (0x[0-9A-F]+);',sdk).group(1),16)
    manager=number(m,m.base+db);array=number(m,manager+0x18)
    return number(m,array+(identifier&0xffffff)*16+8)
try:
    fleet=resolve_fleet(m,m.base,3); template=lookup('CFleetTemplate',number(m,fleet+0x3d0,'<I'))
    arr=number(m,template+0x28);count=number(m,template+0x34,'<I')
    print('template',[{'at28':number(m,arr+i*0x560+0x28,'<I'),'at550':number(m,arr+i*0x560+0x550,'<I'),'at554':number(m,arr+i*0x560+0x554,'<I'),'quota':number(m,arr+i*0x560+0x558,'<I')} for i in range(min(count,10))])
    arr=number(m,fleet+0x320); count=number(m,fleet+0x32c,'<I')
    rows=[]
    for i in range(min(count,30)):
        identifier=number(m,arr+i*4,'<I');ship=lookup('CShip',identifier)
        if number(m,ship+0x18,'<I')!=identifier:continue
        rows.append({'ship':identifier,'at460':number(m,ship+0x460,'<I'),'at988':number(m,ship+0x988,'<I'),'at98c':number(m,ship+0x98c,'<I')})
    print('ships',rows)
finally:m.close()
