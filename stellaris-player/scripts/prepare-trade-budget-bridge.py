"""Snapshot a built local candidate; never inject, restart or load a game."""
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root.parent / '.local/research/stellaris-mcp-native'
version = 'cyberfish-0.6.12-trade-budget-r1'
target = root / '.local/native-bridge/runtime' / version
built = root / '.local/native-bridge/build/stellaris_bridge/Release/stellaris_bridge.dll'
assert built.is_file()
assert not target.exists(), 'Candidate snapshot is immutable; choose a new revision instead of overwriting.'
target.mkdir(parents=True)
shutil.copy2(built, target / 'stellaris_bridge.dll')
paths = ['stellaris_bridge/include/game_state.hpp', 'stellaris_bridge/include/market_spending_policy.hpp', 'stellaris_bridge/src/game_state.cpp', 'stellaris_bridge/src/market_manager.cpp', 'stellaris_bridge/src/ipc_server.cpp']
for name in paths:
    path = target / 'source' / name
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / name, path)
shutil.copy2(root / '.local/native-trade-budget-r1-build.log', target / 'build.log')
shutil.copy2(root / '.local/native-trade-budget-r1-final-build.log', target / 'final-build.log')
digest = hashlib.sha256(built.read_bytes()).hexdigest()
data = {'version': version, 'dllSha256': digest, 'preparedAt': datetime.now(timezone.utc).isoformat(), 'runtimeValidated': False, 'productionDefault': False,
        'sourceHashes': {p: hashlib.sha256((source / p).read_bytes()).hexdigest() for p in paths},
        'offlineEvidence': {'nativePolicy': '.local/native-market-policy-tests/Testing/Temporary/LastTest.log', 'adapterTests': {'passed': 33, 'log': '.local/trade-budget-bridge-adapter-tests.log'}},
        'knownFailure': '.local/trade-budget-acceptance-1793416465545/report.json',
        'notes': ['Old0.6.11 rejected actual mineral surplus due to internal legacy reserve. No trade posted.', 'No new engine calls or memory offsets; expense_known now distinguishes actual zero from failed reads.', 'One genuine restart/load and a paused single-transaction acceptance remain before promotion.']}
(target / 'candidate.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'candidate': str(target), 'dllSha256': digest}))
