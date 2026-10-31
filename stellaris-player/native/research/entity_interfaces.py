# SPDX-License-Identifier: GPL-3.0-only
"""Read-only check of own celestial interfaces; never invokes their functions."""
import json,sys
from stellaris_memory_probe import ReadOnlyProcess,number,ProbeError
memory=ReadOnlyProcess(int(sys.argv[1]),'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
try:
    for name,db,identifier,id_offset in [('planet',0x3114E10,3,0x18),('system',0x3114E30,0,8)]:
        mgr=number(memory,memory.base+db); arr=number(memory,mgr+0x18)
        obj=number(memory,arr+(identifier&0xffffff)*16+8)
        if number(memory,obj+id_offset,'<I')!=identifier:raise ValueError('entity generation mismatch')
        for offset in range(0,0x200,8):
            try:
                vt=number(memory,obj+offset)
                if not memory.base+0x2200000<=vt<memory.base+0x28a0000:continue
                fn=number(memory,vt+5*8); code=memory.read(fn,16)
                print(name,hex(offset),hex(vt-memory.base),hex(fn-memory.base),code.hex())
            except (OSError,ValueError,ProbeError):pass
finally:memory.close()
