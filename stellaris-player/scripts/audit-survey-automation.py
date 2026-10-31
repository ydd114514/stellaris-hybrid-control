"""Offline capability inventory. Reads files only; never connects to the game."""
import argparse
import hashlib
import json
import mmap
import re
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--workspace', type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument('--game-exe', type=Path, default=Path('D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe'))
args = parser.parse_args()
root = args.workspace.resolve()
bridge = root / '.local/research/stellaris-mcp-native'
files = {
    'sdk': bridge / 'stellaris_bridge/include/sdk/stellaris_sdk.hpp',
    'ipc': bridge / 'stellaris_bridge/src/ipc_server.cpp',
    'galaxy': bridge / 'stellaris_bridge/src/galaxy_manager.cpp',
    'civilian': bridge / 'stellaris_bridge/src/outliner_manager.cpp',
    'controller': root / 'stellaris-player/src/native-game.mjs',
    'og Automation reference': root / '.local/research/OGAS/src/iag/stellaris/execution/packet/fleet_operation_commands.py',
}
needles = {
    'sdk': ['namespace CAutomateFleetOrder', 'namespace queue_fleet_order_command', 'namespace fleet_cancel_orders', 'namespace set_fleet_automation_default_command'],
    'ipc': ['method == "cancel_fleet_orders"', 'method == "get_civilian_fleets"', 'method == "survey"'],
    'galaxy': ['GalaxyManager::CancelFleetOrders', 'GalaxyManager::SurveyCommand'],
    'civilian': ['OutlinerManager::GetCivilianFleetsJson'],
    'controller': ['export const ORDER_FIELDS', 'async monitorDecision'],
    'og Automation reference': ['def build_ship_automation_record', '"automation_enabled"'],
}
report = {'audit_kind': 'offline_source_inventory', 'runtime_verified': False, 'files': {}}
texts = {}
for key, path in files.items():
    raw = path.read_bytes()
    texts[key] = raw.decode('utf-8')
    lines = texts[key].splitlines()
    report['files'][key] = {
        'path': str(path.relative_to(root)),
        'sha256': hashlib.sha256(raw).hexdigest(),
        'references': {needle: [i for i, line in enumerate(lines, 1) if needle in line] for needle in needles[key]},
    }
orders = texts['controller'].split('export const ORDER_FIELDS = {', 1)[1].split('\n};', 1)[0]
report['controller_order_names'] = re.findall(r'(\w+)\s*:\s*\[', orders)
report['capabilities'] = {
    'single_survey': 'implemented_in_bridge_and_controller',
    'automation_enable': 'order_type_present_no_bridge_wrapper_found',
    'automation_query': 'civilian_status_text_only_structured_state_needed',
    'cancel_fleet_orders': 'bridge_implemented_not_in_controller_order_allowlist',
    'cancel_disables_automation': 'unverified_requires_execute_path_and_runtime_proof',
    'default_settings_command': 'country_default_not_proof_of_per_fleet_enable',
}
with args.game_exe.open('rb') as handle:
    report['game_exe_sha256'] = hashlib.file_digest(handle, 'sha256').hexdigest()
    with mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as binary:
        report['binary_string_file_offsets'] = {
            word: binary.find(word.encode('ascii'))
            for word in ['CAutomateFleetOrder', 'automate_fleet_order', 'AUTOMATION_SURVEY', 'settings_survey']
        }
print(json.dumps(report, ensure_ascii=False, indent=2))
