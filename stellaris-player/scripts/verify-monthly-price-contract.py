from pathlib import Path
import hashlib,json
import pefile
root=Path(__file__).resolve().parents[1]
exe=Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe')
with exe.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
assert digest=='400df27c82ddc845aa9dce79bd468d81f18f060d299cd263e3afa93aef4f7a83'
image=pefile.PE(str(exe),fast_load=True).get_memory_mapped_image()
predicate=image[0x8F4F30:0x8F4F30+362]
assert hashlib.sha256(predicate).hexdigest()=='f323cce15be2160aa619cca3a12b0173627268daa1ce8b499016ad8e1612e318'
report={'exeSha256':digest,'predicateRva':'0x8F4F30','predicateSize':len(predicate),'predicateSha256':hashlib.sha256(predicate).hexdigest(),'monthlyPassRva':'0x8F50A0','amountOffset':'0x20','limitOffset':'0x24','limitProductType':'signed_int32','quoteIncludesFee':True,'quoteQuantityScale':100000,'rounding':'ceil_to_whole_currency','buyPredicate':'ceil(engine_fee_inclusive_quote)<=amount*limit; zero limit maps to INT32_MAX','sellPredicate':'ceil(engine_fee_inclusive_quote)>=amount*limit','runtimeValidated':False,'commandsIssued':0,'limitations':['Exact-build static branch and rounding evidence; price eligibility does not prove funds/stock availability, settlement or future prices.']}
file=root/'.local/monthly-price-contract-verified.json';file.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps({'file':str(file),'predicateVerified':True,'commandsIssued':0}))
