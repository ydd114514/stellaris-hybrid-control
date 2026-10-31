<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue'
import type {CaptainSpeechBridge,CaptainSpeechView,CaptainSpeechAction} from '../../../packages/shared/src/stellaris-speech'
import type {AiHubBridge,AiDirectorStatus} from '../../../packages/shared/src/ai'
import {CAPTAIN_TUNED_VOICE} from '../../../packages/core/src/captain-tuned'
const props=defineProps<{api?:CaptainSpeechBridge;chatApi?:AiHubBridge}>(),view=ref<CaptainSpeechView>(),key=ref(''),message=ref(''),busy=ref(false),chatStatus=ref<AiDirectorStatus>(),chatBusy=ref(false),chatMessage=ref('')
const editing=ref(false)
let timer:ReturnType<typeof setInterval>|undefined,alive=true
async function refresh(){if(editing.value||busy.value)return;try{const x=await props.api?.view();if(alive&&x){if(view.value?.message!==x.message)message.value='';view.value=x}const chat=await props.chatApi?.view();if(alive&&chat)chatStatus.value=chat.status}catch{}}
async function run(action:CaptainSpeechAction){if(!props.api||busy.value&&action.type!=='stop')return;busy.value=true;try{const r=await props.api.action(action);if(!alive)return;view.value=r.view;message.value=r.message;if(action.type==='save-key'&&r.ok)key.value=''}catch{message.value='语音操作未完成，请重试。'}finally{busy.value=false}}
async function runChat(type:'start'|'stop'){if(!props.chatApi||chatBusy.value)return;chatBusy.value=true;try{const r=await props.chatApi.action({type:type==='start'?'start-chat':'stop'});if(!alive)return;chatStatus.value=r.view.status;chatMessage.value=r.message||r.view.status.message}catch{chatMessage.value='弹幕聊天操作未完成，请检查AI中枢配置。'}finally{chatBusy.value=false}}
onMounted(()=>{void refresh();timer=setInterval(()=>void refresh(),1500)});onUnmounted(()=>{alive=false;clearInterval(timer)})
</script>
<template><section class="captain-speech" data-testid="captain-speech"><header><span>FEIYU / VOICE & CHAT</span><h2>大肥鱼舰长 · 游戏解说与弹幕聊天</h2></header>
<p>大肥鱼以当前游戏记录为背景，用选定的自然聊天声线陪观众聊天。游戏打算与弹幕回复使用同一条千问语音队列，依次播放。</p>
<p>只朗读给观众看的简短行动打算，不朗读模型内部推理；游戏仍由独立控制器操作。</p>
<div v-if="chatApi" class="chat-controls" data-testid="captain-chat-controls"><h3>弹幕文字回复</h3><p>先在AI中枢配置场控模型，并在B站直播页连接房间。文字聊天可以独立启动，无需等待音色试听；模型请求按AI中枢预算计费。这里与AI中枢共用运行状态，停止中枢也会停止参谋调用，游戏控制器继续独立运行。</p><div class="voice-actions"><button :disabled="chatBusy||view?.localTest||chatStatus?.running" @click="runChat('start')">启动弹幕文字回复</button><button :disabled="chatBusy||view?.localTest||!chatStatus?.running" @click="runChat('stop')">停止AI中枢</button></div><p role="status">{{chatMessage||chatStatus?.message||'正在读取聊天状态…'}}</p></div>
<div v-if="view" class="voice-form" @focusin="editing=true" @focusout="editing=false"><label>模型<input :value="view.config.model" readonly></label><label>当前音色<input :value="view.config.voice" readonly></label><label>语速<input :value="view.config.rate" readonly></label>
<div v-if="view.tunedVoice?.ready"><p>推荐：{{view.tunedVoice.name}} · {{view.tunedVoice.duration?.toFixed(1)}}秒真实小样</p><button :disabled="busy||view.localTest" @click="run({type:'use-tuned-voice'})">使用已调好的角色声</button><audio v-if="view.playerUrl" controls preload="none" :src="view.playerUrl.replace('/player','/tuned.wav')" aria-label="推荐声音小样"/></div>
<label>百炼接口地址<input v-model="view.config.baseUrl" :disabled="busy||view.enabled||view.localTest"></label>
<label>业务空间ID<input v-model="view.config.workspaceId" :disabled="busy||view.enabled||view.localTest" placeholder="按音色所属业务空间填写；专属域名可包含该ID"></label>
<label>千问 API Key<input v-model="key" type="password" autocomplete="off" placeholder="使用这枚音色所属账号的 Key；只加密保存在本机"></label>
<div class="voice-actions"><button :disabled="busy||view.localTest||!key" @click="run({type:'save-key',key})">加密保存密钥</button><button :disabled="busy||view.localTest||view.enabled||!view.hasKey" @click="run({type:'query-voice'})">查询已保存设置的音色状态</button><button :disabled="busy||view.localTest" @click="run({type:'auditions'})">打开20版试听并选定</button></div>
<p v-if="view.voiceCheck" data-testid="captain-voice-check">{{view.voiceCheck.message}}<span v-if="view.voiceCheck.errorCode"> · {{view.voiceCheck.errorCode}}</span><span v-if="view.voiceCheck.serviceStatus"> · 状态 {{view.voiceCheck.serviceStatus}}</span></p>
<label><input v-model="view.config.narrateGame" type="checkbox">朗读游戏行动打算</label><label><input v-model="view.config.replyAudience" type="checkbox">朗读弹幕回复</label>
<label>每小时配音请求上限<input v-model.number="view.config.maxRequestsPerHour" type="number" min="10" max="600"></label><label>语音音量<input v-model.number="view.config.volume" type="range" min="0" max="1" step="0.05"></label>
<p>当前选定：{{view.config.presetId===CAPTAIN_TUNED_VOICE.id?CAPTAIN_TUNED_VOICE.name:view.config.presetId?`${view.config.presetId}号`:'尚未敲定'}} · 密钥{{view.hasKey?'已保存':'未保存'}} · {{view.enabled?'语音已开启':'语音已停止'}}</p>
<div class="voice-actions"><button :disabled="busy||view.localTest" @click="run({type:'save-config',config:view.config})">保存设置</button><button class="start" :disabled="busy||view.localTest||!view.hasKey||!view.config.presetId||view.enabled" @click="run({type:'start'})">启动语音与聊天</button><button :disabled="view.localTest" @click="run({type:'stop'})">停止语音与本模块聊天</button></div>
<div class="voice-actions"><button :disabled="busy||view.localTest" @click="run({type:'open-player'})">打开本机语音播放器</button><button :disabled="busy||view.localTest" @click="run({type:'close-player'})">关闭本机语音播放器</button></div>
<p>本机播放器用于直接试听；OBS已启用语音浏览器源时，请关闭本机播放器，让OBS统一送音。同一时刻由一个播放器占用语音，关闭后约5秒可由另一端接手。</p>
<p>直播画面地址使用 <code>http://127.0.0.1:17655/overlay?voice=1</code>，在直播软件中启用浏览器源音频。预览默认静音，避免重复播报；同一时刻只允许一个播放器输出。</p>
<p role="status">{{message||view.message}}</p><p class="usage">排队 {{view.queued}} 条 · 合成请求 {{view.usage.requests}} 次 · 已完成 {{view.usage.completed}} 次 · 失败 {{view.usage.failed}} 次 · 输入/输出 {{view.usage.inputTokens}} / {{view.usage.outputTokens}} tokens<span v-if="view.usage.missing"> · {{view.usage.missing}} 次未返回完整用量</span></p>
<p v-if="view.current">{{view.current.phase==='playing'?'正在朗读':'正在准备'}}：{{view.current.text}}</p></div>
<p v-else>请在群星控制器大肥鱼 桌面端使用；网页预览不会读取密钥或调用真实语音。</p></section></template>
<style scoped>.captain-speech{background:#fff;border:1px solid #bcd8ee;border-radius:12px;padding:25px;color:#315578}.captain-speech header span{font:11px Consolas;color:#6fa3c2;letter-spacing:2px}.captain-speech h2{font-size:22px;margin:10px 0 18px}.captain-speech p{line-height:1.8;margin:10px 0;font-size:13px;color:#6a8ca8}.voice-form{display:grid;gap:12px;margin-top:20px}.voice-form label{display:flex;gap:12px;align-items:center;font-size:13px}.voice-form input:not([type=checkbox]){flex:1;min-width:0;border:1px solid #cadceb;background:#f6faff;padding:9px;color:#395e7f;border-radius:6px}.voice-form input[readonly]{color:#8ba1b5}.voice-actions{display:flex;gap:10px;flex-wrap:wrap}.voice-actions button{padding:9px 15px;background:#e8f3fe;color:#3572a5;border-radius:6px}.voice-actions .start{color:white;background:#398ddd}.usage{font-size:12px!important}code{overflow-wrap:anywhere}</style>
