"""Bounded offline disassembly, including leaf/thunk entries without .pdata.

An RVA comes from the pinned SDK/vtable. This neither loads the bridge nor
invokes any game function. Missing unwind metadata is explicitly identified.
"""
import sys
import capstone
import pefile

pe = pefile.PE('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe', fast_load=True)
pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_EXCEPTION']])
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
for argument in sys.argv[1:]:
    target = int(argument, 16)
    entry = next((e.struct for e in pe.DIRECTORY_ENTRY_EXCEPTION if e.struct.BeginAddress == target), None)
    size = entry.EndAddress - target if entry else 128
    print(f'RVA {target:#x}; extent={"unwind" if entry else "bounded_leaf_or_thunk"}')
    for instruction in decoder.disasm(pe.get_data(target, min(size, 65536)), target):
        print(hex(instruction.address), instruction.mnemonic, instruction.op_str)
        if not entry and instruction.mnemonic in ('ret', 'int3', 'jmp'):
            break
