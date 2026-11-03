import {readFile} from 'node:fs/promises';

const guide = new URL('../docs/兽灾实战手册-4.5.2.md', import.meta.url);
const sections = {
  opening: '配装与开局',
  hatch: '孵化与野性洞见',
  finale: '生长痛与终战',
  recovery: '受阻时怎么调整',
  wilderness: '生体荒野路线',
  sources: '资料与版本',
};
const pageSize = 3500;
export const BEHEMOTH_SECTIONS = Object.keys(sections);

export async function readBehemothGuide({section, page = 1} = {}) {
  const edition = {topic:'behemoth', version:'4.5.2', scope:'玩法经验，当前局的合法条件和本人要求优先'};
  if (section === undefined) {
    if (page !== 1) throw Error('page需要搭配兽灾攻略的section');
    return {...edition, sections, next:{topic:'behemoth',section:'opening'}};
  }
  if (!Object.hasOwn(sections, section) || !Number.isSafeInteger(page) || page < 1) throw Error('兽灾攻略章节或页码无效');
  const lines = (await readFile(guide, 'utf8')).split(/\r?\n/u);
  const title = sections[section];
  const start = lines.indexOf(`## ${title}`);
  if (start < 0) throw Error(`兽灾攻略缺少章节「${title}」`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const content = Array.from(lines.slice(start + 1, end < 0 ? lines.length : end).join('\n').trim());
  const chunks = [];
  for (let offset = 0; offset < content.length;) {
    const limit = Math.min(offset + pageSize, content.length);
    const newline = limit < content.length ? content.lastIndexOf('\n', limit - 1) : -1;
    const boundary = newline > offset ? newline + 1 : limit;
    chunks.push(content.slice(offset, boundary).join(''));
    offset = boundary;
  }
  const pages = chunks.length;
  if (page > pages) throw Error(`兽灾攻略「${title}」共有${pages}页`);
  return {...edition, section, title, page, pages,
    text:chunks[page - 1],
    ...(page < pages ? {next:{topic:'behemoth',section,page:page+1}} : {})};
}

export const hasBehemothPerk = perks => Array.isArray(perks?.adopted) &&
  perks.adopted.some(perk => perk?.key === 'ap_behemoths');

const finite = value => Number.isFinite(value) ? value : null;
const resourceBalance = row => ({
  stockpile:row?.stockpile_known === false ? null : finite(row?.stockpile),
  net:row?.net_known === false ? null : finite(row?.net),
});
const projectKeys = new Set(['BEHEMOTH_CRISIS_SPECIAL_PROJECT_3', 'BEHEMOTH_CRISIS_SPECIAL_PROJECT_4',
  'BEHEMOTH_MUTATION_PROJECT', 'BEHEMOTH_TRANSFERENCE_PROJECT', 'BEHEMOTH_FATE_PROJECT',
  'tiyanki_matriarch_UNIQUE_MUTATION_PROJECT', 'voidspawn_UNIQUE_MUTATION_PROJECT']);

export function behemothSituationBrief(state, log) {
  if (!hasBehemothPerk(state.ascensionPerks)) return undefined;
  const scoped = log?.player_only_filter === true && log.success !== false;
  const own = state.player?.country_id;
  const situation = scoped && Number.isSafeInteger(own) && Array.isArray(log.situations) &&
    log.situations.find(row => row?.key === 'behemoth_finale_situation' && row.is_player === true && row.owner_country_id === own);
  const projects = scoped && Array.isArray(log.special_projects)
    ? [...new Set(log.special_projects.map(row => row?.key).filter(key => projectKeys.has(key)))] : null;
  const finale = situation || projects?.some(key => key === 'BEHEMOTH_TRANSFERENCE_PROJECT' || key === 'BEHEMOTH_FATE_PROJECT');
  return {
    resources:{food:resourceBalance(state.resources?.food), influence:resourceBalance(state.resources?.influence),
      living_metal:resourceBalance(state.resources?.sr_living_metal ?? state.resources?.living_metal)},
    projects,
    growingPains:situation ? {progress:finite(situation.progress), monthlyChange:finite(situation.monthly_change),
      approach:/^behemoth_finale_approach_(brawn|digestion|speed)$/u.test(situation.current_approach) ? situation.current_approach : null} : null,
    guide:{topic:'behemoth',section:finale ? 'finale' : 'hatch'},
  };
}
