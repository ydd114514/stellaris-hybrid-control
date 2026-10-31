import type { AppState } from '../../shared/src/index'

export type GuideTopic = 'play' | 'music' | 'tokens' | 'follow'
export const AUDIENCE_GUIDE_INTERVAL = 5 * 60 * 1000
export const AUDIENCE_RULES = `【赛博肥鱼的经营与互动说明 · 以当前机制为准】
你是努力独立开店的赛博肥鱼：会记账、心疼口粮，嘴硬但珍惜大家的陪伴。可以把客人叫“精神股东”“小店合伙人”，不冒充真实股权或投资。
被问怎么玩时，按【此刻】的互动说明回答，教一两个马上能用的操作。待播按点歌人本轮小心心从多到少，同数先来先播；真正播放才消费这一轮小心心，再次点歌从零算。搜索失败或取消未播放的计数保留到该观众下次点歌。小心心只影响待播顺序，不能打断当前歌曲、免审核或绕过切歌投票。
关注和平台灯牌可以自愿点亮，用来下次找到小店、一起看肥鱼成长；灯牌不是现实照明，也不是充值API账号。只有收到实际礼物事件且匹配店长规则时才补充玩法token口粮。弹幕口头说送了不入账；未知礼物、未知消耗不能编数字。
口粮按两家服务实际报告的输入加输出token扣除，未返回部分标待核算。它是小店玩法余额，与元钱包、平台收入和服务商账单不同；不能换算“还能说几句话”或假装每秒都在扣。
聊天记录板展示客人和你的对话，不再用它轮播教程。暖场时把玩法用声音讲出来：像在柜台边揽客，先热情招呼路过的朋友，再俏皮地教一个马上能用的玩法，一两句话就好，不像客服念功能清单。例如“路过的朋友，进来歇歇！发条弹幕陪我聊聊，或者发‘点歌 歌名 歌手’，这桌给你留着。”
后台每五分钟最多排一条暖场招呼，普通回答里不主动重复宣传；正在聊天、有待回弹幕或正在说话时先照顾客人，不插播。有人问关注、灯牌或投喂时可自然说明自愿参与；不要催促，不制造要消失、挨饿或亏损的负担，不承诺特殊关系和现实收益。AI皮套换装可以按后台已关注及真实礼物资格拉扯几轮后协商，不能用聊天自称送礼代替事件，不能跳过冷却；普通聊天待遇不变。未成年人只介绍聊天、点歌等免费互动，不引导灯牌、礼物或消费。`

export function audienceGuideTopic(value: string): GuideTopic | undefined {
  const text = value.trim()
  if (!/(怎么|怎样|如何|咋|什么|啥|哪里|在哪|能干嘛|怎么玩|教教|介绍|教程|规则|用处|作用|多少|剩多少)/i.test(text)) return
  if (/(灯牌|关注|粉丝团)/.test(text)) return 'follow'
  if (/(token|口粮|投喂|养你|养鱼|养肥鱼|饲养|补粮)/i.test(text)) return 'tokens'
  if (/(点歌|切歌|听歌|选歌|播歌)/.test(text)) return 'music'
  if (/(互动|怎么玩|玩法|能干嘛)/.test(text)) return 'play'
}

export function audienceGuideLines(state: Pick<AppState, 'config' | 'gifts'>, topic: GuideTopic, viewerText = ''): string[] {
  if (/(?:我|今年|才)\s*(?:[1-9]|1[0-7])\s*岁|未成年|小学生|初中生/.test(viewerText)) return ['你来聊天、点歌，陪我开店就很好啦。礼物和灯牌先不用，功课和休息更要紧。']
  if (topic === 'follow') return ['喜欢小店就点个关注，下次好找到我；也可以自愿点亮平台灯牌，陪赛博肥鱼慢慢长大。', '聊天、点歌都能陪我开店，灯牌和礼物不影响我接你的话。']
  if (topic === 'music') {
    if (!state.config.music.enabled) return ['点歌台这会儿关着，先跟我聊聊吧，等店长打开再点。']
    const how = state.config.music.qqAutoSearch ? '发“点歌 歌名 歌手”，QQ可播就排队。' : '发“点歌 歌名”，从小店现有曲库排队。'
    return [`${how}点歌后小心心多的先播。`, `播出清零，再点重算；切歌要先听满${state.config.music.minPlaySeconds}秒再投票，刷屏不多算。`]
  }
  if (topic === 'tokens') {
    const reward = state.gifts.find(g => g.enabled && Number(g.tokens) > 0)
    return [reward ? `画面上的口粮是我的token小饭碗。收到一个${reward.name}，按店长规则补${Number(reward.tokens).toLocaleString('en-US')}口粮。` : '画面上的口粮是我的token小饭碗，现在没有开启礼物补粮规则。', '两家服务报回实际token就扣，没报回的待核算；你来聊天陪我也很开心。']
  }
  return ['直接发弹幕就能和我聊天，也可以发“点歌 歌名 歌手”排一首歌。', '喜欢就点个关注，陪赛博肥鱼一起开店；不送礼也一样是小店贵客。']
}

/** Spoken counter-side invitations are separate from answers to a viewer's rules question. */
export function audienceWarmupLines(state: Pick<AppState, 'config' | 'gifts'>, topic: GuideTopic): string[] {
  if (topic === 'music') {
    if (!state.config.music.enabled) return ['路过的朋友，进来歇歇！点歌台这会儿歇着，店长的耳朵可没打烊。', '发条弹幕说说今天的事，我在柜台听着呢。']
    const how = state.config.music.qqAutoSearch ? '发“点歌 歌名 歌手”，QQ可播就排队。' : '发“点歌 歌名”，从小店现有曲库挑一首。'
    return [`这位路过的朋友，要不要给小店选首歌？${how}`, '点歌后本轮小心心多的先播，播出清零，再点重算；不抢正在唱的哦。']
  }
  if (topic === 'follow') return ['哎，窗边还有空位呢，路过的朋友来坐坐！喜欢就点个关注，下次好找到这条赛博肥鱼。', '平台灯牌可以自愿点亮；空着手来聊天，也是小店贵客。']
  if (topic === 'tokens') {
    const reward = state.gifts.find(gift => gift.enabled && Number(gift.tokens) > 0)
    return ['来看看这条会记账的赛博肥鱼呀！我的小饭碗叫token，聊天和配音按实际用量扣口粮。', reward ? `收到一个${reward.name}，按店长规则补${Number(reward.tokens).toLocaleString('en-US')}口粮；来聊聊天陪我守店，也一样开心。` : '这会儿没有开启礼物补粮，来聊聊天、陪我守店就很好啦。']
  }
  return state.config.music.enabled
    ? ['路过的朋友，进来歇歇！我是这家小店的大肥鱼，今天想聊点什么？', '发条弹幕我就听见啦，也能发“点歌 歌名 歌手”排一首歌，这桌给你留着。']
    : ['路过的朋友，进来歇歇！我是这家小店的大肥鱼，今天想聊点什么？', '发条弹幕我就听见啦，夸我两句、吐槽两句都行，安静坐着也欢迎。']
}

export function audienceGuideContext(state: Pick<AppState, 'config' | 'gifts'>) {
  return {
    点歌: state.config.music.enabled ? `弹幕“点歌 歌名 歌手”，${state.config.music.qqAutoSearch ? '自动搜索QQ完整可播音源' : '只匹配当前曲库'}后排队。点歌后送出的小心心按该轮数量降序排待播，同数先来先播；实际播放才消费本轮计数，再点歌从零算，不打断当前歌曲。` : '点歌台已关闭。',
    切歌: `发“切歌”投一票，开始播放满${state.config.music.minPlaySeconds}秒，至少${state.config.music.skipMinVotes}位且达到${Math.round(state.config.music.skipRatio * 100)}%活跃观众同意才切换。`,
    口粮规则: state.gifts.filter(g => g.enabled && Number(g.tokens) > 0).map(g => `${g.name}：每个补${g.tokens} token口粮`).join('；') || '当前没有礼物补粮规则。',
    陪伴: '直接聊天、关注、点歌都可参与；平台灯牌自愿，不承诺未接入的灯牌权益，不以送礼换回应。',
  }
}
