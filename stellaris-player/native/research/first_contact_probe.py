# SPDX-License-Identifier: GPL-3.0-only
"""Bounded read-only first-contact view/control inventory; never invokes UI."""
import json,sys
from stellaris_memory_probe import ReadOnlyProcess,number,ProbeError
m=ReadOnlyProcess(int(sys.argv[1]),'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
seen=set()
def text(p):
    n=number(m,p+16);cap=number(m,p+24)
    if not 0<n<=3000:return ''
    return m.read(p if cap<16 else number(m,p),n).decode('utf-8',errors='replace')
def walk(p,name,depth=0):
    if not p or p in seen or depth>5 or len(seen)>160:return None
    seen.add(p)
    try:
        vt=number(m,p);row={'name':name,'pointer':hex(p),'vt':hex(vt-m.base),'shown':number(m,p+0x41,'<B')}
        for offset in (0x168,0x268):
            try:
                s=text(p+offset)
                if s:row[hex(offset)]=s
            except ProbeError:pass
        keys=number(m,p+0x710);values=number(m,p+0x6F8);count=number(m,p+0x71C,'<I')
        children=[]
        if keys and values and 0<count<180:
            for i in range(count):
                child=walk(number(m,values+i*8),text(keys+i*48+16),depth+1)
                if child:children.append(child)
        arr=number(m,p+0x878);count=number(m,p+0x884,'<I')
        if arr and 0<count<40:
            for i in range(count):
                child=walk(number(m,arr+i*8),'#'+str(i),depth+1)
                if child:children.append(child)
        if children:row['children']=children
        return row
    except ProbeError:return None
try:
    idler=number(m,m.base+0x3114E68);view=number(m,idler+0xC90)
    if number(m,view)!=m.base+0x2412070:raise ProbeError('Unexpected first contact view')
    extra=[]
    reports=[]
    box=number(m,view+0xD8);node=number(m,box+0x100)
    for _ in range(12):
        if not node:break
        entry=number(m,node)
        item={'entry':hex(entry),'vt':hex(number(m,entry)-m.base),'fields':{}}
        for o in (8,0x28,0xD0,0xD8,0xE0):
            p=number(m,entry+o)
            row={'pointer':hex(p)}
            try:
                row['vt']=hex(number(m,p)-m.base)
                for t in (0x168,0x268,0x12E8):
                    try:
                        s=text(p+t)
                        if s:row[hex(t)]=s
                    except ProbeError:pass
            except ProbeError:pass
            item['fields'][hex(o)]=row
        reports.append(item);node=number(m,node+0x10)
    for i in (0xB0,0xD8,0xE0,0xE8):
        p=number(m,view+i)
        try:
            extra.append({'viewOffset':hex(i),'pointer':hex(p),'vt':hex(number(m,p)-m.base),'words':{hex(o):hex(number(m,p+o)) for o in range(0x850,0x9F0,8)}})
        except ProbeError:pass
    print(json.dumps({'view':hex(view),'viewPointers':{hex(i):hex(number(m,view+i)) for i in range(0x80,0x180,8)},'reports':reports,'extras':extra,'controls':walk(number(m,view+0x78),'root')},ensure_ascii=False,indent=2))
finally:m.close()
