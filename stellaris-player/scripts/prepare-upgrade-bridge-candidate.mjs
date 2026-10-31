// Local immutable candidate, never an installer/archive or a game loader.
import {mkdir,readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {UPGRADE_PATH_BRIDGE_VERSION} from '../src/bridge-capabilities.mjs';
const root=resolve('.'),source=resolve(root,'../.local/research/stellaris-mcp-native');
const target=resolve(root,'.local/native-bridge/runtime',UPGRADE_PATH_BRIDGE_VERSION);
const dll=resolve(root,'.local/native-bridge/build/stellaris_bridge/Release/stellaris_bridge.dll');
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const proof=JSON.parse(await readFile(resolve(source,'docs/construction-layout-proof-20261029.json'),'utf8'));
if(proof.buildingTypeUpgradesArray.base!==0x4c8||proof.buildingTypeUpgradesArray.stride!==48||proof.buildingTypeUpgradesArray.stringOffset!==16)throw Error('Missing corrected static proof');
const dllSha256=await hash(dll),manifest={version:UPGRADE_PATH_BRIDGE_VERSION,dllSha256,preparedAt:new Date().toISOString(),runtimeValidated:false,productionDefault:false,sourceHashes:{},staticProof:proof,notes:['Parser interface at complete-object +0x40; upgrades are CStringToken records, not pointers.','No hot replacement, game restart or loading is performed by this preparation script.']};
try{await stat(target);throw Error('Candidate directory already exists; do not overwrite an immutable candidate');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(target,{recursive:true});await copyFile(dll,resolve(target,'stellaris_bridge.dll'));
for(const f of ['stellaris_bridge/src/outliner_manager.cpp','stellaris_bridge/src/ipc_server.cpp','stellaris_bridge/include/cyberfish_construction_layout.hpp','tools/verify_construction_layout.py','docs/construction-layout-proof-20261029.json']){
 const dest=resolve(target,'source',f);await mkdir(dirname(dest),{recursive:true});await copyFile(resolve(source,f),dest);manifest.sourceHashes[f]=await hash(dest);
}
await copyFile(resolve(root,'.local/native-upgrade-paths-r1-build.log'),resolve(target,'build.log'));
await writeFile(resolve(target,'candidate.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({target,dllSha256,runtimeValidated:false,productionDefault:false}));
