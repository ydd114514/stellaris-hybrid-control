"""Inspect pinned startup state without invoking a loader or exposing save names."""
from pathlib import Path
import sys,json,hashlib,struct,argparse
import pefile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native/research'))
from native_session import inspect
from stellaris_memory_probe import ReadOnlyProcess,ProbeError,BUILD_SHA256
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--pid',type=int,required=True)
parser.add_argument('--creation-time',required=True)
a=parser.parse_args()
identity=inspect({'op':'bridge_module','pid':a.pid,'creationTime':a.creation_time})
exe=Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
with exe.open('rb') as f:
 if hashlib.file_digest(f,'sha256').hexdigest()!=BUILD_SHA256:raise ProbeError('unsupported_executable')
pe=pefile.PE(str(exe),fast_load=True)
# RIP-relative operands verified from the actual startup instructions, not guessed globals.
regions=[(0x8BAA44,7),(0x8BAB47,7),(0x8BACBD,7),(0x8BACC9,7)]
image=pe.get_memory_mapped_image()
def target(rva):
 offset=3 if rva==0x8BACBD else 2
 expected=bytes.fromhex('488d0d') if offset==3 else bytes.fromhex('c605') if rva==0x8BACC9 else bytes.fromhex('803d')
 if image[rva:rva+len(expected)]!=expected:raise ProbeError('startup_operand_encoding_changed')
 return rva+7+struct.unpack_from('<i',image,rva+offset)[0]
with_memory=ReadOnlyProcess(a.pid,str(exe))
try:
 for rva,size in regions:
  if with_memory.read(with_memory.base+rva,size)!=image[rva:rva+size]:raise ProbeError('startup_instruction_changed')
 def byte(rva):return with_memory.read(with_memory.base+target(rva),1)[0]
 obj=with_memory.base+target(0x8BACBD)
 header=with_memory.read(obj,0x30)
 size,capacity=struct.unpack_from('<QQ',header,0x20)
 if size>512 or capacity<size or capacity>1048576:raise ProbeError('pending_save_string_unknown')
 ptr=struct.unpack_from('<Q',header,0x10)[0] if capacity>=16 else obj+0x10
 value=with_memory.read(ptr,size) if size else b''
 report={'identity':identity,'readOnly':True,'commandsIssued':0,'startupOnceMarker':byte(0x8BAA44),'recordBranchByte':byte(0x8BAB47),'pendingLoadFlag':byte(0x8BACC9),'pendingPathLength':size,'pendingPathIsBenchmark':value in (b'save games/4_-1439839595/cyberfish_hybrid_baseline_2202.07.01',b'save games/4_-1439839595/cyberfish_hybrid_baseline_2202.07.01.sav'),'runtimeLoadValidated':False,'limitations':'Point-in-time startup globals; a processed argument or pending path does not prove world loading. Branch-byte semantics beyond observed dispatch are not certified.'}
 # Bind identity again after reading. No save path or raw process address is logged.
 inspect({'op':'bridge_module','pid':a.pid,'creationTime':a.creation_time})
 out=Path('.local/hybrid-control/continue-loader/startup-live-state.json')
 out.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
finally:with_memory.close()
