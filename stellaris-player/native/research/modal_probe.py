# SPDX-License-Identifier: GPL-3.0-only
"""Bounded read-only inventory of in-game central view types and UI child names."""
import json,sys
from stellaris_memory_probe import ReadOnlyProcess,number,ProbeError
r=json.loads(sys.stdin.read());m=ReadOnlyProcess(r["pid"],"D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe")
def string(p):
    n=number(m,p+16);cap=number(m,p+24)
    if not 0<n<=512:return ""
    return m.read(p if cap<16 else number(m,p),n).decode("utf-8",errors="replace")
try:
    idler=number(m,m.base+0x3114E68);array=number(m,idler+0x170);count=number(m,idler+0x17C,"<I")
    if count>200:raise ProbeError("modal_array_bounds")
    result=[]
    for i in range(count):
        p=number(m,array+i*8)
        if not p:continue
        row={"id":number(m,p+0x98,"<I"),"view":hex(p),"vtable_rva":hex(number(m,p)-m.base)}
        row["slots"]=[hex(number(m,number(m,p)+i*8)-m.base) for i in range(10)]
        if row["vtable_rva"]=="0x2416e00":
            action=number(m,p+0x4E8)
            row["action_pointer"]=hex(action);row["proposal"]=str(number(m,p+0x4F0))
            if action:
                t=number(m,action+0x40)
                row["action"]={"token":hex(number(m,t+0x50,"<I")),"actor":number(m,action+0x20,"<I"),"recipient":number(m,action+0x24,"<I")}
        ui=number(m,p+0x78)
        if ui:
            keys=number(m,ui+0x710);values=number(m,ui+0x6F8);cnt=number(m,ui+0x71C,"<I")
            if cnt<200 and keys and values:
                controls=[]
                for j in range(cnt):
                    name=string(keys+j*48+16);ctrl=number(m,values+j*8)
                    item={"name":name,"address":hex(ctrl)}
                    if ctrl:
                        item["vtable"]=hex(number(m,ctrl)-m.base)
                        try:item["text"]=string(ctrl+0x168)
                        except ProbeError:pass
                    controls.append(item)
                row["controls"]=controls
        result.append(row)
    print(json.dumps(result,ensure_ascii=False,indent=2))
finally:m.close()
