import type { Face, Reply } from '../../shared/src'

type Emotion = 'angry' | 'happy' | 'love' | 'sad' | 'sleepy' | 'surprised' | 'thinking' | 'neutral'
const families: Record<Emotion, { faces: Face[]; actions: string[]; style: string }> = {
  angry: { faces: ['angry', 'pout'], actions: ['akimbo', 'shake'], style: '俏皮地气鼓鼓，短句有小脾气但不凶人、不喊叫' },
  happy: { faces: ['happy', 'excited', 'smug', 'wink'], actions: ['giggle', 'flap', 'wave', 'hop', 'dance', 'toast', 'cheer'], style: '清亮开心，轻快有笑意，自然聊天' },
  love: { faces: ['love', 'shy', 'flustered'], actions: ['heart', 'cheer', 'bow', 'serve', 'cocoa', 'toast', 'gift_open'], style: '温暖可爱，略带害羞和真诚感谢，不夸张撒娇' },
  sad: { faces: ['sad', 'cry', 'worried', 'scared'], actions: ['listen', 'blanket', 'tea', 'serve'], style: '柔和耐心，放慢一点，先接住对方的情绪' },
  sleepy: { faces: ['sleepy'], actions: ['yawn', 'lean', 'sleep'], style: '软软地带一点困意，吐字清楚，不刻意拖长' },
  surprised: { faces: ['surprised'], actions: ['hop', 'jump', 'gift_open', 'look'], style: '轻轻惊讶，活泼但不尖叫' },
  thinking: { faces: ['thinking', 'confused', 'determined'], actions: ['count', 'write_note', 'listen', 'read_chat'], style: '认真琢磨，带一点好奇，语气自然' },
  neutral: { faces: ['neutral'], actions: ['listen', 'nod', 'wipe_cup'], style: '自然放松地聊天' },
}
const contextual = new Set(['brew_coffee', 'tea', 'cocoa', 'serve', 'noodles', 'pet_cat', 'photo', 'music', 'water_plant', 'watch_rain', 'tidy_shelf', 'write_note', 'read_chat', 'umbrella', 'lantern', 'fan'])
export const PERFORMANCE_RULES = `【台词、表情与动作必须一致】
根据你这次真正说出的内容选择face/action/voice_style，不能只看客人的情绪：你俏皮生气时用angry或pout配akimbo/摇头；开心用happy/excited配giggle/flap/hop等；喜欢感谢用love/shy配heart/cheer；安慰用worried/neutral配listen/blanket；困意配sleepy与yawn/lean。只有正在回应饮品话题时才用tea/cocoa/brew_coffee，不用递茶动作代替真正接话。
主动比心就用heart，冲咖啡用brew_coffee，听歌用music。别在生气时甜笑、安慰时蹦跳；不要每句话都同一个动作。只选当前动作库提供的动作，不编新名字。`

export function alignReplyPerformance(reply: Reply): Reply {
  const spoken = reply.say.join('').replace(/(?:别|不|没|没有|不要)(?:太|再|真|会|让你)?(?:生气|难过|伤心)/g, '')
  let emotion: Emotion = 'neutral', explicit = false
  if (/(?:我|本店长).{0,6}(?:生气了|有点生气|气鼓鼓)|气死我了|哼.{0,8}叉腰/.test(spoken)) { emotion = 'angry'; explicit = true }
  else if (/给你比(?:个)?心|比个心|我.{0,4}(?:好喜欢|很喜欢)|心都软了/.test(spoken)) { emotion = 'love'; explicit = true }
  else if (/好耶|太棒啦|开心极了|开心得|高兴得|哈哈哈/.test(spoken)) { emotion = 'happy'; explicit = true }
  else emotion = (Object.keys(families) as Emotion[]).find(name => families[name].faces.includes(reply.face)) || 'neutral'
  const family = families[emotion]
  if (explicit && !family.faces.includes(reply.face)) reply.face = family.faces[0]!
  const compatibleContext = ['neutral', 'happy', 'love'].includes(emotion) && contextual.has(reply.action)
  if (!compatibleContext && emotion !== 'neutral' && !family.actions.includes(reply.action)) {
    const seed = Array.from(reply.id).reduce((sum, character) => sum + character.charCodeAt(0), 0)
    reply.action = family.actions[seed % family.actions.length]!
    reply.station = null
  }
  if (explicit || !reply.voiceStyle) reply.voiceStyle = family.style
  return reply
}
