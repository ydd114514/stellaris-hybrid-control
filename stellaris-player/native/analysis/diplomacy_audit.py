"""Record reviewed function bodies and the factory token branch for diplomacy."""
from pe_inspect import *
out = Path('.local/native-bridge/analysis')
out.mkdir(parents=True, exist_ok=True)
for name, target, size in [('action_factory', 0x9a9860, 0xf90), ('action_ctor',0x93f6f0,0x130), ('proposal_valid',0x9d5e90,0x30), ('proposal_exec',0x9d5d80,0x4b), ('quota_exec',0x1d17f70,0xa0), ('quota_clone',0x15b0b20,0x100)]:
    lines=[f'{i.address:08x} {i.mnemonic:8s} {i.op_str}' for i in cs.disasm(data[off(target):off(target)+size],target)]
    (out/(name+'.asm')).write_text('\n'.join(lines),encoding='utf-8')
print(out)
