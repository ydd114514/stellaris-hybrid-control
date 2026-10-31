import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { observeSave } from '../src/save-observer.mjs';

const temp = await mkdtemp(join(tmpdir(), 'stellaris-observer-test-'));
after(() => rm(temp, { recursive: true, force: true }));
const parserPath = join(temp, 'fixture-parser.mjs');
await writeFile(parserPath, `
import { readFile, appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
const args = process.argv.slice(2);
if (args[0] !== 'serve' || args[1] !== '--path' || args.length !== 3) process.exit(20);
const savePath = args[2];
const state = JSON.parse(await readFile(savePath, 'utf8'));
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (state._trace) await appendFile(state._trace, JSON.stringify(request) + '\\n');
  if (state._fail) { console.log(JSON.stringify({ok:false,error:'ParseError',message:'FOREIGN_SECRET_DIAGNOSTIC'})); continue; }
  if (state._change && request.op === 'get_entries') await appendFile(savePath, ' ');
  if (request.op === 'extract_sections') {
    const data = {game:'stellaris',schema_version:1,tool_version:'test'};
    for (const key of request.sections) if (Object.hasOwn(state,key)) data[key]=state[key];
    console.log(JSON.stringify({ok:true,data}));
  } else if (request.op === 'get_entries') {
    const entries=[];
    for (const key of request.keys) {
      const value=state[request.section]?.[key];
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry={_key:key};
      for (const field of request.fields || []) if(Object.hasOwn(value,field)) entry[field]=value[field];
      entries.push(entry);
    }
    console.log(JSON.stringify({ok:true,entries}));
  } else process.exit(21);
}
`, 'utf8');

let sequence = 0;
async function fixture(state) {
  const savePath = join(temp, `fixture-${sequence++}.sav`);
  await writeFile(savePath, JSON.stringify(state));
  return savePath;
}
function sample() {
  return {
    meta: { version: 'Cygnus v4.5.1', date: '2200.01.01', name: 'Home Empire' },
    player: [{ country: '0', name: 'Human' }],
    country: {
      0: {
        name: 'Home Empire', owned_planets: ['0'],
        modules: { standard_economy_module: { resources: { energy: '123.5', minerals: '0' } }, standard_diplomacy_module: { hidden: 'FOREIGN_SECRET' } },
        budget: { current_month: { income: { stations: { energy: '10' }, jobs: { energy: '2' } }, expenses: { upkeep: { energy: '3' } } } },
        fleets_manager: { owned_fleets: [{ fleet: '2' }] },
        tech_status: { physics_queue: [{ technology: 'tech_lasers_1', progress: '0' }], society_queue: [], engineering_queue: [], alternatives: { physics: ['tech_shields_1'], society: [], engineering: [] }, potential: { FUTURE_HIDDEN_TECH: 1 } },
      },
      9: { name: 'FOREIGN_SECRET', owned_planets: ['999'], modules: { energy: 999999 } },
    },
    colony: { 0: { carrier: { type: 'planet', reference: '7' }, stability: '50', num_sapient_pops: '1250', buildings_cache: ['3'], districts: ['4'] }, 999: { name: 'FOREIGN_SECRET' } },
    planets: { planet: { 0: { name: 'WRONG_STAR', planet_class: 'pc_g_star' }, 7: { name: 'Earth', planet_class: 'pc_continental', planet_size: '16', owner: '0' }, 999: { name: 'UNEXPLORED_SECRET', owner: '9' } } },
    fleet: { 2: { name: 'Science One', ship_class: 'shipclass_science_ship', ships: ['15'], military_power: '0', movement_manager: { coordinate: { origin: '1' }, state: 'move_idle' } }, 8: { name: 'FOREIGN_SECRET', ships: ['22'] } },
    galactic_object: { 999: { name: 'UNEXPLORED_SECRET' } },
  };
}

test('returns only the selected player and follows 4.4+ colony carrier IDs', async () => {
  const state = sample(); const trace = join(temp, 'requests.jsonl'); state._trace = trace;
  const savePath = await fixture(state);
  const before = await readFile(savePath); const beforeStat = await stat(savePath);
  const snapshot = await observeSave({ savePath, parserPath });
  assert.equal(snapshot.source, 'save');
  assert.equal(snapshot.gameVersion, 'Cygnus v4.5.1');
  assert.equal(snapshot.gameDate, '2200.01.01');
  assert.equal(snapshot.savedAt, beforeStat.mtime.toISOString());
  assert.equal(snapshot.player.id, '0');
  assert.equal(snapshot.player.resources.stockpiles.energy, 123.5);
  assert.equal(snapshot.player.resources.stockpiles.minerals, 0);
  assert.equal(snapshot.player.resources.monthlyNet.energy, 9);
  assert.equal(snapshot.player.resources.stockpiles.alloys, null);
  assert.equal(snapshot.player.planets.length, 1);
  assert.deepEqual(snapshot.player.planets[0], { id: '7', colonyId: '0', carrierType: 'planet', name: 'Earth', planetClass: 'pc_continental', size: 16, stability: 50, crime: null, amenities: null, freeAmenities: null, freeHousing: null, populationRaw: 1250, designation: null, districtIds: ['4'], buildingIds: ['3'], buildQueueId: null });
  assert.equal(snapshot.player.fleets[0].shipCount, 1);
  assert.equal(snapshot.player.fleets[0].militaryPower, 0);
  assert.equal(snapshot.player.research.physics.current.progress, 0);
  assert.equal(snapshot.player.research.society.queueKnown, true);
  assert.equal(snapshot.player.research.society.current, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /FOREIGN_SECRET|UNEXPLORED_SECRET|WRONG_STAR|FUTURE_HIDDEN_TECH|galactic_object/);
  const requests = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(requests[0].sections, ['meta', 'player', 'date', 'version']);
  assert.ok(requests.filter(row => row.section === 'country').every(row => row.keys.join() === '0'));
  assert.ok(!requests.some(row => row.section === 'galactic_object' || row.keys?.includes('999')));
  assert.deepEqual(await readFile(savePath), before);
});

test('legacy planets.planet saves remain legacy and retain their actual meta version', async () => {
  const state = sample(); delete state.colony;
  state.meta.version = 'Corvus v4.2.4'; state.country[0].owned_planets = ['7'];
  const snapshot = await observeSave({ savePath: await fixture(state), parserPath });
  assert.equal(snapshot.gameVersion, 'Corvus v4.2.4');
  assert.equal(snapshot.player.planets[0].id, '7');
  assert.equal(snapshot.player.planets[0].colonyId, null);
  assert.equal(snapshot.player.planets[0].populationRaw, null);
});

test('ship-carried colonies query only the owned colony ship', async () => {
  const state = sample(); state.colony[0].carrier = { type: 'ship', reference: '55' };
  state.ships = { 55: { name: 'Arkship', owner: '0', planet_size: '20' }, 999: { name: 'UNEXPLORED_SECRET' } };
  const snapshot = await observeSave({ savePath: await fixture(state), parserPath });
  assert.equal(snapshot.player.planets[0].carrierType, 'ship');
  assert.equal(snapshot.player.planets[0].id, '55');
  assert.equal(snapshot.player.planets[0].name, 'Arkship');
});

test('unknown fields remain null; explicit empty owned lists remain empty', async () => {
  const state = sample(); state.country[0] = { name: 'Home', owned_planets: [], fleets_manager: { owned_fleets: [] } }; delete state.meta.version;
  const snapshot = await observeSave({ savePath: await fixture(state), parserPath });
  assert.equal(snapshot.gameVersion, null);
  assert.equal(snapshot.player.resources.stockpiles.energy, null);
  assert.equal(snapshot.player.resources.monthlyNet.energy, null);
  assert.deepEqual(snapshot.player.planets, []); assert.deepEqual(snapshot.player.fleets, []);
  assert.equal(snapshot.player.research.physics.queueKnown, false);
  assert.ok(snapshot.warnings.some(row => row.includes('版本未知')));
  assert.ok(snapshot.warnings.some(row => row.includes('库存')));
});

test('missing ownership lists never trigger a galaxy scan or fake empty totals', async () => {
  const state = sample(); state.country[0] = { name: 'Home' };
  const snapshot = await observeSave({ savePath: await fixture(state), parserPath });
  assert.equal(snapshot.player.planets, null); assert.equal(snapshot.player.fleets, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /UNEXPLORED_SECRET/);
});

test('explicit foreign ownership overrides stale own-ID references', async () => {
  const state = sample(); state.planets.planet[7].owner = '9'; state.fleet[2].owner = '9';
  const snapshot = await observeSave({ savePath: await fixture(state), parserPath });
  assert.deepEqual(snapshot.player.planets, []); assert.deepEqual(snapshot.player.fleets, []);
  assert.ok(snapshot.warnings.filter(row => row.includes('所有权')).length >= 2);
});

test('multiplayer selection must be explicit and may not target a non-player empire', async () => {
  const state = sample(); state.player.push({ country: '1', name: 'Guest' }); state.country[1] = { name: 'Guest Empire', owned_planets: [], fleets_manager: { owned_fleets: [] } };
  const savePath = await fixture(state);
  await assert.rejects(observeSave({ savePath, parserPath }), /多人存档/);
  await assert.rejects(observeSave({ savePath, parserPath, playerCountryId: 9 }), /拒绝越界/);
  const snapshot = await observeSave({ savePath, parserPath, playerCountryId: '1' });
  assert.equal(snapshot.player.id, '1'); assert.equal(snapshot.player.name, 'Guest Empire');
  assert.doesNotMatch(JSON.stringify(snapshot), /Home Empire|FOREIGN_SECRET/);
});

test('never guesses player country zero when the player block is missing', async () => {
  const state = sample(); delete state.player;
  await assert.rejects(observeSave({ savePath: await fixture(state), parserPath }), /不能猜测国家 0/);
});

test('unreadable files and parser failures are explicit and do not leak raw diagnostics', async () => {
  await assert.rejects(observeSave({ savePath: join(temp, 'missing.sav'), parserPath }), /无法读取/);
  await assert.rejects(observeSave({ savePath: await fixture(sample()), parserPath: join(temp, 'missing.exe') }), /未找到/);
  const state = sample(); state._fail = true;
  await assert.rejects(observeSave({ savePath: await fixture(state), parserPath }), error => error.message.includes('无法读取该存档') && !error.message.includes('FOREIGN_SECRET'));
  const badSave = join(temp, 'bad.sav'); await writeFile(badSave, 'corrupt');
  await assert.rejects(observeSave({ savePath: badSave, parserPath }), /提前退出/);
});

test('rejects a snapshot that changes while being read', async () => {
  const state = sample(); state._change = true;
  await assert.rejects(observeSave({ savePath: await fixture(state), parserPath }), /读取期间存档发生变化/);
});

function storedZip(files) {
  const local = [], directory = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name); const body = Buffer.from(text);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(body.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, body);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(body.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42); directory.push(entry, filename);
    offset += header.length + filename.length + body.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}

test('published independent Windows parser reads a synthetic .sav without writing it', { skip: process.platform !== 'win32' }, async () => {
  const savePath = join(temp, 'real-parser.sav');
  await writeFile(savePath, storedZip({ meta: 'version="Cygnus v4.5.2"\ndate="2200.01.01"\nname="Home"\n', gamestate: 'date="2200.01.01"\nplayer={ {country=0 name="Human"} }\ncountry={ 0={name="Home" owned_planets={} fleets_manager={owned_fleets={}} modules={standard_economy_module={resources={energy=7.5}}}} 9={name="FOREIGN_SECRET"} }\n' }));
  const before = createHash('sha256').update(await readFile(savePath)).digest('hex');
  const snapshot = await observeSave({ savePath });
  assert.equal(snapshot.gameVersion, 'Cygnus v4.5.2');
  assert.equal(snapshot.player.resources.stockpiles.energy, 7.5);
  assert.deepEqual(snapshot.player.planets, []);
  assert.doesNotMatch(JSON.stringify(snapshot), /FOREIGN_SECRET/);
  assert.equal(createHash('sha256').update(await readFile(savePath)).digest('hex'), before);
});
