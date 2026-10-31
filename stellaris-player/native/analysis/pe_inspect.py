"""Read-only analysis of the pinned local Windows game executable. No process calls."""
import argparse
import json
import struct
import bisect
from pathlib import Path
import capstone
import pefile

GAME = Path(r"D:\SteamLibrary\steamapps\common\Stellaris\stellaris.exe")
pe = pefile.PE(str(GAME), fast_load=True)
data = GAME.read_bytes()
base = pe.OPTIONAL_HEADER.ImageBase
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
cs.detail=True

def function_at(address):
    sec=next(s for s in pe.sections if s.Name.rstrip(b'\0')==b'.pdata')
    entries=[]
    for i in range(sec.PointerToRawData, sec.PointerToRawData+sec.SizeOfRawData-11,12):
        start,end,_=struct.unpack_from('<III',data,i)
        if start and end>start: entries.append((start,end))
    entries.sort()
    index=bisect.bisect_right([x[0] for x in entries],address)-1
    start,end=entries[index]
    if not start<=address<end: raise ValueError('No unwind function for address')
    return start,end

def off(rva):
    return pe.get_offset_from_rva(rva)

def rva(offset):
    return pe.get_rva_from_offset(offset)

def matches(needle, start=0, end=None):
    end = len(data) if end is None else end
    while (start := data.find(needle, start, end)) >= 0:
        yield start
        start += 1

def vtables(pattern):
    found = []
    for hit in matches(b'.?AV'):
        end = data.find(b'\0', hit, hit + 350)
        if end < 0:
            continue
        name = data[hit:end].decode('ascii', errors='replace')
        if pattern.lower() not in name.lower():
            continue
        td = rva(hit - 16)
        for ref in matches(struct.pack('<I', td)):
            col = ref - 12
            try:
                sig, adjust, _, _, _, self_rva = struct.unpack_from('<6I', data, col)
                if sig != 1 or rva(col) != self_rva:
                    continue
                for pointer in matches(struct.pack('<Q', base + self_rva)):
                    vt = rva(pointer + 8)
                    slots = [hex(struct.unpack_from('<Q', data, pointer + 8 + i * 8)[0] - base) for i in range(16)]
                    found.append({'type': name, 'vtable': hex(vt), 'this_adjust': adjust, 'slots': slots})
            except (ValueError, struct.error, pefile.PEFormatError):
                continue
    return found

def references(target, kind):
    found = []
    for sec in pe.sections:
        if not sec.Characteristics & 0x20000000:
            continue
        start, end = sec.PointerToRawData, sec.PointerToRawData + sec.SizeOfRawData
        if kind == 'calls':
            for p in matches(b'\xe8', start, end - 5):
                address = rva(p)
                if address + 5 + struct.unpack_from('<i', data, p+1)[0] == target:
                    found.append(hex(address))
        else:
            for prefix in (b'\x48\x8d', b'\x4c\x8d'):
                for p in matches(prefix, start, end - 7):
                    if data[p+2] & 0xc7 != 5:
                        continue
                    address = rva(p)
                    if address + 7 + struct.unpack_from('<i', data, p+3)[0] == target:
                        found.append(hex(address))
    return found

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['disasm', 'vtable', 'type', 'calls', 'refs','strings'])
    parser.add_argument('target')
    parser.add_argument('--bytes', type=lambda x: int(x,0), default=384)
    parser.add_argument('--function',action='store_true')
    args = parser.parse_args()
    if args.mode == 'type':
        print(json.dumps(vtables(args.target), ensure_ascii=False, indent=2))
    else:
        target = int(args.target, 0)
        if args.function:target,_=function_at(target)
        if args.mode == 'disasm':
            for ins in cs.disasm(data[off(target):off(target)+args.bytes], target):
                print(f'{ins.address:08x} {ins.mnemonic:8s} {ins.op_str}')
        elif args.mode == 'vtable':
            print(json.dumps([hex(struct.unpack_from('<Q',data,off(target)+i*8)[0]-base) for i in range(20)],indent=2))
        elif args.mode=='strings':
            start,end=function_at(target)
            print(hex(start),hex(end))
            for ins in cs.disasm(data[off(start):off(start)+end-start],start):
                for operand in ins.operands:
                    if operand.type==capstone.x86.X86_OP_MEM and operand.mem.base==capstone.x86.X86_REG_RIP:
                        address=ins.address+ins.size+operand.mem.disp
                        if address<0x2200000:continue
                        try:
                            raw=data[off(address):off(address)+120].split(b'\0')[0]
                            if len(raw)>2 and all(32<=x<127 for x in raw): print(hex(ins.address),hex(address),raw.decode('ascii'))
                        except Exception:pass
        else:
            print(json.dumps(references(target,args.mode)))
