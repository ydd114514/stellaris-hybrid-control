"""Read-only Windows 4.5.2 construction anchors. Never calls the process."""
from pe_inspect import *
out=Path(".local/native-bridge/analysis/construction")
out.mkdir(parents=True,exist_ok=True)
tokens=json.loads(Path(".local/native-bridge/windows-tokens.json").read_text(encoding="utf-8"))
report={}
for token,name in tokens.items():
    if name not in ["buildable_starbase_upgrade","buildable_starbase_module","buildable_starbase_building","buildable_planet_upgrade_building"]:continue
    getters=[rva(p) for p in matches(b"\xb8"+struct.pack("<I",int(token))+b"\xc3")]
    candidates=[]
    for g in getters:
        for p in matches(struct.pack("<Q",base+g)):
            vt=rva(p)-16*8
            try:slots=[struct.unpack_from("<Q",data,off(vt)+i*8)[0]-base for i in range(21)]
            except Exception:continue
            if slots[2]!=0x1af8d0 or slots[3]!=0x1af8d0:continue
            candidates.append({"vtable":hex(vt),"slots":[hex(x) for x in slots]})
            for i,fn in enumerate(slots[:18]):
                try:a,b=function_at(fn)
                except Exception:a,b=fn,fn+32
                code=data[off(a):off(a)+min(b-a,8000)]
                lines=[f"{x.address:08x} {x.mnemonic:8s} {x.op_str}" for x in cs.disasm(code,a)]
                (out/(name+"-"+str(i)+".asm")).write_text("\n".join(lines),encoding="utf-8")
    report[name]={"token":hex(int(token)),"candidates":candidates}
(out/"anchors.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report,indent=2))
