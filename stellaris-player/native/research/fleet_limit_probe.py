# SPDX-License-Identifier: GPL-3.0-only
"""Read-only corroboration of the native reinforcement command's capacity fields."""
import json,sys
from stellaris_memory_probe import ReadOnlyProcess,resolve_fleet,number
r=json.loads(sys.stdin.read())
m=ReadOnlyProcess(r["pid"],"D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe")
try:
    result=[]
    for identifier in r["fleets"]:
        p=resolve_fleet(m,m.base,identifier)
        if p:result.append({"fleet_id":identifier,"current_naval_size_raw":number(m,p+0x1288,"<q")})
    print(json.dumps(result))
finally:m.close()
