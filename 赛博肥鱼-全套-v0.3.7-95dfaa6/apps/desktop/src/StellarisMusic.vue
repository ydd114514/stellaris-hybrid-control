<script setup lang="ts">
import {onMounted,onUnmounted,ref,computed,watch} from 'vue'
import {MUSIC_LIBRARY_LIMIT,MUSIC_QUEUE_DEFAULT,MUSIC_QUEUE_LIMIT} from '../../../packages/shared/src/music-limits'
import {normalizeMusicText} from '../../../packages/core/src/music-match'
import type {StellarisBridge,StellarisMusicView} from '../../../packages/shared/src/stellaris'
const props=defineProps<{api?:StellarisBridge['music']}>()
const view=ref<StellarisMusicView>(),notice=ref(''),busy=ref(false),query=ref(''),qr=ref(''),expires=ref(0)
const blacklist=ref('');let initialized=false
const current=computed(()=>view.value?.state.tracks.find(x=>x.id===view.value?.state.current?.trackId))
const libraryQuery=ref(''),page=ref(1),queueLimit=ref(MUSIC_QUEUE_DEFAULT)
const library=computed(()=>{const ids=new Set(view.value?.bgmTrackIds);const words=libraryQuery.value.split(/\s+/).map(normalizeMusicText).filter(Boolean);return view.value?.state.tracks.filter(t=>ids.has(t.id)&&words.every(q=>normalizeMusicText(t.title+' '+t.artist).includes(q)))||[]})
const pageCount=computed(()=>Math.max(1,Math.ceil(library.value.length/50)))
const visibleTracks=computed(()=>library.value.slice((page.value-1)*50,page.value*50))
watch(libraryQuery,()=>{page.value=1});watch(pageCount,n=>{page.value=Math.min(page.value,n)})
watch(()=>view.value?.maxQueue,n=>{queueLimit.value=n??MUSIC_QUEUE_DEFAULT})
let timer:ReturnType<typeof setInterval>|undefined,alive=true,polling=false
async function refresh(){if(!props.api||busy.value||polling)return;polling=true;try{const v=await props.api.view();if(alive){view.value=v;if(!initialized){blacklist.value=v.blacklist.join('\n');initialized=true}}}catch{}finally{polling=false}}
async function run(action:Parameters<NonNullable<StellarisBridge['music']>['action']>[0],value?:string|number){
 if(!props.api||busy.value||view.value?.localTest)return;busy.value=true
 try{const r=await props.api.action(action,value);if(!alive)return;view.value=r.view;notice.value=r.message
 if(r.login){qr.value=r.login.qrDataUrl;expires.value=r.login.expiresAt}
 if(view.value.account.loggedIn){qr.value='';expires.value=0}
 if(action==='add'&&r.ok)query.value=''
 }catch{if(alive)notice.value='音乐操作未完成，请稍后重试。'}finally{busy.value=false}
}
onMounted(async()=>{alive=true;await refresh();if(alive)timer=setInterval(()=>{if(qr.value&&Date.now()<expires.value&&!busy.value)void run('poll');else{if(Date.now()>=expires.value)qr.value='';void refresh()}},2500)})
onUnmounted(()=>{alive=false;clearInterval(timer)})
</script>
<template>
 <article class="music" v-if="api" data-testid="stellaris-music"><h3>QQ 音乐 <span>{{view?.account.loggedIn?'已连接':'等待连接'}} · {{view?.enabled?'音乐已开启':'静音待命'}}</span></h3>
 <p>无人点歌时轮播背景曲。弹幕发送「点歌 歌名 歌手」；每人一首、个人冷却 120 秒、队列最多 {{view?.maxQueue??MUSIC_QUEUE_DEFAULT}} 首。自选曲库可收藏 {{MUSIC_LIBRARY_LIMIT}} 首，另保留默认背景曲。</p>
 <p>陌生歌曲自动搜索 QQ 音乐；入队和播放前检查歌名、歌手与歌词，拦截国歌、政治相关和脏话过多的曲目。歌词暂时取不到会先跳过，可稍后重试。</p>
 <div class="buttons"><button :disabled="busy||view?.localTest" @click="run('connect')">读取本机登录</button><button :disabled="busy||view?.localTest" @click="run('login','qq')">手机 QQ 扫码</button><button :disabled="busy||view?.localTest" @click="run('login','wechat')">微信扫码</button><button :disabled="busy||view?.localTest||!view?.account.loggedIn" @click="run('start')">开启背景音乐与点歌</button><button :disabled="!view?.enabled||view?.localTest" @click="run('stop')">停止音乐</button><button :disabled="busy||!view?.enabled||view?.localTest" @click="run('next')">下一首</button></div>
 <div v-if="qr" class="qr"><img :src="qr" alt="QQ 音乐登录二维码"><p>请用所选的手机 QQ / 微信扫码，在手机上确认。登录仅保存在本机安全存储中。</p></div>
 <p role="status">{{notice||view?.account.message}}<br>{{view?.state.lastMessage}}</p>
 <div class="now"><strong>{{current?`当前：${current.title} · ${current.artist}`:'当前没有播放歌曲'}}</strong><span>{{view?.state.current?.startedAt?'正在播放':view?.state.current?'准备音频':'已停止'}}</span></div>
 <label>音乐音量 <input type="range" min="0" max="1" step="0.01" :value="view?.volume??.22" :disabled="busy||view?.localTest" @change="run('volume',Number(($event.target as HTMLInputElement).value))"> {{Math.round((view?.volume??.22)*100)}}%</label>
 <form @submit.prevent="run('add',query)"><input v-model="query" maxlength="60" placeholder="歌名 歌手，加入 QQ 背景曲库" :disabled="busy||view?.localTest"><button :disabled="busy||view?.localTest||!query.trim()">搜索并加入</button></form>
 <form @submit.prevent="run('queueLimit',queueLimit)"><label>点歌队列上限 <input v-model.number="queueLimit" type="number" min="1" :max="MUSIC_QUEUE_LIMIT" :disabled="busy||view?.localTest"></label><button :disabled="busy||view?.localTest">保存上限</button></form>
 <label>筛选背景歌单 <input v-model="libraryQuery" placeholder="歌名或歌手"></label>
 <p>背景歌单 {{view?.bgmTrackIds.length||0}} 首 · 筛选后 {{library.length}} 首</p>
 <ul><li v-for="t in visibleTracks" :key="t.id">{{t.title}} · {{t.artist}}<button :disabled="busy||view?.localTest" @click="run('remove',t.id)">移出轮播</button></li></ul>
 <div v-if="pageCount>1" class="buttons"><button :disabled="page<=1" @click="page--">上一页</button><span>{{page}} / {{pageCount}} 页</span><button :disabled="page>=pageCount" @click="page++">下一页</button></div>
 <p>点歌排队 {{view?.state.queue.length||0}} 首 · 正在检索 {{view?.state.searches.length||0}} 首</p>
 <ol><li v-for="r in view?.state.queue" :key="r.id">{{r.userName}}：{{view?.state.tracks.find(t=>t.id===r.trackId)?.title}}</li></ol>
 <details><summary>音乐黑名单</summary><p>内置规则始终启用：{{view?.builtInBlacklist.join('、')}}</p><label>追加歌名、歌手或关键词（每行一项）</label><textarea v-model="blacklist" maxlength="6000" rows="4" :disabled="busy||view?.localTest"></textarea><button :disabled="busy||view?.localTest" @click="run('blacklist',blacklist)">保存追加黑名单</button><p>修改后音乐先停止，核对后重新开启。</p></details>
 <p class="hint">无人点歌自动轮播下方背景曲库，失败会换曲；全部暂不可播时每分钟尝试恢复。关闭音乐或播放器会停止，不会自己重启。OBS／直播姬只采群星和“群星控制器大肥鱼”的程序音频，并关闭桌面音频、麦克风；弹幕请在下方直接连接直播间。</p>
 </article>
</template>
<style scoped>
.music{display:block!important;background:#f5fbff;border:1px solid #c4def0;border-radius:12px;padding:22px;margin:15px 0;color:#345b7c}h3{font-size:16px}h3 span{float:right;font-size:11px;font-weight:400}p{font-size:12px;line-height:1.8;color:#7594ad}.buttons{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}button{font-size:12px;padding:8px 11px;color:#367daa;background:#e8f4ff;border:1px solid #bfd9ec;border-radius:6px}button:disabled{opacity:.5}.now{background:white;padding:13px;border-radius:7px;display:flex;justify-content:space-between;font-size:12px}label{display:flex;gap:12px;align-items:center;font-size:12px;margin:14px 0}form{display:flex;gap:8px}input:not([type=range]){flex:1;min-width:0;border:1px solid #bad6eb;border-radius:6px;background:white;padding:9px;color:#345b7c}ul,ol{padding-left:18px;font-size:12px;line-height:2.5}li button{margin-left:10px;padding:3px 8px}.qr{display:flex;align-items:center;gap:15px}.qr img{width:150px;height:150px;background:white}.hint{font-size:11px}
</style>
