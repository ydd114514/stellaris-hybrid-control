/*
 * 共享黑板：场控老师和游戏参谋互通信息的唯一地方。
 * 每个角色只改自己负责的分区（参谋：game/plan，场控：audience），建议的处理结果由参谋回填；
 * 所有列表都有上限，黑板会进每一次提示词，不能无限长。
 */
import type { AiAgentRole, AiAudienceGuidance, AiAudienceSuggestion, AiBlackboard, AiDirectorStatus } from '../../shared/src/ai'
import {restoreAudienceTasks} from './audience-query-tasks'
import {restoreExecutionTasks,restoreSuggestionExecution} from './advice-execution-tasks'

const LIMITS = { threats: 5, goals: 5, nextSteps: 6, hotTopics: 6, suggestions: 12, notes: 10 }
export const clip = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
const list = (value: unknown, size: number, max: number) => Array.isArray(value) ? value.map(item => clip(item, max)).filter(Boolean).slice(0, size) : []

export function createBlackboard(): AiBlackboard {
  return { game: { summary: '', threats: [], goals: [] }, plan: { focus: '', nextSteps: [], talkingPoint: '' }, audience: { mood: '', hotTopics: [], suggestions: [],tasks:[] }, notes: [] }
}
/** Rebuilds a saved board through the same bounds; anything malformed falls back to empty. */
export function restoreBlackboard(value: any): AiBlackboard {
  const board = createBlackboard()
  if (!value || typeof value !== 'object') return board
  board.executionTasks=restoreExecutionTasks(value.executionTasks)
  board.game = { summary: clip(value.game?.summary, 400), date: clip(value.game?.date, 20) || undefined, threats: list(value.game?.threats, LIMITS.threats, 80), goals: list(value.game?.goals, LIMITS.goals, 80), updatedAt: Number(value.game?.updatedAt) || undefined, by: clip(value.game?.by, 40) || undefined }
  board.plan = { focus: clip(value.plan?.focus, 120), nextSteps: list(value.plan?.nextSteps, LIMITS.nextSteps, 100), talkingPoint: clip(value.plan?.talkingPoint, 120), updatedAt: Number(value.plan?.updatedAt) || undefined, by: clip(value.plan?.by, 40) || undefined }
  board.audience = { mood: clip(value.audience?.mood, 20), hotTopics: list(value.audience?.hotTopics, LIMITS.hotTopics, 30), updatedAt: Number(value.audience?.updatedAt) || undefined, by: clip(value.audience?.by, 40) || undefined,
    tasks:restoreAudienceTasks(value.audience?.tasks),suggestions: (Array.isArray(value.audience?.suggestions) ? value.audience.suggestions : []).slice(0, LIMITS.suggestions).map((s: any) => ({ id: clip(s?.id, 40), name: clip(s?.name, 20), text: clip(s?.text, 100), at: Number(s?.at) || 0,
      status: ['new', 'adopted', 'declined', 'answered'].includes(s?.status) ? s.status : 'new', reply: clip(s?.reply, 120) || undefined, attempts: Math.max(0, Math.min(2, Number(s?.attempts) || 0)), lastAskedAt: Number(s?.lastAskedAt) || undefined, announcedAt: Number(s?.announcedAt) || undefined,execution:restoreSuggestionExecution(s?.execution),...(/^[a-zA-Z0-9_-]{1,80}$/.test(s?.executionGameSessionId??'')?{executionGameSessionId:s.executionGameSessionId}:{}) })).filter((s: AiAudienceSuggestion) => s.id && s.text) }
  board.notes = (Array.isArray(value.notes) ? value.notes : []).slice(0, LIMITS.notes).map((n: any) => ({ id: clip(n?.id, 40), from: clip(n?.from, 40), to: ['host', 'strategist', 'player', 'all'].includes(n?.to) ? n.to : 'all', text: clip(n?.text, 160), at: Number(n?.at) || 0 })).filter((n: any) => n.id && n.text)
  return board
}

export function addNote(board: AiBlackboard, note: { id: string; from: string; to: AiAgentRole | 'all'; text: string; at: number }) {
  const text = clip(note.text, 160)
  if (text) board.notes = [{ ...note, text }, ...board.notes].slice(0, LIMITS.notes)
}
export function addSuggestion(board: AiBlackboard, suggestion: Omit<AiAudienceSuggestion, 'status'>) {
  const text = clip(suggestion.text, 100)
  if (!text || board.audience.suggestions.some(s => s.status === 'new' && s.text === text)) return false
  let id=suggestion.id
  while(board.audience.suggestions.some(s=>s.id===id))id=`s-${crypto.randomUUID()}`
  board.audience.suggestions = [{ ...suggestion, id, name: clip(suggestion.name, 20), text, status: 'new' as const }, ...board.audience.suggestions].slice(0, LIMITS.suggestions)
  return true
}
export const pendingSuggestions = (board: AiBlackboard) => board.audience.suggestions.filter(s => s.status === 'new')

export function audienceGuidance(board: AiBlackboard, status: AiDirectorStatus, at: number): AiAudienceGuidance {
  const states = { new: 'pending', adopted: 'adopted', declined: 'dismissed', answered: 'answered' } as const
  return { version: 1, source: 'cyberfish-ai-hub', updatedAt: at,
    status: !status.running ? 'stopped' : status.busy.length ? 'collecting' : board.audience.suggestions.length ? 'ready' : 'waiting',
    summary: board.plan.focus ? `当前方针：${clip(board.plan.focus, 120)}` : '',
    items: board.audience.suggestions.slice(0, LIMITS.suggestions).map(s => ({ id: s.id, name: clip(s.name, 20), text: clip(s.text, 100), status: states[s.status], ...(s.reply ? { reply: clip(s.reply, 120) } : {}) })) }
}

/** Host output → audience section. */
export function applyHost(board: AiBlackboard, out: Record<string, any>, by: string, at: number) {
  const mood = clip(out.mood, 20), topics = list(out.hotTopics, LIMITS.hotTopics, 30)
  if (mood) board.audience.mood = mood
  if (topics.length) board.audience.hotTopics = topics
  board.audience.updatedAt = at; board.audience.by = by
}
/** Strategist output → game and plan sections, plus the verdict on each audience suggestion it saw. */
export function applyStrategist(board: AiBlackboard, out: Record<string, any>, by: string, at: number) {
  const summary = clip(out.summary, 400)
  if (summary) board.game = { summary, date: clip(out.date, 20) || board.game.date, threats: list(out.threats, LIMITS.threats, 80), goals: list(out.goals, LIMITS.goals, 80), updatedAt: at, by }
  const focus = clip(out.focus, 120)
  if (focus || Array.isArray(out.nextSteps)) board.plan = { focus: focus || board.plan.focus, nextSteps: list(out.nextSteps, LIMITS.nextSteps, 100), talkingPoint: clip(out.talkingPoint, 120), updatedAt: at, by }
  const decided = new Map<string, { status: AiAudienceSuggestion['status']; reply?: string }>()
  for (const d of Array.isArray(out.suggestions) ? out.suggestions : []) {
    const status = d?.decision === 'adopted' || d?.decision === 'declined' || d?.decision === 'answered' ? d.decision : undefined
    if (status && typeof d.id === 'string') decided.set(d.id, { status, reply: clip(d.reply, 120) || undefined })
  }
  board.audience.suggestions = board.audience.suggestions.map(s => s.status === 'new' && decided.has(s.id) ? { ...s, ...decided.get(s.id)! } : s)
  return decided.size
}

const ago = (at: number | undefined, now: number) => !at ? '尚无' : now - at < 60000 ? '刚刚' : `${Math.round((now - at) / 60000)} 分钟前`
/** The board as prompt text, tailored to who is reading it. */
export function briefFor(board: AiBlackboard, role: AiAgentRole, now: number) {
  const lines: string[] = []
  lines.push(`【游戏局势】（${role==='host'?'最近记录':'参谋更新于'}${ago(board.game.updatedAt, now)}）${board.game.summary || '尚未获得局势判断，不要编造游戏里的数字和事件。'}`)
  if (board.game.date) lines.push(`星历：${board.game.date}`)
  if (board.game.threats.length) lines.push(`威胁：${board.game.threats.join('；')}`)
  if (board.game.goals.length) lines.push(`目标：${board.game.goals.join('；')}`)
  lines.push(`【当前方针】${board.plan.focus || '暂无'}`)
  if (board.plan.nextSteps.length) lines.push(`接下来：${board.plan.nextSteps.map((s, i) => `${i + 1}. ${s}`).join(' ')}`)
  if (role === 'host' && board.plan.talkingPoint) lines.push(`【当前话题】${board.plan.talkingPoint}`)
  lines.push(`【直播间】气氛：${board.audience.mood || '未知'}；热点：${board.audience.hotTopics.join('、') || '暂无'}`)
  const suggestions = board.audience.suggestions.filter(s=>role!=='host'||!s.announcedAt).slice(0, role === 'host' ? 6 : 10)
  if (suggestions.length) {
    const label = { new: '待参谋判断', adopted: '纳入计划，效果待确认', declined: '未采纳', answered: '已回答' }
    const executionLabel={pending:'待执行',working:'正在执行',verifying:'待效果核查',succeeded:'实际结果已确认',blocked:'执行受阻',superseded:'已被新安排替代'}
    lines.push('【观众建议】' + suggestions.map(s => `[${s.id}] ${s.name}：${s.text}（${s.execution?executionLabel[s.execution.status]:label[s.status]}${s.execution?.reason?`：${s.execution.reason}`:s.reply ? `：${s.reply}` : ''}${s.execution?.evidence?`；实际依据：${s.execution.evidence}`:''}）`).join(' | '))
  }
  const execution=board.executionTasks
  if(execution?.tasks.length){
    const label={pending:'待执行',working:'正在执行',verifying:'待效果核查',succeeded:'实际结果已确认',blocked:'执行受阻',superseded:'已被新安排替代'}
    lines.push('【已交办任务的实际进度，计划不等于完成】'+execution.tasks.filter(t=>t.status!=='superseded').slice(-8).map(t=>`${role==='strategist'?`[${t.id}] `:''}${t.text}：${label[t.status]}；${t.reason}${t.evidence?'；依据：'+t.evidence:''}`).join(' | '))
  }
  const notes = board.notes.filter(n => n.to === 'all' || n.to === role).slice(0, 5)
  if (notes.length) lines.push('【同事留言】' + notes.map(n => `${n.from}：${n.text}`).join(' | '))
  return lines.join('\n')
}
