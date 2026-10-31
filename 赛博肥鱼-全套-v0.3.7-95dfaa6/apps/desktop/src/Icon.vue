<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string,string> = {
 music:'M9 18V5l12-2v13 M9 8l12-2 M6 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M18 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
 link:'m10 13 4-4 M7 15l-2 2a4 4 0 0 0 6 6l4-4a4 4 0 0 0 0-6 M17 9l2-2a4 4 0 0 0-6-6L9 5a4 4 0 0 0 0 6',
 dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 mic:'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8',
 fish:'M20 12c-1-5-6-8-11-6L3 3v6c-2 2-2 4 0 6v6l6-3c5 2 10-1 11-6Z M14 10h.01 M20 12h2',
 motion:'m13 2-3 8h7L8 22l3-9H4z', gift:'M3 8h18v4H3z M5 12v9h14v-9 M12 8v13 M12 8H8a3 3 0 1 1 3-4l1 4Z M12 8h4a3 3 0 1 0-3-4l-1 4Z',
 shop:'M3 10h18l-2-7H5z M5 10v11h14V10 M9 21v-7h6v7 M3 10c0 4 5 4 6 0 0 4 6 4 6 0 1 4 6 4 6 0',
 users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
 shield:'M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6z m-5 10 3 3 7-7',
 cost:'M3 3v18h18 M7 14l4-4 4 3 6-8', log:'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M10 2h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1z',
 flask:'M9 3h6 M10 3v6l-6 10a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L14 9V3 M7 15h10',
 play:'m8 4 13 8-13 8z', pause:'M7 4h3v16H7z M15 4h3v16h-3z', stop:'M6 6h12v12H6z',
 speaker:'m11 4-6 5H2v6h3l6 5z M15 8a6 6 0 0 1 0 8 M18 4a11 11 0 0 1 0 16', mute:'m11 4-6 5H2v6h3l6 5z m6 5 6 6 m0-6-6 6',
 arrow:'M5 12h14 m-6-6 6 6-6 6', check:'m5 12 4 4L19 6', close:'m6 6 12 12 M6 18 18 6',
 plus:'M12 5v14 M5 12h14', external:'M14 3h7v7 M21 3l-10 10 M10 3H3v18h18v-7',
 moon:'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z', coffee:'M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z M17 9h2a3 3 0 1 1 0 6h-2 M6 2v3 M10 2v3 M14 2v3',
 key:'M8 15a6 6 0 1 1 5-9l9 0v4h-3v3h-4l-2-2 M6 8h.01', clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 6v6l4 2',
 chat:'M21 15a4 4 0 0 1-4 4H8l-6 3V6a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4z M6 7h11 M6 12h7',
 download:'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5', help:'M9 9a3 3 0 1 1 6 0c0 2-3 2-3 4 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 vote:'M9 11l3 3 8-8 M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
 palette:'M12 22a10 10 0 1 1 10-10c0 3-3 3-5 3h-2a2 2 0 0 0-1 4c1 1 0 3-2 3Z M7.5 10.5h.01 M12 7h.01 M16.5 10.5h.01',
 live:'M2 12a10 10 0 0 1 3-7 M22 12a10 10 0 0 0-3-7 M5.5 12a6.5 6.5 0 0 1 2-4.6 M18.5 12a6.5 6.5 0 0 0-2-4.6 M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M12 14v7',
 spark:'m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z', refresh:'M3 11a9 9 0 0 1 15-6l3 3 M21 3v5h-5 M21 13a9 9 0 0 1-15 6l-3-3 M3 21v-5h5',
}
</script>
<template><svg :width="size || 20" :height="size || 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.spark" /></svg></template>
