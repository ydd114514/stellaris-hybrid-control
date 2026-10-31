import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve } from 'node:path';

const DEFAULT_PARSER = fileURLToPath(new URL('../vendor/stellaris-companion/stellaris-parser.exe', import.meta.url));
const RESOURCES = ['energy', 'minerals', 'food', 'consumer_goods', 'alloys', 'unity', 'influence', 'physics_research', 'society_research', 'engineering_research', 'trade', 'volatile_motes', 'exotic_gases', 'rare_crystals', 'sr_living_metal', 'sr_zro', 'sr_dark_matter', 'minor_artifacts', 'astral_threads'];
const COUNTRY_FIELDS = ['name', 'modules', 'budget', 'owned_planets', 'colonies', 'controlled_colonies', 'fleets_manager', 'tech_status'];
const PLANET_FIELDS = ['name', 'owner', 'controller', 'carrier', 'planet', 'ship', 'planet_class', 'planet_size', 'stability', 'crime', 'amenities', 'free_amenities', 'free_housing', 'num_sapient_pops', 'population', 'final_designation', 'designation', 'districts', 'buildings', 'buildings_cache', 'build_queue'];
const FLEET_FIELDS = ['name', 'owner', 'controller', 'ship_class', 'military_power', 'ships', 'movement_manager', 'coordinate', 'current_order', 'order'];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const string = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const id = value => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) || (typeof value === 'string' && /^\d+$/.test(value)) ? String(value) : null;
const numeric = value => (typeof value === 'number' || typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) && Number.isFinite(Number(value)) ? Number(value) : null;
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));

function collectionIds(value, keys = ['id']) {
  if (value === undefined || value === null) return null;
  const rows = Array.isArray(value) ? value : object(value) ? Object.values(value) : [value];
  const result = [];
  for (const row of rows) {
    const selected = id(row) ?? keys.map(key => id(object(row)?.[key])).find(value => value !== null);
    if (selected !== undefined && selected !== null && !result.includes(selected)) result.push(selected);
  }
  if (result.length > 10000) throw new Error('玩家实体数量超过本地观察器上限。');
  return result;
}

// The upstream Rust parser decodes Windows-1252. Some modern saves contain UTF-8
// names; reverse that decode only when it produces valid, non-Latin display text.
const cp1252 = new Map(Array.from({ length: 256 }, (_, byte) => [new TextDecoder('windows-1252').decode(Uint8Array.of(byte)), byte]));
function displayName(value, warnings, resolver) {
  const localized=resolver?.(value)
  if(typeof localized==='string'&&localized)return localized
  const raw = string(value) ?? string(object(value)?.key);
  if (!raw) return null;
  if (raw.startsWith('NAME_') || /^(EMPIRE_DESIGN|PREFIX_NAME|shipclass_)/.test(raw)) warnings.add('部分名称仍为游戏本地化键，尚未读取游戏语言文件。');
  const bytes = [];
  for (const char of raw) { if (!cp1252.has(char)) return raw; bytes.push(cp1252.get(char)); }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    if (decoded !== raw && /[\u0400-\u9fff]/u.test(decoded)) {
      warnings.add('已对上游 Windows-1252 解码产生的可逆 UTF-8 显示名乱码进行修复。');
      return decoded;
    }
  } catch { /* A genuine Windows-1252 name is already correct. */ }
  return raw;
}

function parserSession(parserPath, savePath) {
  const nodeScript = ['.mjs', '.js', '.cjs'].includes(extname(parserPath).toLowerCase());
  const child = spawn(nodeScript ? process.execPath : parserPath, [...(nodeScript ? [parserPath] : []), 'serve', '--path', savePath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', pending, failure, ended = false;
  const fail = error => {
    failure ??= error;
    if (pending) { const current = pending; pending = undefined; clearTimeout(current.timer); current.reject(failure); }
    if (!ended) child.kill();
  };
  child.on('error', () => fail(new Error('无法启动独立存档解析器，请检查 parserPath 与运行环境。')));
  child.on('close', code => { ended = true; if (pending) fail(new Error(`存档解析器提前退出（退出码 ${code ?? '未知'}）。`)); });
  child.stdin.on('error', () => fail(new Error('存档解析器输入通道已关闭。')));
  child.stderr.resume(); // Do not forward raw save diagnostics or filesystem paths.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, 'utf8') > 16 * 1024 * 1024) { fail(new Error('存档解析器单次输出超过 16 MiB 上限。')); return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let response;
      try { response = JSON.parse(line); } catch { fail(new Error('存档解析器未返回有效 JSON。')); return; }
      if (!pending) { fail(new Error('存档解析器返回了意外的协议消息。')); return; }
      const current = pending; pending = undefined; clearTimeout(current.timer);
      if (response.ok !== true) current.reject(new Error('独立解析器无法读取该存档；请确认文件完整且格式受支持。'));
      else current.resolve(response);
    }
  });
  return {
    request(body) {
      if (failure) return Promise.reject(failure);
      if (ended) return Promise.reject(new Error('存档解析器已经退出。'));
      if (pending) return Promise.reject(new Error('存档解析器不支持并发请求。'));
      return new Promise((resolveRequest, reject) => {
        pending = { resolve: resolveRequest, reject, timer: setTimeout(() => fail(new Error('存档解析器响应超时（30 秒）。')), 30000) };
        child.stdin.write(`${JSON.stringify(body)}\n`);
      });
    },
    dispose() { child.stdin.end(); if (!ended) child.kill(); },
  };
}

/** Query only IDs already present in the selected player's country record. */
async function readEntities(session, kind, ids, fields) {
  const result = new Map();
  if (!ids.length) return result;
  const layouts = {
    colony: { direct: ['colony', 'colonies'], wrappers: [['colonies', 'colony'], ['colonies', 'colonies']] },
    planet: { direct: ['planet'], wrappers: [['planets', 'planet']] },
    ship: { direct: ['ships', 'ship'], wrappers: [['ships', 'ship']] },
    fleet: { direct: ['fleet'], wrappers: [['fleets', 'fleet']] },
  }[kind];
  const missing = () => ids.filter(key => !result.has(key));
  for (const section of layouts.direct) {
    if (!missing().length) break;
    const response = await session.request({ op: 'get_entries', section, keys: missing(), fields });
    for (const entry of response.entries ?? []) if (ids.includes(entry._key)) result.set(entry._key, pick(entry, fields));
  }
  for (const [section, wrapper] of layouts.wrappers) {
    if (!missing().length) break;
    // Project the wrapper map to our entity IDs inside Rust. Foreign planets
    // never cross the subprocess boundary, even for legacy planets.planet saves.
    const keys = missing();
    const response = await session.request({ op: 'get_entries', section, keys: [wrapper], fields: keys });
    for (const entry of response.entries ?? []) for (const key of keys) if (object(entry[key])) result.set(key, pick(entry[key], fields));
  }
  return result;
}

function resourceState(country, warnings) {
  const stock = object(country.modules?.standard_economy_module?.resources);
  const month = object(country.budget?.current_month) ?? object(country.budget);
  const readStock = Object.fromEntries(RESOURCES.map(key => [key, numeric(stock?.[key])]));
  function sum(section) {
    const values = Object.fromEntries(RESOURCES.map(key => [key, null]));
    if (!object(section)) return values;
    for (const row of Object.values(section)) if (object(row)) for (const key of RESOURCES) {
      const value = numeric(row[key]);
      if (value !== null) values[key] = (values[key] ?? 0) + value;
    }
    return values;
  }
  const income = sum(month?.income), expenses = sum(month?.expenses);
  const balance = object(month?.balance);
  const monthlyNet = Object.fromEntries(RESOURCES.map(key => [key, numeric(balance?.[key]) ?? (income[key] !== null && expenses[key] !== null ? income[key] - expenses[key] : null)]));
  if (!stock) warnings.add('未识别资源库存字段；库存未知值以 null 返回。');
  if (!month || !object(month.income) || !object(month.expenses)) warnings.add('存档未完整记录月度预算；未记录的收支以 null 返回。');
  return { stockpiles: readStock, monthlyIncome: income, monthlyExpenses: expenses, monthlyNet };
}

function researchState(country, warnings) {
  const tech = object(country.tech_status);
  if (!tech) warnings.add('未识别玩家 tech_status；科研字段未知。');
  return Object.fromEntries(['physics', 'society', 'engineering'].map(category => {
    const rawQueue = tech?.[`${category}_queue`];
    const queue = Array.isArray(rawQueue) ? rawQueue : object(rawQueue)?.technology ? [rawQueue] : null;
    const current = object(queue?.[0]);
    const options = tech?.alternatives?.[category];
    return [category, {
      queueKnown: queue !== null,
      current: current ? { technology: string(current.technology), progress: numeric(current.progress), startedAt: string(current.date) } : null,
      available: Array.isArray(options) ? options.filter(value => typeof value === 'string') : null,
      autoResearch: tech?.[`auto_researching_${category}`] === 'yes' ? true : tech?.[`auto_researching_${category}`] === 'no' ? false : null,
    }];
  }));
}
function fleetOrders(value){
  const rows=Array.isArray(value)?value:[value]
  return rows.filter(object).slice(0,24).flatMap(row=>Object.entries(row).filter(([key,details])=>key.endsWith('_order')&&object(details)).map(([type,details])=>({type,progress:numeric(details.progress),canReach:details.can_reach==='yes'?true:details.can_reach==='no'?false:null})))
}

async function playerPlanets(session, country, playerId, warnings, resolver) {
  const owned = collectionIds(country.owned_planets ?? country.colonies, ['planet', 'colony', 'planet_id', 'colony_id', 'id']);
  if (owned === null) { warnings.add('未识别玩家拥有的行星/殖民地列表；未扫描全银河或猜测所有权。'); return null; }
  const colonies = await readEntities(session, 'colony', owned, PLANET_FIELDS);
  const requests = [];
  for (const key of owned) {
    const colony = colonies.get(key);
    if (colony) {
      const carrier = object(colony.carrier);
      const type = carrier?.type === 'ship' || carrier?.ship !== undefined ? 'ship' : carrier?.type === 'planet' || carrier?.planet !== undefined ? 'planet' : null;
      const carrierId = id(carrier?.reference ?? carrier?.id ?? carrier?.planet ?? carrier?.ship ?? colony.planet ?? colony.ship);
      requests.push({ colonyId: key, colony, kind: type, carrierId });
    } else requests.push({ colonyId: key, colony: null, kind: 'planet', carrierId: key });
  }
  const planets = await readEntities(session, 'planet', [...new Set(requests.filter(row => row.kind === 'planet' && row.carrierId !== null).map(row => row.carrierId))], PLANET_FIELDS);
  const ships = await readEntities(session, 'ship', [...new Set(requests.filter(row => row.kind === 'ship' && row.carrierId !== null).map(row => row.carrierId))], PLANET_FIELDS);
  const result = [];
  for (const row of requests) {
    const carrier = (row.kind === 'planet' ? planets : ships).get(row.carrierId);
    const data = row.colony ?? carrier;
    if (!data) { warnings.add(`玩家行星/殖民地 ${row.colonyId} 的记录缺失。`); continue; }
    if ([data, carrier].some(value => id(value?.owner) !== null && id(value.owner) !== playerId)) { warnings.add(`已排除所有权与玩家不符的行星/殖民地 ${row.colonyId}。`); continue; }
    if (!carrier) warnings.add(`玩家殖民地 ${row.colonyId} 的物理载体未识别，名称或大小可能未知。`);
    const value = key => data[key] ?? carrier?.[key];
    result.push({
      id: row.carrierId ?? row.colonyId, colonyId: row.colony ? row.colonyId : null,
      carrierType: row.kind, name: displayName(carrier?.name ?? data.name, warnings, resolver),
      planetClass: string(value('planet_class')), size: numeric(value('planet_size')),
      stability: numeric(value('stability')), crime: numeric(value('crime')),
      amenities: numeric(value('amenities')), freeAmenities: numeric(value('free_amenities')), freeHousing: numeric(value('free_housing')),
      populationRaw: numeric(value('num_sapient_pops') ?? value('population')),
      designation: string(value('final_designation') ?? value('designation')),
      districtIds: collectionIds(value('districts')), buildingIds: collectionIds(value('buildings_cache') ?? value('buildings')),
      buildQueueId: id(value('build_queue')),
    });
  }
  if (result.some(row => row.populationRaw !== null)) warnings.add('populationRaw 为存档原始人口值，未进行版本相关的人口单位换算。');
  return result;
}

async function playerFleets(session, country, playerId, warnings, resolver) {
  const owned = collectionIds(country.fleets_manager?.owned_fleets, ['fleet', 'id']);
  if (owned === null) { warnings.add('未识别玩家 owned_fleets；舰队状态未知。'); return null; }
  const entities = await readEntities(session, 'fleet', owned, FLEET_FIELDS);
  const result = [];
  for (const fleetId of owned) {
    const data = entities.get(fleetId);
    if (!data) { warnings.add(`玩家舰队 ${fleetId} 的记录缺失。`); continue; }
    if (id(data.owner) !== null && id(data.owner) !== playerId) { warnings.add(`已排除所有权与玩家不符的舰队 ${fleetId}。`); continue; }
    const shipIds = collectionIds(data.ships);
    result.push({ id: fleetId, name: displayName(data.name, warnings, resolver), shipClass: string(data.ship_class), shipCount: shipIds === null ? null : shipIds.length, shipIds, militaryPower: numeric(data.military_power), systemId: id(data.movement_manager?.coordinate?.origin ?? data.coordinate?.origin), movementState: string(data.movement_manager?.state),currentOrders:fleetOrders(data.current_order),queuedOrders:fleetOrders(data.order) });
  }
  return result;
}

/** Read a .sav through the pinned independent parser; never changes any game file. */
export async function observeSave({ savePath, parserPath = DEFAULT_PARSER, playerCountryId,resolveDisplayName } = {}) {
  if (typeof savePath !== 'string' || !savePath.trim()) throw new Error('请指定需要观察的 .sav 存档路径。');
  const absoluteSave = resolve(savePath), absoluteParser = resolve(parserPath);
  let before;
  try { before = await stat(absoluteSave); } catch { throw new Error('无法读取指定存档，请检查文件路径与读取权限。'); }
  if (!before.isFile()) throw new Error('存档路径需要指向文件。');
  try { if (!(await stat(absoluteParser)).isFile()) throw new Error(); } catch { throw new Error('未找到独立存档解析器，请检查 parserPath。'); }
  const warnings = new Set(['存档是保存时的快照，并非当前游戏画面的实时状态。']);
  const session = parserSession(absoluteParser, absoluteSave);
  try {
    const initial = await session.request({ op: 'extract_sections', sections: ['meta', 'player', 'date', 'version'] });
    const header = object(initial.data);
    if (!header || header.game !== 'stellaris') throw new Error('解析器未返回有效的群星存档头。');
    const rawPlayers = Array.isArray(header.player) ? header.player : object(header.player)?.country !== undefined ? [header.player] : object(header.player) ? Object.values(header.player) : [];
    const players = [...new Set(rawPlayers.map(row => id(object(row)?.country)).filter(value => value !== null))];
    if (!players.length) throw new Error('存档没有可验证的人类玩家帝国记录，不能猜测国家 0。');
    const requested = playerCountryId === undefined ? null : id(playerCountryId);
    if (playerCountryId !== undefined && requested === null) throw new Error('playerCountryId 需要是非负整数 ID。');
    if (requested !== null && !players.includes(requested)) throw new Error('指定帝国不属于此存档记录的人类玩家，已拒绝越界读取。');
    if (requested === null && players.length !== 1) throw new Error('多人存档包含多个玩家帝国，请指定 playerCountryId。');
    const playerId = requested ?? players[0];
    const response = await session.request({ op: 'get_entries', section: 'country', keys: [playerId], fields: COUNTRY_FIELDS });
    const country = response.entries?.find(entry => entry._key === playerId);
    if (!object(country)) throw new Error('存档缺少所选玩家帝国的国家记录。');
    const meta = object(header.meta);
    const gameDate = string(meta?.date) ?? string(header.date);
    const gameVersion = string(meta?.version) ?? string(header.version);
    if (!gameDate) warnings.add('存档未记录可识别的游戏日期。');
    if (!gameVersion) warnings.add('存档版本未知；不能据本机安装版本推断存档兼容性。');
    const result = {
      source: 'save', savedAt: before.mtime.toISOString(), gameDate, gameVersion,
      player: {
        id: playerId, name: displayName(players.length === 1 ? meta?.name ?? country.name : country.name, warnings,resolveDisplayName),
        resources: resourceState(country, warnings),
        planets: await playerPlanets(session, country, playerId, warnings,resolveDisplayName),
        fleets: await playerFleets(session, country, playerId, warnings,resolveDisplayName),
        research: researchState(country, warnings),
      }, warnings: [],
    };
    const after = await stat(absoluteSave);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('读取期间存档发生变化，请等待保存完成后重试。');
    result.warnings = [...warnings];
    return result;
  } finally { session.dispose(); }
}
