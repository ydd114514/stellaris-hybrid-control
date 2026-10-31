<script setup lang="ts">
import type { ShopTimePhase } from '../../packages/shared/src/shop-time'
// The counter in front of the shop owner, with the shop cat who sleeps on it and wakes up to be petted.
withDefaults(defineProps<{ petting: boolean; decorations: string[]; phase: ShopTimePhase; showGuide?: boolean }>(), { showGuide: true })
</script>

<template>
  <svg class="counter-layer" viewBox="0 0 1080 1920" aria-hidden="true">
    <defs>
      <linearGradient id="counterTop" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#b08c5b"/><stop offset="1" stop-color="#826344"/></linearGradient>
      <linearGradient id="counterFront" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#644b39"/><stop offset="1" stop-color="#3e342c"/></linearGradient>
    </defs>
    <g transform="translate(0 -360)" data-testid="raised-tea-counter">
    <!-- The feet meet the room floor at y=1440 after the raised-counter offset. -->
    <g data-testid="counter-supports">
      <ellipse cx="606" cy="1802" rx="395" ry="16" fill="#292c20" opacity=".2"/>
      <path d="M243 1608h36v192h-36ZM928 1608h36v192h-36Z" fill="#49382b"/>
      <path d="M252 1630v158M937 1630v158" stroke="#98744b" stroke-width="5" opacity=".5"/>
      <path d="M239 1786h44v15h-44ZM924 1786h44v15h-44Z" fill="#342c24"/>
    </g>
    <path d="M225 1387h755v240H225Z" fill="url(#counterFront)"/>
    <path d="M245 1406h715v198H245Z" fill="none" stroke="#8c7250" stroke-opacity=".3" stroke-width="5"/>
    <path d="M215 1358h778l30 42H191Z" fill="url(#counterTop)"/>
    <path d="M191 1400h832v19H191Z" fill="#3d3026"/><path d="M205 1397h806" stroke="#c59b65" stroke-width="4"/>
    <g transform="translate(390 1344)" data-testid="tea-service">
      <ellipse cx="12" cy="32" rx="112" ry="14" fill="#3e3023" opacity=".3"/>
      <ellipse cx="12" cy="28" rx="108" ry="12" fill="#886541" stroke="#5b442e" stroke-width="3"/>
      <ellipse cx="12" cy="25" rx="99" ry="8" fill="#b08d5c"/>
      <ellipse cx="-34" cy="24" rx="40" ry="6" fill="#3c422b" opacity=".25"/>
      <g transform="translate(0 30)"><path d="M-66-8q-10-47 28-51q39-2 38 51Z" fill="#697f60" stroke="#384f3a" stroke-width="3"/><path d="M-7-40q36-18 42-42q-9 51-38 63" fill="#697f60" stroke="#384f3a" stroke-width="3"/><path d="M-66-40q-29-8-24 15t26 17" fill="none" stroke="#697f60" stroke-width="9"/><ellipse cx="-34" cy="-59" rx="27" ry="7" fill="#8ca077"/><circle cx="-34" cy="-70" r="7" fill="#435c40"/><path class="steam" d="M-43-91q-13-21 1-37M-23-90q13-20 0-36" fill="none" stroke="#f4e4bf" stroke-width="3" opacity=".6"/></g>
      <g transform="translate(63 2)"><ellipse rx="28" ry="8" cy="14" fill="#ab9160"/><path d="M-19-15h38l-5 27h-28Z" fill="#e8dcc1"/><ellipse cy="-14" rx="18" ry="5" fill="#b18a46"/></g>
    </g>
    <!-- The shop cat: breathing, an ear that twitches, a tail that never quite stops. -->
    <g class="cat" :class="{ petting }" transform="translate(748 1374)" data-testid="shop-cat">
      <ellipse cx="0" cy="-2" rx="78" ry="10" fill="#1d1a16" opacity=".35"/>
      <g class="cat-tail"><path d="M58-14q46 4 40-28q-3-16-16-14" fill="none" stroke="#3b3631" stroke-width="15" stroke-linecap="round"/><path d="M92-46q-2-8-10-10" fill="none" stroke="#e9dcc4" stroke-width="13" stroke-linecap="round"/></g>
      <g class="cat-body"><path d="M-66-2q-6-62 58-64q66-2 70 64Z" fill="#3b3631"/><path d="M-30-6q4-22 30-22q24 0 28 22Z" fill="#e9dcc4" opacity=".9"/></g>
      <g class="cat-head">
        <path d="M-82-40q0-36 36-36q36 0 36 36q0 26-36 26q-36 0-36-26Z" fill="#3b3631"/>
        <path class="ear" d="M-76-58l2-30l22 16Z" fill="#3b3631"/><path d="M-72-62l2-17l12 10Z" fill="#c98c86"/>
        <path class="ear right" d="M-38-72l20-16l4 30Z" fill="#3b3631"/>
        <path d="M-58-30q-22 6-6 18q14 4 22-6q4-14-16-12Z" fill="#e9dcc4"/>
        <g v-if="!petting" stroke="#c9b9a0" stroke-width="3" stroke-linecap="round" fill="none"><path d="M-68-44q6 5 12 0M-44-44q6 5 12 0"/></g>
        <g v-else stroke="#e9dcc4" stroke-width="3.5" stroke-linecap="round" fill="none"><path d="M-68-42q6-7 12 0M-44-42q6-7 12 0"/></g>
        <path d="M-50-30l-4 4h8Z" fill="#d68f8f"/>
        <path d="M-86-26h-16M-86-20l-14 4M-14-26h16M-14-20l14 4" stroke="#8e8574" stroke-width="2"/>
      </g>
      <text v-if="!petting" class="cat-z" x="-20" y="-96" fill="#c9d6c6" font-size="22">z</text>
      <g v-else class="purr"><text x="-40" y="-104" fill="#f3d9a6" font-size="24">呼噜~</text><path d="M-6-104c-10-10-18 2 0 12c18-10 10-22 0-12Z" fill="#f197a1"/></g>
    </g>

    <g v-if="!showGuide" data-testid="counter-slogan"><text x="608" y="1514" text-anchor="middle" fill="#b7a07b" font-size="33" font-family="serif" letter-spacing="14">{{phase==='night'?'让夜晚，慢一点。':'让时光，慢一点。'}}</text>
    <path d="M385 1553H830" stroke="#aa8e62" stroke-opacity=".3" stroke-width="2"/>
    <text x="608" y="1593" text-anchor="middle" fill="#a28f71" font-size="17" letter-spacing="7">{{phase==='night'?'A LITTLE WARMTH AFTER DARK':'A LITTLE WARMTH, ANY TIME'}}</text></g>
    </g>
  </svg>
</template>

<style scoped>
.steam{animation:steam 3s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.cat-body{transform-box:fill-box;transform-origin:center bottom;animation:breathe 3.6s ease-in-out infinite}
.cat-head{transform-box:fill-box;transform-origin:80% 90%;transition:transform .5s cubic-bezier(.3,1.5,.5,1)}
.cat.petting .cat-head{transform:translateY(-10px) rotate(-8deg);animation:nuzzle .6s ease-in-out infinite alternate}
.cat-tail{transform-box:fill-box;transform-origin:0% 80%;animation:tail 4s ease-in-out infinite}.cat.petting .cat-tail{animation-duration:.9s}
.ear{transform-box:fill-box;transform-origin:50% 100%;animation:ear 7s ease-in-out infinite}.ear.right{animation-delay:-3s}
.cat-z{animation:z 3.2s ease-in-out infinite}
.purr{animation:purr 1s ease-in-out infinite alternate}
@keyframes steam{0%,100%{opacity:.2;transform:translateY(0)}50%{opacity:.55;transform:translateY(-12px)}}
@keyframes breathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.035)}}
@keyframes nuzzle{from{transform:translateY(-10px) rotate(-8deg)}to{transform:translateY(-12px) rotate(-2deg)}}
@keyframes tail{0%,100%{transform:rotate(0)}50%{transform:rotate(-12deg)}}
@keyframes ear{0%,92%,100%{transform:rotate(0)}94%{transform:rotate(-16deg)}96%{transform:rotate(4deg)}}
@keyframes z{0%{opacity:0;transform:translate(0,0)}30%{opacity:.8}100%{opacity:0;transform:translate(14px,-30px)}}
@keyframes purr{from{transform:translateY(0)}to{transform:translateY(-6px)}}
</style>
