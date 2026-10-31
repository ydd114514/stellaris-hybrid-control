# SPDX-License-Identifier: GPL-3.0-only
"""Read-only inventory of the exact-build game's GUI views for presentation work."""
import json
import sys
from stellaris_memory_probe import ReadOnlyProcess, number, ProbeError

def text(memory, address):
    size=number(memory,address+16); capacity=number(memory,address+24)
    if size<1 or size>160: return ''
    data=memory.read(address if capacity<16 else number(memory,address),size)
    return data.decode('utf-8',errors='replace')

if __name__=='__main__':
    memory=ReadOnlyProcess(int(sys.argv[1]),'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
    rows=[]
    try:
        idler=number(memory,memory.base+0x3114E68)
        for offset in range(0x900,0x1100,8):
            try:
                view=number(memory,idler+offset); vt=number(memory,view)
                if not memory.base+0x2200000<=vt<memory.base+0x28a0000: continue
                ui=number(memory,view+0x78)
                ui_vt=number(memory,ui)
                if not memory.base+0x2200000<=ui_vt<memory.base+0x28a0000: continue
                names=number(memory,ui+0x710); count=number(memory,ui+0x71c,'<I')
                keys=[]
                if count<150:
                    for i in range(min(count,12)):
                        try: keys.append(text(memory,names+i*48+16))
                        except (ProbeError,ValueError): pass
                rows.append({'offset':hex(offset),'vtable':hex(vt-memory.base),'shown':number(memory,ui+0x41,'<B'),'keys':keys})
            except (ProbeError,OSError,ValueError): pass
        print(json.dumps(rows,ensure_ascii=False,indent=2))
    finally:memory.close()
