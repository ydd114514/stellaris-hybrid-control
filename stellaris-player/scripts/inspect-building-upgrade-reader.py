"""Disassemble bounded pinned PE functions involved in upgrade deserialization."""
import pefile,capstone
pe=pefile.PE('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe',fast_load=True)
pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_EXCEPTION']])
cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
start=next(e.struct.BeginAddress for e in pe.DIRECTORY_ENTRY_EXCEPTION if e.struct.BeginAddress<=0x468f0b<e.struct.EndAddress)
target=int(__import__('sys').argv[1],16) if len(__import__('sys').argv)>1 else 0x4676c0
end=next(e.struct.EndAddress for e in pe.DIRECTORY_ENTRY_EXCEPTION if e.struct.BeginAddress==target)
for rva,size in [(target,end-target)]:
    print('RVA',hex(rva))
    for i in cs.disasm(pe.get_data(rva,size),rva):
        print(hex(i.address),i.mnemonic,i.op_str)
