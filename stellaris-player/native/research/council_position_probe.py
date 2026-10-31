# SPDX-License-Identifier: GPL-3.0-only
"""Corroborate the exact council database/null-object globals used by IsValid."""
import json,sys
from stellaris_memory_probe import ReadOnlyProcess,number,ProbeError
r=json.loads(sys.stdin.read());m=ReadOnlyProcess(r["pid"],"D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe")
try:
    result=[]
    for rva in (0x3114220,0x3114BA8):
        p=number(m,m.base+rva);row={"rva":hex(rva),"pointer":hex(p)}
        if p:
            count=number(m,p+0x20,"<I");data=number(m,p+0x18);row["count"]=count
            if 0<count<=4096 and data:
                row["positions"]=[]
                for slot in range(count):
                    pos=number(m,data+slot*16+8)
                    if not pos:continue
                    owner=number(m,pos+0x18,"<I")
                    if owner==0:row["positions"].append({"slot":slot,"id":number(m,pos+8,"<I"),"country":owner,"leader":number(m,pos+0x1C,"<I")})
        result.append(row)
    print(json.dumps(result,ensure_ascii=False,indent=2))
finally:m.close()
