<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,useId} from 'vue'
import type {AiModelInfo} from '../../../packages/shared/src/ai'
import {modelBrand,MODEL_BRANDS} from './model-brands'
const props=defineProps<{modelValue:string;models:AiModelInfo[];disabled?:boolean;providerName?:string}>()
const emit=defineEmits<{ 'update:modelValue':[value:string] }>()
const root=ref<HTMLElement>(),search=ref<HTMLInputElement>(),trigger=ref<HTMLButtonElement>(),open=ref(false),query=ref(''),active=ref(-1)
const listId=useId(),selected=computed(()=>MODEL_BRANDS[modelBrand(props.modelValue)])
const groups=computed(()=>{
  const q=query.value.trim().toLowerCase(),map=new Map<string,{brand:typeof MODEL_BRANDS[keyof typeof MODEL_BRANDS];items:AiModelInfo[]}>()
  for(const model of props.models){const key=modelBrand(model.id,model.ownedBy),brand=MODEL_BRANDS[key];if(q&&!`${model.id} ${model.name||''} ${brand.name}`.toLowerCase().includes(q))continue;if(!map.has(key))map.set(key,{brand,items:[]});map.get(key)!.items.push(model)}
  return [...map.values()].sort((a,b)=>a.brand.name.localeCompare(b.brand.name))
})
const filtered=computed(()=>groups.value.flatMap(g=>g.items))
const custom=computed(()=>query.value.trim()&&!props.models.some(m=>m.id===query.value.trim()))
async function show(){if(props.disabled)return;open.value=true;query.value='';active.value=-1;await nextTick();search.value?.focus()}
function close(focus=false){open.value=false;if(focus)void nextTick(()=>trigger.value?.focus())}
function choose(id:string){emit('update:modelValue',id);close(true)}
function move(delta:number){const count=filtered.value.length;if(!count)return;active.value=active.value<0?(delta<0?count-1:0):(active.value+delta+count)%count;void nextTick(()=>root.value?.querySelectorAll<HTMLElement>('[role="option"]')[active.value]?.scrollIntoView({block:'nearest'}))}
function keys(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();close(true);return}if(event.target!==search.value&&event.target!==trigger.value)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(!open.value)void show();else move(event.key==='ArrowDown'?1:-1)}else if(event.key==='Enter'&&open.value){event.preventDefault();const item=filtered.value[active.value]||(query.value.trim()?filtered.value.find(m=>m.id===query.value.trim())||filtered.value[0]:undefined);if(item)choose(item.id);else if(custom.value)choose(query.value.trim())}}
function outside(event:PointerEvent){if(event.target instanceof Node&&!root.value?.contains(event.target))close()}
onMounted(()=>document.addEventListener('pointerdown',outside));onUnmounted(()=>document.removeEventListener('pointerdown',outside))
</script>
<template>
  <div ref="root" class="model-picker" @keydown="keys">
    <button ref="trigger" class="model-trigger" type="button" role="combobox" aria-label="模型" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="listId" :disabled="disabled" :title="modelValue" @click="open?close():show()">
      <span class="brand-mark" aria-hidden="true"><img v-if="selected.icon" :src="selected.icon" alt=""><span v-else>AI</span></span>
      <span class="selected-copy"><strong>{{modelValue||'选择模型'}}</strong><small>{{providerName||'请先选择服务商'}} · {{models.length}} 个模型</small></span><span class="chevron" aria-hidden="true">⌄</span>
    </button>
    <div v-if="open" class="model-popover">
      <div class="search-head"><input ref="search" v-model="query" type="search" aria-label="模型搜索" placeholder="搜索名称，或手填模型 ID" maxlength="120" :aria-controls="listId" :aria-activedescendant="active>=0?`${listId}-${active}`:undefined" @input="active=-1"><span>{{filtered.length}} / {{models.length}}</span></div>
      <div :id="listId" role="listbox" aria-label="可用模型" class="model-list">
        <div v-for="group in groups" :key="group.brand.name" role="group" :aria-label="group.brand.name">
          <div class="group-title"><span>{{group.brand.name}}</span><span>{{group.items.length}}</span></div>
          <button v-for="model in group.items" :id="`${listId}-${filtered.indexOf(model)}`" :key="model.id" class="model-option" :class="{active:active===filtered.indexOf(model)}" type="button" role="option" :aria-selected="model.id===modelValue" @click="choose(model.id)">
            <span class="brand-mark" aria-hidden="true"><img v-if="group.brand.icon" :src="group.brand.icon" alt=""><span v-else>AI</span></span>
            <span class="option-copy"><strong>{{model.id}}</strong><small v-if="model.name&&model.name!==model.id">{{model.name}}</small></span><span v-if="model.id===modelValue" class="checkmark" aria-hidden="true">✓</span>
          </button>
        </div>
        <p v-if="!filtered.length" class="empty">{{models.length?'没有匹配的模型':'此服务商尚无模型列表，可手填模型 ID'}}</p>
      </div>
      <button v-if="custom" class="custom-model" type="button" @click="choose(query.trim())">使用手填模型：{{query.trim()}}</button>
    </div>
  </div>
</template>
<style scoped>
.model-picker{position:relative;min-width:0;color:#345b7c}.model-trigger{width:100%;display:flex;align-items:center;gap:10px;text-align:left;min-height:54px;background:#fff;border:1px solid #bfd7eb;border-radius:8px;padding:9px 11px;color:inherit;cursor:pointer;font:inherit}.model-trigger:hover:not(:disabled){border-color:#79b4df;background:#fafdff}.model-trigger:disabled{opacity:.5;cursor:default}.brand-mark{display:grid;place-items:center;flex:none;width:29px;height:29px;border-radius:7px;background:#f2f6fb;color:#7c93ae;font-size:11px;font-weight:600}.brand-mark img{display:block;width:24px;height:24px;object-fit:contain}.selected-copy,.option-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}.selected-copy strong{font:500 12px Consolas,"Microsoft YaHei",sans-serif;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.selected-copy small{font-size:10px;color:#91a7bc}.chevron{font-size:18px;color:#7194b6}.model-popover{position:absolute;left:0;right:0;top:calc(100% + 7px);z-index:40;background:#fff;border:1px solid #bfd6e9;border-radius:10px;box-shadow:0 12px 35px #264c7926;overflow:hidden}.search-head{padding:10px;border-bottom:1px solid #e4edf6;position:relative}.search-head input{box-sizing:border-box;width:100%;font:12px "Microsoft YaHei",sans-serif;border:1px solid #cbddec;border-radius:6px;padding:9px 48px 9px 10px;color:#355b7c;background:#f9fcff}.search-head>span{position:absolute;right:19px;top:22px;font:10px Consolas,monospace;color:#91a6bb;pointer-events:none}.model-list{max-height:300px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.group-title{position:sticky;top:0;display:flex;justify-content:space-between;padding:9px 12px;background:#f1f7fc;color:#7c98b2;font-size:10px;letter-spacing:.4px;z-index:1}.model-option{width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border:0;border-bottom:1px solid #f0f4f9;background:#fff;color:#365a7b;text-align:left;cursor:pointer}.model-option:hover,.model-option.active{background:#eaf5ff}.model-option[aria-selected="true"]{background:#f0f7fe;color:#2476b9}.option-copy strong{font:500 12px/1.5 Consolas,"Microsoft YaHei",sans-serif;overflow-wrap:anywhere}.option-copy small{font-size:10px;color:#8ba2ba}.checkmark{color:#3a8bc9}.custom-model{box-sizing:border-box;width:100%;padding:11px 12px;border:0;border-top:1px solid #dbe8f3;background:#f3f9ff;color:#357db2;text-align:left;cursor:pointer;font-size:11px;overflow-wrap:anywhere}.empty{padding:18px 12px;color:#8ca3b8;font-size:11px;line-height:1.7;margin:0}button:focus-visible,input:focus-visible{outline:2px solid #78b6e4;outline-offset:-2px}
</style>
