<script setup lang="ts">
import { computed, ref, watch } from 'vue'
const props=defineProps<{now:number;action:string;commandId?:string;showStove:boolean}>()
const questions=[
 ['今天哪件小事，','值得本鱼甩下尾巴？'],['如果能摸半天鱼，','你最想拿来做什么？'],['给今天的自己，','点一杯什么心情？'],['你心里的快乐，','是哪一道家乡小吃？'],['最近哪首歌，','让你的尾巴停不下？'],['晴天晒尾巴，','还是雨天窝着喝茶？'],['今天有什么话，','想说给本鱼听？'],['有哪部好电影，','值得店长偷个闲？'],['这杯茶的搭子，','选点心还是碎碎念？'],['最近的小进步，','也值得本鱼夸一下。'],['今天想热闹接梗，','还是安静摸会儿鱼？'],['把一件小烦恼，','先放在本鱼这儿吧。'],
]
const drawOffset=ref(0)
let lastDrawnId:string|undefined
watch([()=>props.commandId,()=>props.action],()=>{
 const id=props.commandId||String(props.now)
 if(props.action==='fortune'&&id!==lastDrawnId){drawOffset.value=(drawOffset.value+1)%questions.length;lastDrawnId=id}
})
const index=computed(()=>(Math.floor(props.now/90000)+drawOffset.value)%questions.length)
const lines=computed(()=>questions[index.value]!)
const mood=computed(()=>{
 if(['music','dance','flap'].includes(props.action))return {kind:'music',label:'尾巴替我打拍',eyes:'awake'}
 if(['read_chat','listen','nod','wave','heart','cheer'].includes(props.action))return {kind:'chat',label:'本鱼在线接梗',eyes:'awake'}
 if(['tea','toast','serve','brew_coffee','wipe_cup'].includes(props.action))return {kind:'tea',label:'先泡茶，再开唠',eyes:'rest'}
 if(['sleep','yawn','goodnight','blanket','sit','lean'].includes(props.action))return {kind:'rest',label:'营业，也要摸鱼',eyes:'rest'}
 if(props.action==='fortune')return {kind:'fortune',label:'翻翻本鱼小心思',eyes:'awake'}
 return {kind:'idle',label:'本店长有自己的节奏',eyes:'rest'}
})
</script>

<template>
 <g class="tea-corner" data-testid="tea-corner" :data-fish-mood="mood.kind">
  <!-- The whale's cup rests on a low table; feet meet the floor plane. -->
  <g v-if="showStove" data-testid="tea-stove" class="fish-desk" transform="translate(650 1334)">
   <ellipse cx="160" cy="229" rx="145" ry="13" fill="#283a37" fill-opacity=".23"/>
   <path d="M43 186H65L60 224H45ZM258 186H280L276 224H262Z" fill="#705237" stroke="#493c2c" stroke-width="3"/>
   <path d="M20 175H301V191H20Z" fill="#9c7448" stroke="#59432f" stroke-width="4"/>
   <path d="M20 175L34 164H288L301 175Z" fill="#c9a16a" stroke="#705237" stroke-width="3"/>
   <path d="M87 190V201M235 190V201" stroke="#59432f" stroke-width="3"/>
   <path d="M67 199H255V226H67Z" fill="#e8d4aa" stroke="#876841" stroke-width="3"/>
   <text x="161" y="218" text-anchor="middle" fill="#584b35" font-size="18" font-family="KaiTi,STKaiti,serif">{{mood.label}}</text>
   <ellipse cx="166" cy="163" rx="105" ry="10" fill="#594a35" fill-opacity=".25"/>
   <ellipse cx="165" cy="157" rx="111" ry="13" fill="#8ca39e" stroke="#456668" stroke-width="3"/>
   <ellipse cx="165" cy="152" rx="103" ry="9" fill="#d7e3d8"/>
   <g class="fish-tail">
    <path d="M209 86Q237 95 245 70Q250 55 267 55Q271 73 257 88Q279 79 291 89Q283 108 260 107Q238 108 220 114Z" fill="#528bbd" stroke="#355977" stroke-width="4"/>
    <path d="M247 98Q254 77 265 63M251 101Q271 95 283 91" fill="none" stroke="#8ab8d6" stroke-width="3" stroke-linecap="round"/>
   </g>
   <path d="M77 101Q66 57 102 36Q129 18 173 28Q224 38 233 83Q242 110 219 124H101Q80 120 77 101Z" fill="#5389bd" stroke="#345671" stroke-width="4"/>
   <path d="M85 82Q84 46 122 36Q141 29 160 34" fill="none" stroke="#8fb4dc" stroke-width="7" stroke-linecap="round"/>
   <path d="M108 94Q143 73 181 89Q205 100 208 121H103Z" fill="#dde9ed"/>
   <path d="M116 37Q109 23 120 17Q136 13 139 32" fill="#6d9bc7" stroke="#345671" stroke-width="3"/>
   <g v-if="mood.eyes==='awake'" fill="#2c4a66"><ellipse cx="116" cy="77" rx="5" ry="7"/><ellipse cx="177" cy="77" rx="5" ry="7"/><circle cx="117" cy="75" r="1.6" fill="#f8f1df"/><circle cx="178" cy="75" r="1.6" fill="#f8f1df"/></g>
   <path v-else d="M108 77q8 7 16 0M169 77q8 7 16 0" fill="none" stroke="#2c4a66" stroke-width="4" stroke-linecap="round"/>
   <path d="M140 91q7 6 14 0" fill="none" stroke="#345671" stroke-width="3" stroke-linecap="round"/>
   <ellipse cx="105" cy="89" rx="9" ry="4" fill="#dba8a5" fill-opacity=".65"/><ellipse cx="186" cy="89" rx="9" ry="4" fill="#dba8a5" fill-opacity=".65"/>
   <ellipse cx="156" cy="115" rx="88" ry="13" fill="#bfd2ca" stroke="#456668" stroke-width="4"/>
   <ellipse cx="156" cy="113" rx="78" ry="8" fill="#6f8c81"/>
   <path d="M73 116Q82 154 107 158H208Q230 151 239 116Z" fill="#d7e5dc" stroke="#456668" stroke-width="4"/>
   <path d="M237 121q32-3 26 15q-5 17-34 10" fill="none" stroke="#456668" stroke-width="8"/>
   <path d="M99 123Q124 131 147 129" fill="none" stroke="#f2f2df" stroke-width="5" stroke-linecap="round"/>
   <path d="M96 103Q91 119 108 124Q119 123 126 110" fill="#6598c6" stroke="#345671" stroke-width="3"/>
   <path d="M189 104Q184 120 200 125Q212 123 217 109" fill="#6598c6" stroke="#345671" stroke-width="3"/>
   <text x="161" y="148" text-anchor="middle" fill="#47695f" font-size="19" font-family="KaiTi,STKaiti,serif" letter-spacing="3">摸鱼专用杯</text>
   <g v-if="mood.kind==='music'" class="fish-note" fill="#8da997" font-size="29" font-family="serif"><text x="30" y="79">♪</text><text x="285" y="36">♫</text></g>
   <path v-else class="tea-steam" d="M48 117q-13-18 1-34M279 137q16-16 3-31" fill="none" stroke="#ecdfc0" stroke-width="4" stroke-linecap="round"/>
  </g>
  <!-- A floor-standing wooden radio/CRT, not a loose floating paper sign. -->
  <g data-testid="tea-topic-card" class="fish-terminal" transform="translate(650 1580)">
   <ellipse cx="160" cy="270" rx="147" ry="10" fill="#283a37" fill-opacity=".22"/>
   <path d="M31 238H59V267H34ZM262 238H290L287 267H262Z" fill="#6c5037" stroke="#483c2e" stroke-width="3"/>
   <rect x="0" y="0" width="320" height="246" rx="24" fill="#8a6848" stroke="#59442e" stroke-width="4"/>
   <path d="M22 11H298Q309 11 310 25V225Q303 235 294 235H24Q11 233 11 218V28Q11 16 22 11Z" fill="#af885a"/>
   <rect x="18" y="57" width="284" height="145" rx="19" fill="#3f605f" stroke="#664e36" stroke-width="5"/>
   <rect x="27" y="66" width="266" height="127" rx="12" fill="#dce5cf"/>
   <path d="M42 77H276M42 182H276" stroke="#b6c9b4" stroke-width="2"/>
   <circle cx="30" cy="32" r="5" fill="#bcd6bc"/><circle cx="47" cy="32" r="4" fill="#d1b27a"/>
   <text x="178" y="41" text-anchor="middle" fill="#f3e4c3" font-size="25" font-family="KaiTi,STKaiti,serif" letter-spacing="2">肥鱼脑内弹幕</text>
   <g :key="index" class="topic-lines" data-testid="tea-topic-lines" fill="#344e4b" text-anchor="middle" font-size="24" font-family="KaiTi,STKaiti,serif"><text v-for="(line,i) in lines" :key="i" x="160" :y="113+i*40">{{line}}</text></g>
   <path d="M29 216h43M29 222h43M29 228h43" stroke="#6f553b" stroke-width="3" stroke-linecap="round"/>
   <text x="185" y="227" text-anchor="middle" fill="#f1deba" font-size="18" font-family="KaiTi,STKaiti,serif">想说就说，本鱼听着</text>
   <circle cx="291" cy="222" r="8" fill="#537b80" stroke="#35565b" stroke-width="3"/>
  </g>
 </g>
</template>

<style scoped>
.tea-steam{animation:tea-steam 4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}.fish-tail{animation:tail-rest 5s ease-in-out infinite}.fish-note{animation:note-drift 2.8s ease-in-out infinite}.topic-lines{animation:topic-in .6s ease both}@keyframes tea-steam{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:.6;transform:translateY(-6px)}}@keyframes tail-rest{0%,100%{opacity:1}50%{opacity:.88}}@keyframes note-drift{0%,100%{opacity:.45;transform:translateY(0)}50%{opacity:1;transform:translateY(-5px)}}@keyframes topic-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.tea-steam,.fish-tail,.fish-note,.topic-lines{animation:none}}
</style>
