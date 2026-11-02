import type {SpeechLine} from './captain-speech-queue'
import {spokenText} from './stellaris-captain'

const economyPlans:Record<string,string>={
  balanced:'收支先稳住，缺什么补什么。',
  unity_traditions:'我先顾凝聚力和传统，缺的资源再补。',
  consumer_stability:'民用品和粮食先跟上。',
  alloys_military:'我先把合金和军工提上来。',
  research:'我先顾科研，基础资源也得够用。',
}

const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:undefined
const amount=(v:number)=>Number.isInteger(v)?String(v):v.toFixed(1)
function situationLines(game:any,contract:any):string[]{
  const rows:string[]=[],resources=game.resources??{}
  if(contract.economyFocus==='unity_traditions'){
    const stock=number(resources.unity?.stockpile),cost=number(game.traditions?.next_tradition_cost)
    if(stock!==undefined&&cost!==undefined&&resources.unity?.stockpile_known!==false&&cost>stock)rows.push(`点下一个传统，大概还差${Math.ceil(cost-stock)}凝聚力。`)
    const adopted=game.ascensionPerks?.adopted
    if(Array.isArray(adopted)&&adopted.length<=8&&adopted.every((x:any)=>typeof x?.key==='string'&&x.key.startsWith('ap_')))rows.push(`飞升天赋已经选了${new Set(adopted.map((x:any)=>x.key)).size}项。`)
  }
  const colonies=(Array.isArray(game.colonies)?game.colonies:[]).flatMap((x:any)=>Array.isArray(x?.colonies_summary)?x.colonies_summary:[])
  for(const colony of colonies.slice(0,12)){
    const name=spokenText(colony.name,24);if(!name)continue
    if(colony.is_colonizing===true)rows.push(`《${name}》还在殖民。`)
    else if(colony.has_construction===true)rows.push(`《${name}》还有建设排着。`)
  }
  for(const [area,label] of [['physics','物理'],['society','社会'],['engineering','工程']]){
    const tech=game.research?.[area]?.current,name=spokenText(tech?.name,24)
    if(tech?.is_researching===true&&typeof tech.key==='string'&&tech.key&&name)rows.push(`${label}这边还在研究《${name}》。`)
  }
  for(const [key,label] of [['energy','能源'],['minerals','矿物'],['alloys','合金'],['food','食物']]){
    const r=resources[key],stock=number(r?.stockpile),net=r?.net
    if(stock===undefined||typeof net!=='number'||!Number.isFinite(net)||r.stockpile_known===false||r.net_known===false)continue
    rows.push(net<0?`${label}每个月要亏${amount(-net)}，手上还有${Math.floor(stock)}。`:`${label}大概还有${Math.floor(stock)}，每个月能攒下${amount(net)}。`)
  }
  const systems=number(game.player?.owned_systems),count=number(game.capacities?.colonies)
  if(systems!==undefined&&count!==undefined)rows.push(`咱们现在有${systems}个星系、${count}处殖民据点。`)
  const naval=game.capacities?.naval_capacity,used=number(naval?.used),capacity=number(naval?.capacity)
  if(used!==undefined&&capacity!==undefined)rows.push(`舰容用了${amount(used)}，上限是${amount(capacity)}。`)
  return rows.map(text=>spokenText(text)).filter(Boolean)
}

/** Confirmed direction plus bounded factual commentary, without extra model calls. */
export function createCaptainGameNarration(now=Date.now){
  let session='',lastDirection='',sequence=0,lastAt=0,cursor=0
  const recent=new Map<string,number>()
  return {
    observe(checkpoint:any,observedAt:number,{intervalSeconds=30}:{intervalSeconds?:number}={}):SpeechLine|undefined{
      const at=now(),game=checkpoint?.state,id=checkpoint?.sessionId
      if(typeof id!=='string'||!/^[a-z\d-]{1,100}$/i.test(id)||!game||checkpoint.stopped||checkpoint.ended||
        game.paused===true||checkpoint.runtimeStatus?.paused===true||
        !Number.isFinite(observedAt)||at-observedAt>30000||observedAt-at>5000)return
      const contract=game.strategyContract??checkpoint.strategyContract??game.strategy?.currentContract
      if(contract?.steeringConfirmed!==true||!Object.hasOwn(economyPlans,contract.economyFocus)||
        !['aggressive','consolidate'].includes(contract.expansionStance)||
        !['peaceful','prepare_war'].includes(contract.militaryStance))return
      const control=game.countryAIControl??checkpoint.countryAIControl
      if(control&&(control.enabled===false||control.owner&&control.owner!=='native'))return
      if(session!==id){session=id;lastDirection='';sequence=0;lastAt=0;cursor=0;recent.clear()}
      const direction=[contract.economyFocus,contract.expansionStance,contract.militaryStance].join(':')
      const expansion=contract.expansionStance==='aggressive'?'接着找机会向外扩张。':'先巩固现有领土。'
      const military=contract.militaryStance==='prepare_war'?'舰队和后勤得先备好。':'先和平发展。'
      let text:string|undefined
      if(direction!==lastDirection){lastDirection=direction;text=economyPlans[contract.economyFocus]+expansion+military}
      else{
        const interval=Number.isFinite(intervalSeconds)?Math.max(15,Math.min(180,intervalSeconds)):30
        if(at-lastAt<interval*1000)return
        const rows=situationLines(game,contract)
        for(let i=0;i<rows.length;i++){
          const index=(cursor+i)%rows.length,candidate=rows[index],previous=recent.get(candidate)
          if(previous!==undefined&&at-previous<90000)continue
          text=candidate;cursor=index+1;break
        }
        if(!text)return
      }
      lastAt=at;recent.set(text,at)
      for(const [line,time]of recent)if(at-time>300000)recent.delete(line)
      return {id:`game:${session}:strategy-${++sequence}`,kind:'game',text,at}
    },
  }
}
