"""Use the community MIT extractor to identify current Windows action tokens."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / '.local/research/stellaris-mcp-native/tools/sdk_dumper'))
from win_extract import Image, token_names
im = Image(Path(r'D:\SteamLibrary\steamapps\common\Stellaris\stellaris.exe'))
names, fn = token_names(im, set())
Path('.local/native-bridge/windows-tokens.json').write_text(json.dumps(names, indent=2), encoding='utf-8')
for token, name in names.items():
    if any(part in name for part in ('border', 'embassy', 'research_agreement', 'non_aggression', 'improve_relation', 'commercial_pact')):
        print(hex(token), name)
