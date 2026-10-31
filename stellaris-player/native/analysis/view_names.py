"""Identify GUI views from their native constructor's own window-name string."""
import json,sys,struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'.local/research/stellaris-mcp-native/tools/sdk_dumper'))
from win_extract import Image
im=Image(Path(r'D:\SteamLibrary\steamapps\common\Stellaris\stellaris.exe'))
views=json.loads(Path('.local/native-bridge/gui-views.json').read_text(encoding='utf-8'))
index=im.lea_index()
for view in views:
    names=set()
    for reference in index.get(int(view['vtable'],0),[]):
        f=im.primary(im.fn_of(reference))
        for ins in im.disasm_fn(f,0x5000):
            address=im.rip_target(ins)
            if address is None or not im.rdata0<=address<im.rdata1:continue
            text=im.cstr(address)
            if len(text)<80 and any(x in text for x in ('_view','_window','planet_view')) and all(32<=ord(c)<127 for c in text):names.add(text)
    view['names']=sorted(names)
Path('.local/native-bridge/gui-view-names.json').write_text(json.dumps(views,indent=2),encoding='utf-8')
for view in views:
    if view['names']: print(view['offset'],view['vtable'],view['names'])
