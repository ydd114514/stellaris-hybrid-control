<script setup lang="ts">
import { computed } from 'vue'

// Hand-drawn props and effects for the shop owner's actions. `hand` is in front of her chest, `head` her face, both in
// stage pixels; `k` runs 0..1 over the action; `facing` mirrors what she holds (never the writing).
// She always stands behind the counter, so nothing may poke into it: things that belong on the counter (a pot, a
// teacup, a notepad) are drawn by the `counter` layer standing on its top, in front of the counter; whatever she
// holds is lifted so its lowest point stays above the counter top. `surface` is that top in stage pixels.
const props = defineProps<{ action: string; k: number; hand: { x: number; y: number }; head: { x: number; y: number }; facing: number; layer: 'body' | 'counter'; surface: number }>()
const SCALE = 1.2
// How far each prop reaches below its own origin, in prop units.
const reach: Record<string, number> = { wipe_cup: 30, brew_coffee: 30, serve: 30, toast: 0, cocoa: 30, noodles: 46, tea: 46, read_chat: 54, fortune: 50, photo: 38, cheer: 0, vote_call: 0, gift_open: 40, lantern: 0, goodnight: 34, fan: 80, write_note: 44, count: 34, water_plant: 30, sweep: 139, heart: 18 }
const resting = new Set(['noodles', 'tea', 'fortune', 'write_note', 'count', 'serve', 'brew_coffee'])
const shown = computed(() => props.action in reach && resting.has(props.action) === (props.layer === 'counter'))
const origin = computed(() => {
  const bottom = (reach[props.action] ?? 0) * SCALE
  if (resting.has(props.action)) return { x: Math.max(270, Math.min(950, props.hand.x + props.facing * 24)), y: props.surface - bottom }
  // A broom sweeps the floor behind the counter, so the counter rightly hides its lower end.
  if (props.action === 'sweep') return props.hand
  return { x: props.hand.x, y: Math.min(props.hand.y, props.surface - bottom - 6) }
})
const wave = (speed: number, amount: number) => Math.sin(props.k * Math.PI * speed) * amount
const sparkle = 'M0-14l4 10l10 4l-10 4l-4 10l-4-10l-10-4l10-4Z'
</script>

<template>
  <g class="action-props" :data-prop="action">
    <!-- held in front of her chest -->
    <g v-if="shown" :transform="`translate(${origin.x} ${origin.y})`">
      <g :key="action" class="pop">
        <g :transform="`scale(${facing * SCALE} ${SCALE})`">
          <g v-if="['wipe_cup', 'brew_coffee', 'serve', 'toast', 'cocoa'].includes(action)" :transform="`translate(${action === 'serve' ? 30 * k : 0} ${action === 'toast' ? -60 - wave(4, 6) : 0}) rotate(${action === 'brew_coffee' ? -18 * Math.sin(k * Math.PI) : action === 'toast' ? -12 : 0})`">
            <template v-if="action === 'toast'"><path d="M-22-40h44l-8 46h-28Z" fill="#f3e3b5" fill-opacity=".85" stroke="#fff3d0" stroke-width="3"/><path d="M-17-18h34l-4 22h-26Z" fill="#e7a94e"/><path d="M0 6v30M-16 38h32" stroke="#fff3d0" stroke-width="4"/><circle v-for="n in 4" :key="n" :cx="-8 + n * 4" :cy="-22 - n * 5" r="2.5" fill="#fff7dc" class="fizz" :style="{ animationDelay: n * .2 + 's' }"/><path class="clink" transform="translate(32 -52)" :d="sparkle" fill="#fff1c4"/></template>
            <template v-else><path d="M-26-26h52l-6 56h-40Z" fill="#e9eee8" stroke="#c4d6cf" stroke-width="4"/><path d="M26-16q28-1 24 19t-26 13" fill="none" stroke="#c4d6cf" stroke-width="6"/><path d="M-20-10h40l-3 32h-34Z" :fill="action === 'cocoa' ? '#7a4a33' : '#846148'"/><path d="M-20 4h40" stroke="#efe4cf" stroke-width="5" v-if="action === 'cocoa'"/>
              <path class="steam" d="M-10-38q-15-22 2-40M10-38q15-19 0-35" fill="none" stroke="#efe6c8" stroke-width="4" opacity=".6"/>
              <path v-if="action === 'wipe_cup'" :transform="`translate(${wave(8, 14)} 0)`" d="M-36-10q-12 29 4 41l22-7-8-34Z" fill="#a9c2b8"/>
              <g v-if="action === 'cocoa'" class="blow"><path d="M-46-58q10-4 18 2M-50-44q12-2 18 4" stroke="#dff0f2" stroke-width="3" fill="none" stroke-linecap="round"/></g></template>
          </g>
          <g v-else-if="action === 'noodles'"><path d="M-60-6h120q-6 52-60 52t-60-52Z" fill="#c55a3c"/><path d="M-66-10h132v10h-132Z" fill="#9c432c" rx="4"/><path d="M-50-8q20-16 40 0t40 0" stroke="#f2d38a" stroke-width="7" fill="none"/><g :transform="`translate(0 ${-26 - Math.abs(wave(10, 8))}) rotate(${wave(10, 4)})`"><path d="M-56 0h112v-8q-56-22-112 0Z" fill="#d6c29a"/><circle cy="-18" r="7" fill="#8b6b45"/></g><path d="M40-80l30 60M52-84l26 62" stroke="#c9a46a" stroke-width="5" stroke-linecap="round"/><path class="steam" d="M-30-46q-18-26 2-50M0-50q16-24 0-46M30-46q-16-24 2-44" fill="none" stroke="#f5eedb" stroke-width="5" opacity=".55"/></g>
          <g v-else-if="action === 'tea'"><g :transform="`rotate(${-40 * Math.sin(Math.min(1, k * 1.6) * Math.PI)} -10 -20)`"><ellipse cx="-10" cy="-20" rx="38" ry="30" fill="#7da59b"/><path d="M28-28q26-10 34-30" stroke="#7da59b" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M-48-28q-22 2-18 22t20 12" stroke="#5b8178" stroke-width="7" fill="none"/><rect x="-24" y="-56" width="28" height="10" rx="5" fill="#5b8178"/></g><path v-if="k > .2 && k < .75" d="M62-56q8 30 4 74" stroke="#d9b56a" stroke-width="4" fill="none" stroke-dasharray="6 4" class="pour"/><g transform="translate(66 34)"><path d="M-18-12h36l-4 24h-28Z" fill="#f2efe4"/><path d="M-15-6h30l-3 15h-24Z" fill="#c99a4d" :opacity="Math.min(1, k * 1.8)"/></g></g>
          <g v-else-if="action === 'read_chat'"><rect x="-44" y="-74" width="88" height="128" rx="14" fill="#1b2a2e" stroke="#9fb7b2" stroke-width="4"/><rect x="-36" y="-64" width="72" height="104" rx="8" fill="#29424a"/><g class="scroll" :transform="`translate(0 ${-((k * 60) % 30)})`"><rect x="-30" y="-56" width="46" height="12" rx="6" fill="#b4dbbb"/><rect x="-14" y="-36" width="44" height="12" rx="6" fill="#f2d6a2"/><rect x="-30" y="-16" width="52" height="12" rx="6" fill="#b4dbbb"/><rect x="-10" y="4" width="40" height="12" rx="6" fill="#f2d6a2"/><rect x="-30" y="24" width="36" height="12" rx="6" fill="#b4dbbb"/></g><ellipse cx="0" cy="-10" rx="80" ry="90" fill="#b4e3ff" opacity=".07"/></g>
          <g v-else-if="action === 'fortune'"><g :transform="`rotate(${wave(14, 10) * (k < .6 ? 1 : 0)})`"><path d="M-30-40h60l-6 90h-48Z" fill="#a8503c"/><path d="M-30-40h60" stroke="#e6c27a" stroke-width="6"/><path d="M-30 30h56" stroke="#e6c27a" stroke-width="4"/><path d="M-14-40v-30M-4-40v-36M8-40v-28M18-40v-32" stroke="#e8d4a6" stroke-width="6" stroke-linecap="round"/></g><g v-if="k > .55" class="slip" transform="translate(0 -96)"><rect x="-16" y="-50" width="32" height="96" rx="4" fill="#f6ead0" stroke="#c9512f" stroke-width="3"/><text :transform="`scale(${facing} 1)`" x="0" y="-12" text-anchor="middle" font-size="28" fill="#c9512f" font-weight="700">吉</text><text :transform="`scale(${facing} 1)`" x="0" y="22" text-anchor="middle" font-size="16" fill="#8b6b45">好梦</text></g></g>
          <g v-else-if="action === 'photo'"><rect x="-56" y="-40" width="112" height="78" rx="14" fill="#efe6d6" stroke="#b7aa94" stroke-width="3"/><circle cx="6" cy="0" r="24" fill="#2b3638" stroke="#9db0b3" stroke-width="5"/><circle cx="12" cy="-6" r="7" fill="#7d9aa0"/><rect x="-46" y="-32" width="18" height="12" rx="3" fill="#f5c26b"/><g v-if="k > .35" :transform="`translate(0 ${-40 - Math.min(1, (k - .35) * 3) * 66})`"><rect x="-30" y="-70" width="60" height="70" rx="3" fill="#fbf7ee"/><rect x="-24" y="-64" width="48" height="44" :fill="k > .7 ? '#3d5560' : '#d9d4c7'"/></g></g>
          <g v-else-if="action === 'cheer' || action === 'vote_call'" :transform="`translate(40 -290) rotate(${wave(6, 6)})`"><path d="M0 70v130" stroke="#8f7553" stroke-width="9" stroke-linecap="round"/><rect x="-96" y="-56" width="192" height="126" rx="20" :fill="action === 'cheer' ? '#f1d9a0' : '#cfe6d2'" stroke="#fff6dc" stroke-width="5"/><g :transform="`scale(${facing} 1)`"><text x="0" :y="action === 'cheer' ? 6 : 0" text-anchor="middle" font-size="40" font-weight="700" fill="#5a3d2a">{{ action === 'cheer' ? '谢谢你' : '投1·投2' }}</text><text x="0" y="46" text-anchor="middle" font-size="22" fill="#7a5a40">{{ action === 'cheer' ? '♡ 今晚也在' : '每人一票哦' }}</text></g></g>
          <g v-else-if="action === 'gift_open'"><rect x="-44" y="-30" width="88" height="70" rx="8" fill="#e98b8b"/><path d="M-6-30v70M6-30v70" stroke="#ffe0a6" stroke-width="7"/><g :transform="`translate(0 ${-34 - Math.min(1, Math.max(0, k - .3) * 4) * 46}) rotate(${-Math.min(1, Math.max(0, k - .3) * 4) * 24})`"><rect x="-50" y="-14" width="100" height="22" rx="6" fill="#f2a1a1"/><path d="M0-14q-30-30-24 2M0-14q30-30 24 2" fill="none" stroke="#ffe0a6" stroke-width="7"/></g><g v-if="k > .35" class="burst"><path v-for="n in 6" :key="n" :transform="`rotate(${n * 60}) translate(0 -${70 + (k - .35) * 90}) scale(${1.4 - k * .6})`" :d="sparkle" :fill="n % 2 ? '#fff1c4' : '#f6b7c6'"/></g></g>
          <g v-else-if="action === 'lantern'" :transform="`translate(40 ${-70 + wave(4, 4)})`"><path d="M0-80v30" stroke="#5a4433" stroke-width="5"/><circle r="120" fill="#ffb86b" opacity=".12" class="lantern-glow"/><ellipse cx="0" cy="-10" rx="44" ry="50" fill="#e8743f"/><path d="M-44-10h88M-38-36h76M-38 16h76" stroke="#f5b26b" stroke-width="3" opacity=".7"/><rect x="-22" y="-62" width="44" height="12" rx="4" fill="#3d2f25"/><rect x="-22" y="34" width="44" height="10" rx="4" fill="#3d2f25"/><path d="M-4 44v24M4 44v18" stroke="#e8c65a" stroke-width="3"/></g>
          <g v-else-if="action === 'goodnight'" transform="translate(0 -20)"><path d="M14-48a46 46 0 1 0 22 80a38 38 0 1 1-22-80Z" fill="#f3e3a6"/><circle cx="-6" cy="-6" r="4" fill="#c7b06d"/><circle cx="6" cy="14" r="3" fill="#c7b06d"/></g>
          <g v-else-if="action === 'fan'" :transform="`translate(30 -30) rotate(${wave(10, 18)})`"><path d="M0 40v70" stroke="#8f7553" stroke-width="6"/><circle r="52" fill="#f4e6c8" stroke="#c8a873" stroke-width="4"/><path d="M-30 10q10-34 30-30q20 4 22 34" fill="none" stroke="#e9a2a2" stroke-width="5"/><circle cx="-16" cy="-18" r="7" fill="#e9a2a2"/></g>
          <g v-else-if="action === 'write_note' || action === 'count'"><template v-if="action === 'write_note'"><path d="M-40-30h86l-6 74h-86Z" fill="#efdcac"/><path d="M-26-10h50M-28 6h38M-30 22h46" stroke="#8e8866" stroke-width="3" :stroke-dasharray="`${k * 60} 80`"/><path :transform="`translate(${wave(10, 10)} 0)`" d="M24-36l36-32" stroke="#e7b96e" stroke-width="7" stroke-linecap="round"/></template><template v-else><rect x="-60" y="-32" width="120" height="66" rx="8" fill="#7b4b2f"/><path d="M-50-16h100M-50 0h100M-50 16h100" stroke="#3c2a1d" stroke-width="2"/><circle v-for="n in 8" :key="n" :cx="-50 + n * 12" :cy="-16 + (n % 3) * 16" r="6" :transform="`translate(${n % 2 ? wave(8, 5) : 0} 0)`" fill="#e1c48e"/></template></g>
          <g v-else-if="action === 'water_plant'" transform="rotate(-20)"><path d="M-26-21h58v48h-58Z" fill="#83a995"/><path d="M-26-10l-37-14v9l37 30M32-13q27-6 25 20t-25 9" fill="none" stroke="#83a995" stroke-width="10"/><path class="drops" d="M-70-9l-15 25M-62-5l-12 29M-53-1l-10 27" stroke="#a1d5df" stroke-width="3"/></g>
          <g v-else-if="action === 'sweep'" :transform="`rotate(${wave(25, 12)})`"><path d="M20-100L-25 115" stroke="#a89063" stroke-width="8"/><path d="M-34 88l-30 51h76L-8 93Z" fill="#b19a69"/><path d="M-29 102l-16 30M-18 103l-8 30M-8 105l2 25" stroke="#7c6b4b" stroke-width="3"/></g>
          <g v-else-if="action === 'heart'" :transform="`translate(0 -40) scale(${1 + Math.abs(wave(6, .12))})`"><path d="M0 18C-50-20-30-62 0-34C30-62 50-20 0 18Z" fill="#f28b9c" stroke="#ffd2d9" stroke-width="4"/></g>
        </g>
      </g>
    </g>

    <!-- around her head -->
    <g v-if="layer === 'body'" :transform="`translate(${head.x} ${head.y})`">
      <g v-if="action === 'umbrella'" class="pop" :transform="`translate(${facing * 20} -150) scale(${facing * 1.35} 1.35) rotate(${wave(3, 4) - 6})`"><path d="M-140 0q140-130 280 0q-23-16-46 0q-23-16-47 0q-23-16-47 0q-23-16-47 0q-23-16-46 0q-24-16-47 0Z" fill="#6f8fb5" stroke="#9fbbdc" stroke-width="3"/><path d="M0-78V200q0 22 20 22" stroke="#4f4338" stroke-width="7" fill="none" stroke-linecap="round"/><g opacity=".6" class="drip"><path d="M-130 14v12M130 14v12M-40 20v10" stroke="#b8e0df" stroke-width="3" stroke-linecap="round"/></g></g>
      <g v-if="action === 'music'" class="pop" transform="translate(0 60) scale(1.35)"><path d="M-74 60q0-92 74-92t74 92" fill="none" stroke="#3a4a52" stroke-width="10"/><rect x="-92" y="44" width="30" height="50" rx="12" fill="#e98b8b"/><rect x="62" y="44" width="30" height="50" rx="12" fill="#e98b8b"/><g class="notes"><text v-for="n in 3" :key="n" :x="70 + n * 22" :y="-10 - n * 26" font-size="40" fill="#f3d9a6" :style="{ animationDelay: n * .4 + 's' }">♪</text></g></g>
      <g v-if="action === 'goodnight' || action === 'yawn' || action === 'sleep'" class="zzz"><text v-for="n in 3" :key="n" :x="60 + n * 20" :y="10 - n * 30" :font-size="22 + n * 8" fill="#c9d8f0" :style="{ animationDelay: n * .5 + 's' }">z</text></g>
      <g v-if="action === 'sneeze' && k > .45" class="sneeze"><circle v-for="n in 6" :key="n" :cx="facing * (60 + n * 22)" :cy="120 + (n % 3) * 18 - n * 4" :r="6 + n % 3 * 4" fill="none" stroke="#dff3f6" stroke-width="3"/><text :x="facing * 90" y="60" text-anchor="middle" font-size="34" fill="#f3e3c0" font-weight="700">阿嚏!</text></g>
      <g v-if="action === 'stargaze'" class="star-count"><path v-for="n in 5" :key="n" :transform="`translate(${-120 + n * 50} ${-30 - (n % 2) * 40}) scale(${.8 + (n % 3) * .3})`" :d="sparkle" fill="#fff1c4" :style="{ animationDelay: n * .35 + 's' }"/></g>
      <g v-if="action === 'giggle'" class="pop"><text :x="facing * 100" y="40" text-anchor="middle" font-size="34" fill="#f3d9a6">嘻嘻</text></g>
      <g v-if="action === 'akimbo'" class="pop"><text :x="facing * 110" y="30" text-anchor="middle" font-size="34" fill="#f3d9a6">哼哼~</text></g>
      <g v-if="action === 'blanket'" class="pop" transform="translate(0 205)"><path d="M-120 20q120-60 240 0l30 190q-150 40-300 0Z" fill="#c9b7e0" opacity=".95"/><path d="M-120 20q120-60 240 0" fill="none" stroke="#eadff5" stroke-width="8"/><g stroke="#a996c6" stroke-width="5" opacity=".7"><path d="M-80 60l-10 150M0 40v176M80 60l10 150"/></g></g>
    </g>
    <rect v-if="layer === 'body' && action === 'photo' && k > .3 && k < .42" class="flash" x="-200" y="-200" width="1480" height="2320" fill="#fffef4"/>
  </g>
</template>

<style scoped>
.pop{transform-box:fill-box;transform-origin:center bottom;animation:pop .45s cubic-bezier(.3,1.6,.5,1) both}
.steam{animation:steam 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center bottom}
.fizz{animation:fizz 1.2s ease-in infinite}
.clink{animation:twinkle .8s ease-in-out infinite}
.blow{animation:blow .9s ease-out infinite}
.lantern-glow{animation:glow 1.8s ease-in-out infinite}
.burst path,.star-count path{animation:twinkle .9s ease-in-out infinite}
.notes text{animation:note 1.6s ease-out infinite}
.zzz text{animation:zzz 2.2s ease-out infinite}
.sneeze{animation:pop .3s ease-out both}
.drops,.drip{animation:drip .8s linear infinite}
.slip{animation:slip .5s cubic-bezier(.3,1.6,.5,1) both}
.flash{animation:flash .4s ease-out both}
@keyframes pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}
@keyframes steam{0%,100%{opacity:.25;transform:translateY(0) scaleY(1)}50%{opacity:.7;transform:translateY(-10px) scaleY(1.1)}}
@keyframes fizz{from{transform:translateY(0);opacity:1}to{transform:translateY(-26px);opacity:0}}
@keyframes twinkle{0%,100%{opacity:.4}50%{opacity:1}}
@keyframes blow{from{opacity:.9;transform:translateX(0)}to{opacity:0;transform:translateX(26px)}}
@keyframes glow{0%,100%{opacity:.1}50%{opacity:.22}}
@keyframes note{from{opacity:0;transform:translate(0,10px)}30%{opacity:1}to{opacity:0;transform:translate(16px,-40px)}}
@keyframes zzz{from{opacity:0;transform:translate(0,0)}30%{opacity:.9}to{opacity:0;transform:translate(18px,-36px)}}
@keyframes drip{from{transform:translateY(0);opacity:1}to{transform:translateY(22px);opacity:0}}
@keyframes slip{from{transform:translateY(60px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes flash{from{opacity:.85}to{opacity:0}}
</style>
