<script setup lang="ts">
import { computed } from 'vue'
import type { SceneId } from '../../packages/shared/src/index'
import type { ShopTime } from '../../packages/shared/src/shop-time'

// The back of the shop: wall, weather window, lamps, shelf and the small things that keep moving on a quiet night.
const props = withDefaults(defineProps<{ scene: SceneId; running: boolean; decorations: string[]; action: string; time: ShopTime; showMenuText?: boolean; inviteToChat?: boolean }>(), { showMenuText: true, inviteToChat: false })
const seeded = (n: number, seed: number) => { let x = seed; return Array.from({ length: n }, () => { x = (x * 9301 + 49297) % 233280; const a = x / 233280; x = (x * 9301 + 49297) % 233280; const b = x / 233280; x = (x * 9301 + 49297) % 233280; return [a, b, x / 233280] as const }) }
const stars = seeded(46, 7).map(([a, b, c], i) => ({ x: 90 + a * 470, y: 425 + b * 330, r: 1.4 + c * 2.8, d: (i % 7) * .6 }))
const flakes = seeded(36, 11).map(([a, b, c], i) => ({ x: 70 + a * 510, y: b * 640, r: 2 + c * 5, d: -(b * 9), s: 7 + c * 6, i }))
const petals = seeded(14, 23).map(([a, b, c]) => ({ x: 80 + a * 900, d: -(b * 12), s: 9 + c * 7, r: c * 360 }))
const flies = seeded(14, 31).map(([a, b, c]) => ({ x: 100 + a * 450, y: 760 + b * 230, d: -(c * 6), s: 4 + c * 4 }))
const motes = seeded(9, 5).map(([a, b, c]) => ({ x: 420 + a * 220, y: 520 + b * 260, d: -(c * 10), s: 9 + c * 8 }))
const isNight = computed(() => props.time.phase === 'night')
const sky = computed(() => ({
  morning: { rain: ['#879eac', '#c9d7ce'], snow: ['#b2c9dd', '#e3ece7'], stars: ['#91bdd4', '#eee1bb'], sakura: ['#a5c7d4', '#f3d9cd'], fireflies: ['#91bdc2', '#d5dfb9'] },
  day: { rain: ['#8daab7', '#c8d9d4'], snow: ['#b4d2e7', '#edf7f4'], stars: ['#6db3d9', '#cce9e5'], sakura: ['#9cc6de', '#eedbd9'], fireflies: ['#87c4ce', '#c7dfb7'] },
  dusk: { rain: ['#73848f', '#d0ada0'], snow: ['#90a2bb', '#e9cfbd'], stars: ['#8573a1', '#f2b181'], sakura: ['#ad8bab', '#edbcb7'], fireflies: ['#7a899d', '#d6b88e'] },
  night: { rain: ['#152a35', '#30464c'], snow: ['#2a3a4f', '#55687a'], stars: ['#0b1430', '#1d2f55'], sakura: ['#2b2140', '#5a3c5e'], fireflies: ['#0f2426', '#21403a'] },
}[props.time.phase][props.scene]))
const wall = computed(() => ({ morning: ['#b49a75', '#e9dcc0', '#7c8b65'], day: ['#c3aa80', '#eee1c5', '#83916c'], dusk: ['#9c7856', '#c6a272', '#5d6a4c'], night: ['#514c38', '#7c6748', '#304638'] }[props.time.phase]))
const floor = computed(() => ({ morning: ['#a48b61', '#5b6048'], day: ['#af9568', '#69704f'], dusk: ['#896847', '#4f5540'], night: ['#5b4833', '#2b3e30'] }[props.time.phase]))
const pointing = computed(() => props.action === 'stargaze' || props.action === 'watch_rain')
</script>

<template>
  <svg class="shop-scene" :class="['phase-'+time.phase, { 'is-daylight': !isNight }]" :data-time-phase="time.phase" viewBox="0 0 1080 1920" role="img" :aria-label="time.title+'的背景'">
    <defs>
      <linearGradient id="wall" x1="0" x2=".8" y1="0" y2="1"><stop :stop-color="wall[0]"/><stop offset=".55" :stop-color="wall[1]"/><stop offset="1" :stop-color="wall[2]"/></linearGradient>
      <linearGradient id="night" x1="0" x2="0" y1="0" y2="1"><stop :stop-color="sky[0]"/><stop offset="1" :stop-color="sky[1]"/></linearGradient>
      <linearGradient id="floor" x1="0" x2="0" y1="0" y2="1"><stop :stop-color="floor[0]"/><stop offset="1" :stop-color="floor[1]"/></linearGradient>
      <radialGradient id="daySun"><stop stop-color="#fff6c9" stop-opacity=".9"/><stop offset=".4" stop-color="#ffe7ac" stop-opacity=".3"/><stop offset="1" stop-color="#ffe6ab" stop-opacity="0"/></radialGradient>
      <linearGradient id="daylight" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff3c1" stop-opacity=".2"/><stop offset="1" stop-color="#fff1bc" stop-opacity="0"/></linearGradient>
      <radialGradient id="lampGlow"><stop stop-color="#ffcf82" stop-opacity=".22"/><stop offset="1" stop-color="#ffcc7e" stop-opacity="0"/></radialGradient>
      <radialGradient id="glow"><stop stop-color="#ffd08b" stop-opacity=".42"/><stop offset="1" stop-color="#ffd08b" stop-opacity="0"/></radialGradient>
      <linearGradient id="tankWater" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#9fd6dc" stop-opacity=".55"/><stop offset="1" stop-color="#3f8d9a" stop-opacity=".7"/></linearGradient>
      <radialGradient id="flyGlow"><stop stop-color="#f4ffad"/><stop offset=".35" stop-color="#d8f37a" stop-opacity=".55"/><stop offset="1" stop-color="#c6ea5f" stop-opacity="0"/></radialGradient>
      <pattern id="wallLines" width="130" height="130" patternUnits="userSpaceOnUse"><path d="M0 130V0H130" fill="none" stroke="#d7c6a0" stroke-opacity=".035" stroke-width="2"/></pattern>
      <pattern id="rain" width="91" height="250" patternUnits="userSpaceOnUse" patternTransform="rotate(12)"><path d="M15 0v38 M65 95v54 M35 195v22" stroke="#b8e0df" stroke-opacity=".28" stroke-width="2" stroke-linecap="round"/></pattern>
      <pattern id="rainFar" width="60" height="160" patternUnits="userSpaceOnUse" patternTransform="rotate(12)"><path d="M10 0v20 M40 80v26" stroke="#9cc6c8" stroke-opacity=".16" stroke-width="1.5" stroke-linecap="round"/></pattern>
      <clipPath id="windowClip"><rect x="78" y="410" width="490" height="600" rx="172"/></clipPath>
      <filter id="softGlow"><feGaussianBlur stdDeviation="7"/></filter>
      <filter id="drop"><feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#090f12" flood-opacity=".4"/></filter>
    </defs>
    <rect width="1080" height="1920" fill="url(#wall)"/>
    <rect width="1080" height="1435" fill="url(#wallLines)"/>
    <ellipse cx="520" cy="960" rx="680" ry="690" fill="url(#lampGlow)" class="room-lamp-glow"/>
    <path d="M0 270H1080M0 282H1080" stroke="#101f24" stroke-width="12"/>
    <rect x="0" y="286" width="1080" height="12" fill="#79664c" opacity=".24"/>

    <g data-testid="teahouse-architecture">
      <path d="M0 0H1080V58Q540 86 0 58Z" fill="#3e3025"/><path d="M0 57Q540 89 1080 57" fill="none" stroke="#a88550" stroke-width="7"/>
      <g stroke="#6e5035" stroke-width="7" opacity=".7"><path v-for="n in 15" :key="n" :d="'M'+(n*78-70)+' 0l-22 58'"/></g>
      <rect y="240" width="1080" height="20" fill="#765637"/><path d="M0 266H1080" stroke="#b08d5b" stroke-width="5"/>
      <path d="M24 260V1310M1056 260V1310" stroke="#674d35" stroke-width="24"/>
      <path d="M34 262V1310M1046 262V1310" stroke="#bb9864" stroke-width="4" opacity=".55"/>
      <g fill="#557447" opacity=".8" transform="translate(6 292)"><path d="M0 0q100 80 48 270M35 60q-5-72 54-61q-5 48-54 61M42 95q30-65 76-38q-16 49-76 38M48 150q-30-56-61-28q13 41 61 28M42 195q38-50 72-20q-24 41-72 20"/></g>
    </g>
    <g transform="translate(0 -100)">
    <!-- The window: its weather is tonight's scene, chosen by the audience vote. -->
    <rect x="63" y="393" width="520" height="634" rx="185" fill="#141f22" stroke="#83725c" stroke-width="12"/>
    <g clip-path="url(#windowClip)">
      <rect x="78" y="410" width="490" height="600" fill="url(#night)" class="sky-fade"/>
      <g v-if="isNight && scene === 'stars'" data-testid="night-stars"><circle v-for="(s, i) in stars" :key="i" :cx="s.x" :cy="s.y" :r="s.r" fill="#fff6d8" class="twinkle" :style="{ animationDelay: s.d + 's' }"/><path class="shooting-star" d="M470 440l-110 52" stroke="#fff4cf" stroke-width="3" stroke-linecap="round"/></g>
      <g v-if="isNight" data-testid="sky-moon"><g v-if="scene !== 'rain'"><circle cx="440" cy="520" r="44" fill="#f3ecd0" :opacity="scene === 'stars' ? .95 : .7"/><circle cx="458" cy="505" r="42" :fill="sky[0]" v-if="scene !== 'fireflies'"/><circle cx="440" cy="520" r="90" fill="#f3ecd0" opacity=".08"/></g><g v-else><circle cx="427" cy="537" r="49" fill="#d9ddd1" opacity=".4"/><circle cx="446" cy="518" r="48" fill="#1c303a"/></g></g>
      <g v-else data-testid="sky-sun" :transform="`translate(440 ${time.phase === 'dusk' ? 660 : time.phase === 'morning' ? 568 : 510})`" :opacity="scene==='rain'?.42:scene==='snow'?.65:1"><circle r="132" fill="url(#daySun)"/><circle r="42" :fill="time.phase==='dusk'?'#ffd2a0':'#fff0b8'"/><g stroke="#fff0bd" stroke-width="4" stroke-linecap="round" opacity=".55"><path d="M0-60v-13M0 60v13M-60 0h-13M60 0h13M-43-43l-9-9M43 43l9 9M43-43l9-9M-43 43l-9 9"/></g></g>
      <g v-if="!isNight" class="day-clouds" :opacity="scene==='rain'?.62:.34" fill="#f1f5e8"><path d="M90 548q20-26 44-8q12-31 40-23q20 3 24 28q26-11 41 13H90Z"/><path d="M324 614q26-31 55-8q12-40 49-28q24 4 30 33q32-16 55 14H324Z"/></g>
      <g :opacity="isNight?.5:.34" :fill="isNight?(scene === 'snow' ? '#2c3b4a' : '#10232e'):(scene==='snow'?'#8399a9':'#668b89')"><path d="M70 900Q172 645 300 815Q440 585 590 830V1040H70Z"/><path d="M78 988Q180 825 300 927Q450 740 580 930V1040H78Z"/></g>
      <g v-if="scene === 'snow'" fill="#e8eef3" opacity=".75"><path d="M80 712h57v-6h-57Z M137 632h72v-7h-72Z M263 582h88v-8h-88Z M431 687h60v-6h-60Z M491 787h80v-7h-80Z"/></g>
      <g v-if="isNight" :fill="scene === 'sakura' ? '#f2c6d6' : '#ddc292'" opacity=".55"><rect x="160" y="690" width="9" height="17" class="window-light"/><rect x="284" y="623" width="9" height="15"/><rect x="318" y="660" width="9" height="15" class="window-light slow"/><rect x="397" y="806" width="12" height="18"/><rect x="493" y="830" width="12" height="18" class="window-light"/></g>
      <!-- rain: two depths of rain and a car's headlights sweeping past now and then -->
      <g v-if="scene === 'rain'" data-testid="weather-rain"><rect class="rain-layer far" x="30" y="300" width="600" height="1000" fill="url(#rainFar)"/><rect class="rain-layer" x="30" y="300" width="600" height="1000" fill="url(#rain)"/><rect v-if="isNight" class="headlights" x="-260" y="880" width="260" height="70" rx="35" fill="#ffe7b0" opacity=".0" filter="url(#softGlow)"/></g>
      <g v-if="scene === 'snow'"><circle v-for="f in flakes" :key="f.i" :cx="f.x" :cy="380" :r="f.r" fill="#f4f7fb" :opacity=".5 + f.r / 14" class="flake" :style="{ animationDelay: f.d + 's', animationDuration: f.s + 's' }"/></g>
      <g v-if="scene === 'sakura'"><path d="M560 430q-120 40-190 20q-60-15-120 30" stroke="#3a2632" stroke-width="12" fill="none" stroke-linecap="round"/><g fill="#f4b9cd"><circle cx="360" cy="452" r="22"/><circle cx="300" cy="470" r="18"/><circle cx="450" cy="440" r="20"/><circle cx="520" cy="436" r="16"/><circle cx="398" cy="470" r="14" fill="#f8d2df"/></g></g>
      <g v-if="scene === 'fireflies'"><path d="M78 1010q40-90 70-20q25-110 60-10q30-80 55 0q40-120 70 5q35-90 60 0q30-70 60 5q40-100 60 20Z" :fill="isNight?'#0b1c1a':'#70956a'"/><g v-if="isNight" data-testid="night-fireflies"><circle v-for="(f, i) in flies" :key="i" :cx="f.x" :cy="f.y" r="14" fill="url(#flyGlow)" class="firefly" :style="{ animationDelay: f.d + 's', animationDuration: f.s + 's' }"/></g></g>
      <path d="M142 500q20 190 0 460M505 540q-18 140-2 390" stroke="#d4eeeb" stroke-width="4" opacity=".08" fill="none"/>
      <path v-if="scene === 'rain' || scene === 'snow'" d="M95 940q60-18 120 4t130-8t140 10t80-4V1010H95Z" fill="#c9dbe0" opacity=".06"/>
    </g>
    <path d="M322 411V1006M79 741H568" stroke="#7b7059" stroke-width="13"/>
    <path d="M326 413V1004M82 746H565" stroke="#1b292c" stroke-width="5"/>
    <path v-if="!isNight" d="M79 748H566L1020 1400H250Z" fill="url(#daylight)" class="sunbeam"/>
    <rect x="49" y="1000" width="548" height="34" rx="8" fill="#796249"/><rect x="49" y="1028" width="548" height="9" fill="#15272a" opacity=".5"/>
    <path v-if="scene === 'snow'" d="M55 1002q40-16 90-4t110-6t120 4t130-4t90 6v8H55Z" fill="#eef3f6" opacity=".85"/>
    <g v-if="pointing" class="window-sparkle"><path d="M190 560l6 14l14 6l-14 6l-6 14l-6-14l-14-6l14-6Z" fill="#fff1c4"/><path d="M500 640l4 9l9 4l-9 4l-4 9l-4-9l-9-4l9-4Z" fill="#fff1c4"/></g>

    <g class="tea-couplets" fill="#4f4930" font-family="KaiTi,STKaiti,serif" font-size="29" text-anchor="middle">
      <rect x="39" y="594" width="51" height="294" rx="3" fill="#ddc596" stroke="#8b673d" stroke-width="4"/><rect x="997" y="594" width="51" height="294" rx="3" fill="#ddc596" stroke="#8b673d" stroke-width="4"/>
      <text x="64" y="649"><tspan x="64">半</tspan><tspan x="64" dy="58">日</tspan><tspan x="64" dy="58">清</tspan><tspan x="64" dy="58">闲</tspan></text><text x="1023" y="649"><tspan x="1023">一</tspan><tspan x="1023" dy="58">盏</tspan><tspan x="1023" dy="58">清</tspan><tspan x="1023" dy="58">欢</tspan></text>
    </g>
    <!-- A wall clock whose pendulum keeps time with the night. -->
    <g transform="translate(182 338)" data-testid="shop-clock"><circle r="40" fill="#1a2629" stroke="#9a8460" stroke-width="6"/><circle r="31" fill="#e7dcc2" opacity=".9"/><g stroke="#3d3a30" stroke-width="2.5"><path d="M0-25v5M0 25v-5M-25 0h5M25 0h-5"/></g><path class="clock-hand" d="M0 0V-20" stroke="#3d3a30" stroke-width="4" stroke-linecap="round"/><path class="clock-hand-fast" d="M0 0V-26" stroke="#b5654b" stroke-width="2" stroke-linecap="round"/><circle r="3.5" fill="#3d3a30"/><g class="pendulum"><path d="M0 40v42" stroke="#9a8460" stroke-width="3"/><circle cy="88" r="9" fill="#c9a76c"/></g></g>

    <!-- Hanging lights with moths that circle the warm one. -->
    <g class="pendant"><path d="M520 287v147" stroke="#111f22" stroke-width="6"/><ellipse cx="520" cy="431" rx="57" ry="66" fill="#d9ac6a" stroke="#785433" stroke-width="5"/><path d="M480 392q-20 40 0 80M520 366v130M560 392q20 40 0 80" fill="none" stroke="#a87b45" stroke-width="3"/><path d="M504 497h32v14h-32Z" fill="#735031"/><path d="M520 510v37m-8-16v20m16-20v20" stroke="#c49552" stroke-width="4"/><ellipse cx="520" cy="452" rx="63" ry="10" fill="#ffdc9b"/><circle cx="520" cy="462" r="9" fill="#ffedb7"/><ellipse cx="520" cy="660" rx="236" ry="260" fill="url(#glow)"/></g>
    <g v-if="isNight" transform="translate(520 470)"><g class="moth"><path d="M70 0l-7-6l-1 6l1 6Z M70 0l7-6l1 6l-1 6Z" fill="#e8dcc0" opacity=".75"/></g><g class="moth b"><path d="M48 0l-5-4l-1 4l1 4Z M48 0l5-4l1 4l-1 4Z" fill="#e8dcc0" opacity=".6"/></g></g>
    <g><path d="M920 287v150" stroke="#101e22" stroke-width="5"/><path d="M877 455q7-39 43-39t43 39Z" fill="#bd965e"/><ellipse cx="920" cy="456" rx="42" ry="8" fill="#f7cf88"/><ellipse cx="920" cy="600" rx="160" ry="200" fill="url(#glow)" opacity=".6"/></g>
    <circle v-for="(m, i) in motes" :key="'m' + i" :cx="m.x" :cy="m.y" r="2.4" fill="#ffe8b8" class="mote" :style="{ animationDelay: m.d + 's', animationDuration: m.s + 's' }"/>

    <!-- Tea menu, glazed tea caddies and warm paper lanterns. -->
    <rect x="640" y="491" width="368" height="302" rx="10" fill="#18282a" stroke="#837157" stroke-width="12" data-testid="shop-menu"/>
    <text v-if="showMenuText && !inviteToChat" x="824" y="552" text-anchor="middle" fill="#d8c4a0" font-size="28" letter-spacing="8" font-family="serif">{{time.menuLabel}}</text>
    <path d="M703 579H914" stroke="#b3a080" stroke-opacity=".4"/>
    <g v-if="showMenuText && !inviteToChat" fill="#bfbea4" font-size="24" font-family="serif"><text x="701" y="628">碧螺春</text><text x="911" y="628" text-anchor="end">清香回甘</text><text x="701" y="676">{{time.teaLabel}}</text><text x="911" y="676" text-anchor="end">{{time.teaNote}}</text><text x="701" y="724">听你说</text><text x="911" y="724" text-anchor="end">随时免费</text></g>
    <g v-if="inviteToChat" data-testid="chat-invitation-sign" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, sans-serif">
      <text x="824" y="551" fill="#e5d4aa" font-size="30" letter-spacing="2" data-testid="chat-sign-heading">清茶一盏 · 闲话半日</text>
      <text x="824" y="639" fill="#fff0cd" font-size="32" font-weight="600" data-testid="chat-sign-main">和肥鱼喝杯茶</text>
      <text x="824" y="716" fill="#b8c4ac" font-size="20" data-testid="chat-sign-example">发个「你好」，入座聊聊</text>
    </g>
    <g data-testid="tea-storage-rack">
      <rect x="662" y="798" width="346" height="116" rx="5" fill="#68543b" fill-opacity=".23"/>
      <path d="M662 800H1008M668 802V914M1002 802V914" fill="none" stroke="#8c6b46" stroke-width="10"/>
      <path d="M672 808H998" stroke="#c1a16c" stroke-width="3" opacity=".6"/>
      <path d="M684 934v40l40-40ZM986 934v40l-40-40Z" fill="#655037" stroke="#4f412e" stroke-width="3"/>
      <circle cx="689" cy="961" r="3" fill="#c9af7e"/><circle cx="981" cy="961" r="3" fill="#c9af7e"/>
      <rect x="662" y="914" width="352" height="22" rx="5" fill="#977453"/>
      <path d="M670 917H1006" stroke="#c8a573" stroke-width="3"/>
      <ellipse cx="725" cy="913" rx="29" ry="4" fill="#463c29" opacity=".3"/><ellipse cx="793" cy="913" rx="27" ry="4" fill="#463c29" opacity=".3"/><ellipse cx="857" cy="913" rx="15" ry="4" fill="#463c29" opacity=".3"/><ellipse cx="930" cy="913" rx="41" ry="5" fill="#463c29" opacity=".3"/>
      <g :class="{ 'jar-jiggle': action === 'tidy_shelf' }"><rect x="700" y="834" width="50" height="79" rx="8" fill="#b7a980"/><rect x="705" y="829" width="40" height="12" rx="4" fill="#7f7050"/><rect x="704" y="860" width="42" height="30" fill="#e0ccb0"/><path d="M717 876q10-15 17 0q-10 12-17 0" fill="#656a4e"/></g>
      <g><rect x="769" y="849" width="48" height="64" rx="7" fill="#997557"/><rect x="775" y="843" width="36" height="12" rx="3" fill="#c5ac78"/><rect x="775" y="869" width="36" height="21" fill="#dbc5a1"/></g>
      <path d="M849 914v-100h17v100Z" fill="#667969"/><rect x="849" y="807" width="17" height="18" rx="4" fill="#b19970"/>
      <g><rect x="895" y="855" width="69" height="58" rx="8" fill="#d1c6a3"/><path d="M964 867q24 0 20 22t-20 10" fill="none" stroke="#d1c6a3" stroke-width="9"/><path class="steam" d="M915 845q-10-18 2-32M940 845q12-16 0-30" fill="none" stroke="#e3dbbd" stroke-width="3" opacity=".4"/></g>
    </g>
    <g transform="translate(0 -59)">
      <ellipse cx="170" cy="1059" rx="38" ry="6" fill="#3b3e2a" opacity=".28"/>
      <g class="plant" :class="{ watered: action === 'water_plant' }"><path d="M170 1005V903M170 955q-47-45-55-12q8 27 55 27M170 935q41-49 52-19q-8 24-52 31M170 918q-25-34-26-50q31 5 26 50" fill="#7c9470" stroke="#3b614c" stroke-width="5"/>
        <g v-if="decorations.includes('plant')" data-decoration="plant"><path d="M170 953q-3-52 35-72q18 24-18 48M170 921q-12-55 8-73q24 21-8 73M169 947q-40-8-53-36q31-8 53 36" fill="#8ca578" stroke="#48705a" stroke-width="4"/></g>
        <path d="M132 983h76l-13 76h-50Z" fill="#af7959"/><ellipse cx="170" cy="983" rx="39" ry="8" fill="#684e3b"/><path v-if="decorations.includes('plant')" d="M148 1028h43" stroke="#d3ac7d" stroke-width="4"/>
      </g>
    </g>

    </g>
    <!-- Back wall panelling and wooden floor. -->
    <path d="M0 1180H1080V1455H0Z" :fill="isNight?'#263532':wall[2]"/><path d="M0 1180H1080M0 1196H1080" stroke="#52604b" stroke-width="6"/>
    <g stroke="#14282a" stroke-width="4" opacity=".6"><path d="M80 1200v240M200 1200v240M320 1200v240M440 1200v240M560 1200v240M680 1200v240M800 1200v240M920 1200v240M1040 1200v240"/></g>
    <path d="M0 1440H1080V1920H0Z" fill="url(#floor)"/>
    <path d="M0 1448H1080" stroke="#101f22" stroke-width="18"/>
    <g stroke="#a58e65" stroke-width="3" opacity=".13"><path d="M540 1448L160 1920M540 1448L-400 1920M540 1448L850 1920M540 1448L1400 1920M0 1530H1080M0 1660H1080M0 1830H1080"/></g>
    <ellipse cx="537" cy="1530" rx="395" ry="70" fill="#c8a873" opacity=".07"/>
    <g v-if="scene === 'sakura'"><g v-for="(p, i) in petals" :key="'p' + i" :transform="`translate(${p.x} 0)`"><path class="petal" d="M0 0q9-9 16 0q-7 9-16 0Z" fill="#f6c0d2" :style="{ animationDelay: p.d + 's', animationDuration: p.s + 's' }"/></g></g>

    <!-- Permanent decorations the audience unlocked together. -->
    <g v-if="decorations.includes('star_lamp')" data-decoration="star_lamp"><path d="M30 325q500 140 1000 0" stroke="#5e604c" stroke-width="3" fill="none"/><circle v-for="n in 12" :key="n" :cx="35 + n * 77" :cy="335 + Math.sin(n / 13 * Math.PI) * 55" r="7" fill="#ffe0a0" class="fairy-light" :style="{ animationDelay: (n % 4) * .5 + 's' }"/></g>
    <g v-if="decorations.includes('neon')" data-decoration="neon" data-testid="shop-sign"><rect x="1005" y="1080" width="50" height="200" rx="7" fill="#344c38" stroke="#ab8e55" stroke-width="3"/><text x="1030" y="1120" text-anchor="middle" fill="#d7d9a1" font-size="25" font-family="KaiTi,serif"><tspan x="1030">茶</tspan><tspan x="1030" dy="45">温</tspan><tspan x="1030" dy="45">正</tspan><tspan x="1030" dy="45">好</tspan></text></g>
    <!-- The fish tank on the windowsill: a small fish, rising bubbles. -->
    <g v-if="decorations.includes('tank')" data-decoration="tank" transform="translate(470 796)">
      <ellipse cx="0" cy="105" rx="60" ry="7" fill="#3b3e2a" opacity=".24"/><rect x="-59" y="104" width="118" height="8" rx="3" fill="#b39462"/>
      <rect x="-52" y="0" width="104" height="104" rx="14" fill="url(#tankWater)" stroke="#d6eef0" stroke-opacity=".5" stroke-width="4"/>
      <path d="M-40 92q10-20 20 0q10-16 20 0q10-22 20 0q10-14 16 0v8h-76Z" fill="#6f9a6e"/>
      <g class="tank-fish"><path d="M-14 46q14-14 28 0q-14 14-28 0Z M14 46l10-8v16Z" fill="#f2a46a"/><circle cx="-6" cy="44" r="2" fill="#2d2a26"/></g>
      <circle class="bubble" cx="18" cy="80" r="4" fill="none" stroke="#e8f8f8" stroke-width="2"/><circle class="bubble b" cx="26" cy="86" r="3" fill="none" stroke="#e8f8f8" stroke-width="2"/>
    </g>
    <g v-if="decorations.includes('chime')" data-decoration="chime" transform="translate(1028 990)"><path d="M0-150V-50" stroke="#8d7a5a" stroke-width="2"/><path d="M-9-151h18" stroke="#6e573c" stroke-width="4"/><g class="chime"><path d="M0-50V0" stroke="#8d7a5a" stroke-width="2"/><path d="M-18 0q18-26 36 0Z" fill="#cfe3e6" opacity=".85"/><path d="M0 0v34" stroke="#b9a37a" stroke-width="2"/><rect x="-8" y="34" width="16" height="26" rx="3" fill="#e9d9b0"/></g></g>
    <g class="open-sign" transform="translate(0 -180)" :class="{ dim: !running }"><path d="M754 1016v39M922 1016v39" stroke="#6e573c" stroke-width="4"/><circle cx="754" cy="1016" r="4" fill="#d7bc83"/><circle cx="922" cy="1016" r="4" fill="#d7bc83"/><rect x="729" y="1055" width="218" height="80" rx="10" fill="#18262b" stroke="#b3a274" stroke-width="3"/><text x="838" y="1110" text-anchor="middle" fill="#e5c17e" font-size="40" letter-spacing="9" :class="{ 'sign-on': action === 'toggle_sign' }">{{ running ? '营业中' : '小憩中' }}</text><rect x="734" y="1060" width="208" height="70" rx="6" fill="none" stroke="#dec388" stroke-opacity=".2" stroke-width="2"/></g>
  </svg>
</template>

<style scoped>
.sky-fade{transition:fill 1s}
stop{transition:stop-color 1.2s ease}.is-daylight .room-lamp-glow{opacity:.35}.is-daylight .pendant{opacity:.75}.is-daylight .fairy-light{opacity:.55}.day-clouds{animation:clouds 35s ease-in-out infinite alternate}.sunbeam{pointer-events:none}
.rain-layer{animation:rain 2.2s linear infinite}.rain-layer.far{animation-duration:3.4s}
.headlights{animation:headlights 17s ease-in-out infinite}
.flake{animation:snow linear infinite}
.twinkle{animation:twinkle 3.6s ease-in-out infinite}
.shooting-star{stroke-dasharray:0 140;animation:shoot 11s ease-out infinite}
.petal{animation:petal linear infinite}
.firefly{animation:firefly ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}
.window-light{animation:windowLight 9s steps(1) infinite}.window-light.slow{animation-duration:14s;animation-delay:-4s}
.pendant{animation:lamp 8s ease-in-out infinite}
.moth{animation:orbit 5.5s linear infinite}.moth.b{animation-duration:7.5s;animation-direction:reverse}
.mote{animation:mote ease-in-out infinite alternate}
.clock-hand{transform-origin:0 0;animation:spin 240s linear infinite}.clock-hand-fast{transform-origin:0 0;animation:spin 60s steps(60) infinite}
.pendulum{transform-origin:0 40px;animation:pendulum 2s ease-in-out infinite}
.steam{animation:steam 3s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.plant{transform-box:fill-box;transform-origin:center bottom;animation:sway 6s ease-in-out infinite}.plant.watered{animation:perk 1.4s ease-in-out infinite}
.jar-jiggle{transform-box:fill-box;transform-origin:center bottom;animation:jiggle .5s ease-in-out infinite}
.open-sign{filter:drop-shadow(0 0 9px #ddc28335)}.open-sign.dim{opacity:.45}.sign-on{animation:signOn 1.2s steps(2) 2}
.fairy-light{animation:light 4s ease-in-out infinite}
.neon-text{animation:neon 12s steps(1) infinite}
.tank-fish{animation:swim 6s ease-in-out infinite}
.bubble{animation:bubble 2.6s linear infinite}.bubble.b{animation-delay:-1.3s}
.chime{transform-origin:0 -50px;animation:chime 3.4s ease-in-out infinite}
.window-sparkle{animation:light 1.4s ease-in-out infinite}
@keyframes rain{to{transform:translateY(250px)}}
@keyframes clouds{to{transform:translateX(16px)}}
@keyframes headlights{0%,70%{transform:translateX(0);opacity:0}74%{opacity:.35}88%{transform:translateX(900px);opacity:.25}90%,100%{transform:translateX(900px);opacity:0}}
@keyframes snow{from{transform:translate(0,0)}50%{transform:translate(14px,330px)}to{transform:translate(-6px,660px)}}
@keyframes twinkle{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes shoot{0%,86%{stroke-dasharray:0 140;stroke-dashoffset:0;opacity:0}88%{opacity:1}94%{stroke-dasharray:60 140;stroke-dashoffset:-60}100%{stroke-dasharray:0 140;stroke-dashoffset:-140;opacity:0}}
@keyframes petal{from{transform:translate(0,280px) rotate(0)}to{transform:translate(-160px,1700px) rotate(540deg)}}
@keyframes firefly{0%{transform:translate(0,0);opacity:.15}40%{opacity:1}100%{transform:translate(26px,-38px);opacity:.3}}
@keyframes windowLight{0%{opacity:1}40%{opacity:.15}70%{opacity:1}}
@keyframes lamp{0%,100%{opacity:1}45%{opacity:.86}50%{opacity:.97}}
@keyframes orbit{from{transform:rotate(0) scaleY(.45)}to{transform:rotate(360deg) scaleY(.45)}}
@keyframes mote{from{transform:translate(0,0);opacity:.15}to{transform:translate(18px,-46px);opacity:.7}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pendulum{0%,100%{transform:rotate(9deg)}50%{transform:rotate(-9deg)}}
@keyframes steam{0%,100%{opacity:.15;transform:translateY(0)}50%{opacity:.5;transform:translateY(-12px)}}
@keyframes sway{0%,100%{transform:rotate(-1deg)}50%{transform:rotate(1.3deg)}}
@keyframes perk{0%,100%{transform:rotate(-2deg) scaleY(1)}50%{transform:rotate(2deg) scaleY(1.04)}}
@keyframes jiggle{0%,100%{transform:rotate(0)}30%{transform:rotate(-4deg)}70%{transform:rotate(4deg)}}
@keyframes signOn{50%{opacity:.3}}
@keyframes light{0%,100%{opacity:.6}50%{opacity:1}}
@keyframes neon{0%,93%,95%,97%{opacity:1}94%,96%{opacity:.45}}
@keyframes swim{0%,100%{transform:translateX(-14px) scaleX(1)}45%{transform:translateX(14px) scaleX(1)}50%{transform:translateX(14px) scaleX(-1)}95%{transform:translateX(-14px) scaleX(-1)}}
@keyframes bubble{from{transform:translateY(0);opacity:.9}to{transform:translateY(-78px);opacity:0}}
@keyframes chime{0%,100%{transform:rotate(5deg)}50%{transform:rotate(-5deg)}}
</style>
