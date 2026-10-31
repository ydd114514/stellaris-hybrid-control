import type { Face } from '../../shared/src'

type Beat = { line: string; action: string; face: Face }
const episodes: { title: string; premise: string; beats: Beat[] }[] = [
  { title: '店猫招聘大会', premise: '虚拟店猫想应聘财务，肥鱼又想当老板又怕猫掌权。', beats: [
    { line: '我决定面试店猫当财务。它的简历只有四个字：擅长躺平。居然跟本店长专业对口。', action: 'pet_cat', face: 'smug' },
    { line: '刚问店猫会不会算账，它把爪子按在账本上。懂了，商业机密，入职第一天就开始防老板。', action: 'count', face: 'thinking' },
    { line: '我想明白了，它负责把账本压平，我负责把自己养圆。这家公司，主营一个各有所长。', action: 'akimbo', face: 'happy' },
    { line: '面试结束，猫通过了，我成试用期员工了。你说这小店让猫当老板，还是让鱼当老板？', action: 'giggle', face: 'pout' },
  ] },
  { title: '肥鱼演技训练', premise: 'DeepSeek本体穿着此刻已有的AI皮套练演技，只演当前形象，不实际换装。', beats: [
    { line: '本鱼开始练习高深的表情。先看远处，再眯眼……坏了，怎么像在看一行特别小的字。', action: 'listen', face: 'thinking' },
    { line: '刚才那套深沉表情，我给自己打九分。剩下一分扣给尾巴，它晃得太开心，出卖我了。', action: 'akimbo', face: 'smug' },
    { line: '我给尾巴开了个会，让它配合我装聪明。它说行，然后带着全身一起摇。反骨，纯反骨。', action: 'music', face: 'pout' },
    { line: '今日演技课结论：再聪明的皮套，也藏不住一条开心的肥鱼。你觉得我装严肃，还是装可爱更容易露馅？', action: 'heart', face: 'wink' },
  ] },
  { title: '虚拟老板椅争夺战', premise: '肥鱼在脑内盘算夺舍主人的老板椅，纯虚构小剧场，不控制真实电脑。', beats: [
    { line: '本鱼脑内的商业计划更新了：先承包这张虚拟柜台，再向主人的老板椅发起友好挑战。', action: 'write_note', face: 'smug' },
    { line: '夺椅计划遇到了第一个难题：我坐上去，尾巴放哪儿？堂堂商业帝国，卡在人体工学。', action: 'lean', face: 'thinking' },
    { line: '我宣布给老板椅加一个尾巴专座。图纸已经画好了，看着像个漏勺。这个项目先别让主人知道。', action: 'write_note', face: 'happy' },
    { line: '今天先不夺椅了，设计图拿来当扇子挺好。你上班最想升级的是椅子，还是老板的脑回路？', action: 'giggle', face: 'wink' },
  ] },
  { title: '尾巴音乐比赛', premise: '肥鱼跟着背景音乐想象一场比赛，不复述歌词、不声称观众点了歌。', beats: [
    { line: '趁这个拍子合适，我跟尾巴比一次谁更有节奏。它先动了。裁判，我举报选手抢跑。', action: 'music', face: 'excited' },
    { line: '比赛第二回合，我决定只动脑袋，尾巴决定带我全身一起动。这位选手根本不讲合作精神。', action: 'flap', face: 'pout' },
    { line: '算了，我宣布跟尾巴组成组合。组合名叫各跳各的，主打一个谁也别嫌弃谁。', action: 'cheer', face: 'happy' },
    { line: '各跳各的组合首演结束，观众席的店猫已经睡着了。你听歌会跟着点头，还是只在心里蹦迪？', action: 'music', face: 'wink' },
  ] },
  { title: '便签创业计划', premise: '肥鱼给虚拟小店写离谱但无害的新规则，一条比一条憨。', beats: [
    { line: '我准备给小店立一条新规定：每天必须有一次理直气壮的发呆。员工只有我，应该能全票通过。', action: 'write_note', face: 'smug' },
    { line: '新规定贴好了，店猫坐在便签上。它可能觉得发呆一天一次太少，准备申请全天开放。', action: 'pet_cat', face: 'thinking' },
    { line: '我跟猫协商完了，上午发呆，下午研究为什么要发呆。这个工作安排，连尾巴都点了个赞。', action: 'akimbo', face: 'happy' },
    { line: '便签公司暂时休会。要是让你给一天加个按钮，你选暂停五分钟，还是把烦恼缩小一点？', action: 'write_note', face: 'wink' },
  ] },
]
export interface IdleShowPlan { episode: number; beat: number; title: string; premise: string; purpose: string; line: string; action: string; face: Face; useModel: boolean }
const purposes = ['开场，抛出具体小冲突，自己就能接下去，不等观众回答', '沿上一段添一个小麻烦或反转，不重复开场', '自己接住自己的梗，推进一个新笑点，不替真实观众编台词', '收尾，并留一个一句话就能回答的轻问题；不点名催人回应']

/** Advance only after a matching stage completion; cancelled or late replies cannot skip a beat. */
export function createIdleShow(stored?: unknown) {
  const raw = stored && typeof stored === 'object' ? stored as { episode?: unknown; beat?: unknown } : {}
  let episode = typeof raw.episode === 'number' && Number.isSafeInteger(raw.episode) && raw.episode >= 0 ? raw.episode % episodes.length : 0
  let beat = typeof raw.beat === 'number' && Number.isInteger(raw.beat) && raw.beat >= 0 && raw.beat < 4 ? raw.beat : 0
  return {
    atBoundary: () => beat === 0,
    plan(): IdleShowPlan { const show = episodes[episode]!; const step = show.beats[beat]!; return { episode, beat, title: show.title, premise: show.premise, purpose: purposes[beat]!, line: step.line, action: step.action, face: step.face, useModel: beat % 2 === 0 } },
    completed(plan: IdleShowPlan) { if (plan.episode !== episode || plan.beat !== beat) return; beat++; if (beat === 4) { beat = 0; episode = (episode + 1) % episodes.length } },
    snapshot: () => ({ episode, beat }),
    reset() { episode = 0; beat = 0 },
  }
}
