"""Static command contract from pinned EXE and SDK; never calls game functions."""
from pathlib import Path
import hashlib,json,re,struct
import pefile
root=Path(__file__).resolve().parents[2]
exe=Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
with exe.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
assert digest=='400df27c82ddc845aa9dce79bd468d81f18f060d299cd263e3afa93aef4f7a83','Unsupported executable'
pe=pefile.PE(str(exe),fast_load=True);image=pe.get_memory_mapped_image();base=pe.OPTIONAL_HEADER.ImageBase
sdk=root/'.local/research/stellaris-mcp-native/stellaris_bridge/include/sdk/stellaris_sdk.hpp'
text=sdk.read_text(encoding='utf-8');body=re.search(r'namespace set_automated_development_command \{(.*?)\n\}',text,re.S).group(1)
constants={'kToken':0x2AFA,'kVtableRva':0x23919F0,'kFactoryRva':0x6B9650,'kSize':0x30,'country':0x24,'colony':0x20,'automated_development':0x2C,'range':0x28}
for name,value in constants.items():
 match=re.search(r'\b'+name+r'\s*=\s*(0x[0-9a-fA-F]+)',body)
 assert match and int(match.group(1),16)==value,name
assert struct.unpack_from('<Q',image,0x23919F0+8*8)[0]-base==0x6B5150
assert struct.unpack_from('<Q',image,0x23919F0+9*8)[0]-base==0x6B4ED0
assert image[0x6B8660:0x6B8666]==bytes.fromhex('b8fa2a0000c3')
assert image[0x6B9654:0x6B9659]==bytes.fromhex('b930000000')
assert image[0x6B5137:0x6B5141]==bytes.fromhex('0fb6462c8881280f0000')
# Scope dispatch: 0 -> single; 1 -> filtered owned list; 2 -> all.
# The filtered grouping field is observed, but its sector meaning is not certified.
assert image[0x6B4ED6:0x6B4EE4]==bytes.fromhex('8b5128488bf185d20f8416020000')
regions={'scope_dispatch':(0x6B4ED6,32),'single_colony_execute':(0x6B50FA,77),'is_valid':(0x6B5150,0x1DF),'factory':(0x6B9650,77),'token':(0x6B8660,6)}
report={'exeSha256':digest,'sdkSha256':hashlib.sha256(sdk.read_bytes()).hexdigest(),'command':'sdk::cmd::set_automated_development_command','constants':{k:hex(v) for k,v in constants.items()},'scopeBranches':{'0':'single_colony','1':'owned_colonies_filtered_by_carrier_result_field_0x584','2':'all_owned_colonies'},'filteredScopeSectorSemanticsVerified':False,'adapterRequiredScope':0,'validationSlot':8,'executionSlot':9,'enabledByteOffset':'0xF28','singleExecuteCancelsExistingConstruction':False,'budgetFieldInThisCommand':False,'globalBudgetAvailabilityVerified':False,'runtimeValidated':False,'apiCertified':False,'commandsIssued':0,'regions':{name:{'rva':hex(rva),'bytes':image[rva:rva+size].hex()} for name,(rva,size) in regions.items()},'limitations':['Static layout and branch evidence only; normal submission, readback, spending and queued-work cancellation still need runtime acceptance.','No budget field in this command does not prove the engine has no other budget mechanism.']}
out=Path(__file__).resolve().parents[1]/'.local/hybrid-control/colony-layout-inventory/command-contract.json';out.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({'file':str(out),'sdkCommandReusable':True,'runtimeValidated':False,'commandsIssued':0}))
