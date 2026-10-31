"""Verify the normal startup continue path; never call game code."""
from pathlib import Path
import hashlib,json,struct
import pefile
exe=Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
with exe.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
assert digest=='400df27c82ddc845aa9dce79bd468d81f18f060d299cd263e3afa93aef4f7a83','Unsupported EXE'
image=pefile.PE(str(exe),fast_load=True).get_memory_mapped_image()
assert image[0x23A2980:0x23A2980+18]==b'-continuelastsave\0'
assert image[0x23AA840:0x23AA840+19]==b'continue_game.json'+bytes([0])
assert image[0x8BAA7C:0x8BAA7F]==bytes.fromhex('488d15')
assert 0x8BAA7C+7+struct.unpack_from('<i',image,0x8BAA7F)[0]==0x23A2980
assert image[0x8BAC88]==0xE8 and 0x8BAC88+5+struct.unpack_from('<i',image,0x8BAC89)[0]==0x973800
report={'exeSha256':digest,'normalStartupFlag':'-continuelastsave','record':'continue_game.json','flagReferenceRva':'0x8BAA7C','recordReaderRva':'0x973800','readerCallFromFlagBranch':'0x8BAC88','runtimeValidated':False,'rawFunctionCallsIssued':0,'limitations':'Static startup argument and JSON-reader branch only; actual selected save, pause and fingerprint must be read back after launch.'}
out=Path(__file__).resolve().parents[1]/'.local/hybrid-control/continue-loader/startup-proof.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
