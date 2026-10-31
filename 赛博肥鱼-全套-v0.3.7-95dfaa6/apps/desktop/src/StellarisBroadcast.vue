<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import StellarisMusic from './StellarisMusic.vue'
import type { StellarisLiveInfo, StellarisBridge } from '../../../packages/shared/src/stellaris'
const props = defineProps<{ api?: StellarisBridge['live'];music?:StellarisBridge['music'] }>()
const info = ref<StellarisLiveInfo>(), busy = ref(false), notice = ref(''), failed = ref(false)
const roomId=ref('');let roomInitialized=false
let timer: ReturnType<typeof setInterval> | undefined, mounted = true
async function refresh() { if (!props.api || busy.value) return; try { const next = await props.api.info(); if (mounted) {info.value = next;if(!roomInitialized){roomInitialized=true;if(next.bilibili?.roomId)roomId.value=String(next.bilibili.roomId)}} } catch { if (mounted) { notice.value = '无法读取直播服务，请刷新桌面端。'; failed.value = true } } }
async function run(action: Parameters<NonNullable<StellarisBridge['live']>['action']>[0],value?:string) {
  if (!props.api || busy.value&&action!=='disconnectRoom' || info.value?.localTest) return
  busy.value = true
  try { const result = await props.api.action(action,value); if (mounted) { info.value = result.info; notice.value = result.message || ''; failed.value = !result.ok } }
  catch { if (mounted) { notice.value = '操作未完成，请稍后重试。'; failed.value = true } }
  finally { busy.value = false }
}
onMounted(async () => { mounted = true; await refresh(); if (mounted) timer = setInterval(() => void refresh(), 4000) })
onUnmounted(() => { mounted = false; clearInterval(timer) })
</script>
<template>
  <section class="broadcast" data-testid="stellaris-broadcast">
    <StellarisMusic :api="music"/>
    <div class="live-heading"><div><span>BILIBILI / STREAM SETUP</span><h2>把这段星海，带进直播间。</h2></div><b>{{ info?.ready ? '本机画面已就绪' : '等待准备画面' }}</b></div>
    <p class="intro">游戏由大肥鱼继续经营。直播软件负责采集实时游戏，蓝白框面负责弹幕、航行记事和解说字幕。</p>
    <p v-if="info?.localTest || !api" class="live-notice">{{ info?.localTest ? '独立离线测试：真实直播服务与接入操作已禁用。' : '请打开群星控制器大肥鱼 桌面端使用直播设置。' }}</p>
    <article><div class="step">弹幕</div><div class="step-content"><h3>连接 B 站直播间 <small>{{info?.bilibili?.status==='connected'?'真实连接已认证':info?.bilibili?.status==='retrying'?'正在重连':'尚未接通'}}</small></h3>
      <p>输入房间号，直接接收直播间弹幕。连接后同时开启已登录的 QQ 音乐：无人点歌播背景曲，有人点歌自动排队。不会替你开播。</p>
      <div class="live-actions"><input v-model="roomId" aria-label="B站直播间号" placeholder="直播间号或 live.bilibili.com 链接" style="min-width:280px;padding:9px;border:1px solid #bcd8ed;border-radius:6px;background:#fff;color:#345b7c"><button data-testid="connect-bilibili" :disabled="busy||!api||info?.localTest" @click="run('connectRoom',roomId)">连接直播间并开启音乐</button><button :disabled="busy||!api||info?.localTest" @click="run('loginBilibili')">B站扫码登录</button><button :disabled="!api||info?.localTest||info?.bilibili?.status==='stopped'" @click="run('disconnectRoom')">断开弹幕</button></div>
      <p role="status">{{info?.bilibili?.message||'尚未连接真实直播间。'}} 已收 {{info?.bilibili?.received||0}} 条真实弹幕。</p>
      <p class="hint">出现“真实连接已认证”才表示平台连接成功。首次连接和重连不回放旧弹幕；扫码在 B 站官方页面完成，昵称被隐藏时请登录。弹幕内容只用于显示和点歌。</p>
    </div></article>
    <article><div class="step">01</div><div class="step-content"><h3>画面与解说</h3><p>1920 × 1080 横屏。游戏区域位于 X 32、Y 78，宽 1504、高 846；右侧聊天和航行记事，下方是肥鱼的碎碎念。</p>
      <div class="live-actions"><button :disabled="busy || !api || info?.localTest" @click="run('prepare')">准备直播画面</button><button :disabled="busy || !api || info?.localTest" @click="run('preview')">打开静音预览</button><button :disabled="busy || !api || info?.localTest" @click="run('copyOverlay')">复制框面地址</button><button :disabled="busy || !api || info?.localTest" @click="run('exportObs')">导出 OBS 场景</button></div>
      <code>{{ info?.overlayUrl || 'http://127.0.0.1:17655/overlay?voice=1' }}</code><p class="hint">预览默认静音。开启舰长语音后，正式框面可播放游戏解说与弹幕回复；在 OBS 启用浏览器源音频，并关闭本机语音播放器以免占用播放通道。音乐使用独立程序音频源。</p></div></article>
    <article><div class="step">02</div><div class="step-content"><h3>本地弹幕接入 <small>{{ info?.input.status === 'stopped' || !info ? '未开启' : '本机监听中' }}</small></h3><p role="status">{{ info?.input.message || '尚未开启本地弹幕接入。' }}</p><div class="counters"><span>接收 {{ info?.input.received || 0 }} 条</span><span>拒绝 {{ info?.input.rejected || 0 }} 条</span><span>{{ info?.input.endpoint || '仅监听本机 127.0.0.1' }}</span></div>
      <div class="live-actions"><button :disabled="busy || !api || info?.localTest || (!!info && info.input.status !== 'stopped')" @click="run('start')">开启本地弹幕接入</button><button :disabled="busy || !api || info?.localTest || !info || info.input.status === 'stopped'" @click="run('copyInput')">复制接入配置</button><button :disabled="busy || !api || info?.localTest || !info || info.input.status === 'stopped'" @click="run('test')">测试本地接入</button><button :disabled="busy || !api || info?.localTest || !info || info.input.status === 'stopped'" @click="run('stop')">停止接入</button></div>
      <p class="hint">可选的外部工具转发接口。直接连接房间时无需开启此项。复制的配置含本机令牌；这里的测试只验证本地接口，不代表平台连接成功。弹幕不会变成游戏指令。</p></div></article>
    <article><div class="step">03</div><div class="step-content"><h3>在 B 站开播</h3><ol><li>OBS 中通过“场景集合 → 导入”加载导出的 JSON。核对画布为 1920 × 1080、游戏采集指向 stellaris.exe，框面在游戏层上方。</li><li>OBS 有第三方推流权限时，在你自己的账号中配置推流。否则使用直播姬采集游戏与框面，或通过 OBS 虚拟摄像机传入直播姬。</li><li>虚拟摄像机只传视频。声音需在直播姬另行采集群星和解说，或使用你选择的专用音频通道；先录一段本地样片，确认有声且没有回声。</li><li>确认字幕、音量、弹幕来源后，由你在直播姬或 OBS 手动开始直播。此处不会自动登录、读取推流密钥或替你开播。</li></ol></div></article>
    <div v-if="notice" :class="['live-notice', { failed }]" role="alert">{{ notice }}</div>
  </section>
</template>
<style scoped>
.broadcast{color:#345b7c}.live-heading{display:flex;justify-content:space-between;align-items:center;gap:20px}.live-heading span{font:10px Consolas,monospace;color:#86a5c2;letter-spacing:2px}.live-heading h2{font-size:24px;color:#244f7a;margin-top:10px}.live-heading b{font-size:11px;color:#5b91b6;background:#e2f2ff;border:1px solid #bddcf1;padding:7px 10px;border-radius:6px;white-space:nowrap;font-weight:400}.intro{font-size:13px;line-height:1.8;color:#7f9bb3;margin-top:14px;margin-bottom:22px}article{display:flex;gap:17px;padding:22px;background:#ffffffc7;border:1px solid #cbdff0;border-radius:12px;margin-bottom:15px}.step{font:18px Consolas,monospace;color:#5a97cb;border:1px solid #c5def2;background:#eff7ff;width:39px;height:39px;display:grid;place-items:center;border-radius:9px;flex:none}.step-content{min-width:0;flex:1}h3{font-size:15px;font-weight:600;display:flex;align-items:center;gap:12px}h3 small{font-size:11px;font-weight:400;color:#8aa8bf}p{font-size:12px;line-height:1.8;margin-top:8px;color:#7391ac}.live-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}button{border:1px solid #bcd8ed;background:#edf7ff;color:#3b7dad;border-radius:6px;font-size:12px;padding:9px 12px}button:hover:not(:disabled){background:#dfedff}.hint{font-size:11px;color:#94aabd}code{display:block;background:#f0f6fc;border:1px solid #dbe8f4;border-radius:6px;padding:10px;font:11px Consolas,monospace;color:#5b83a8;overflow-wrap:anywhere}.counters{display:flex;gap:20px;flex-wrap:wrap;font-size:11px;color:#91a9bd;margin-top:11px}ol{font-size:12px;color:#7a96af;line-height:1.9;padding-left:18px;margin-bottom:0}li{margin-top:7px}.live-notice{background:#e7f4f2;border:1px solid #c8e4de;padding:12px 16px;border-radius:7px;font-size:12px;line-height:1.7;color:#518a80;margin:15px 0}.live-notice.failed{background:#fff5e9;border-color:#ebd5bb;color:#ad7a50}
</style>
