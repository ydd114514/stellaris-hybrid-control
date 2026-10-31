// Public, factual game memories. No model prose, private reasoning or API calls.
const levels=[1000,5000,10000,20000,50000,100000];
const colonies=s=>(s.colonies||[]).flatMap(x=>x.colonies_summary||[]).filter(x=>!x.is_colonizing);
const clean=x=>typeof x==='string'?x.replace(/\$[^$]*\$|§./g,'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,90):'';
const safe=x=>{const s=clean(x);return /sk-[a-z0-9]{8,}|[A-Z]:[\\/]|[{}]/i.test(s)?'':s;};
const warId=w=>String(w.war_id??w.id??'');
const power=s=>(s.military?.fleets||[]).reduce((n,f)=>n+(Number(f.military_power)||0),0);
const eventTitles=s=>(s.pendingEvents||[]).map(x=>safe(x.title)).filter(x=>x&&!/^(事件|通知|战争目标|First contact view closed)$/.test(x));

export class GameNotebook {
  constructor(saved={}) {
    this.entries=saved.entries||[];this.previous=saved.previous||null;
    this.lastAt=saved.lastAt||'';this.keys=new Set(saved.keys||[]);
    this.deficit=!!saved.deficit;this.positive=saved.positive||0;this.era=saved.era||0;
    this.dirty=false;
  }
  add(key,category,text,date,at) {
    key=`${this.era}:${key}`;text=safe(text);
    if(this.keys.has(key)||!text||!date)return;
    this.keys.add(key);this.entries.push({date,category,text,at});
    this.entries=this.entries.slice(-80);this.dirty=true;
  }
  consume(row) {
    if(typeof row.at!=='string'||!Number.isFinite(Date.parse(row.at))||row.at<=this.lastAt)return;
    const at=row.at;
    if(row.type==='state'&&row.state?.date) {
      const s=row.state,p=this.previous;
      // A restored save is a new timeline: never compare it with future facts.
      if(p&&s.date<p.date){this.era++;this.deficit=false;this.positive=0;this.add(`reload:${at}`,'航程',`回到 ${s.date}，继续这段星海旅程。`,s.date,at);}
      else if(p) {
        const oldWars=new Set((p.wars||[]).map(warId)),newWars=new Set((s.wars||[]).map(warId));
        for(const w of newWars)if(w&&!oldWars.has(w))this.add(`war:start:${w}`,'战事','新的战争爆发，星海又起波澜。',s.date,at);
        for(const w of oldWars)if(w&&!newWars.has(w))this.add(`war:end:${w}`,'战事','一场战争落下帷幕。',s.date,at);
        const oldColonies=new Set(colonies(p).map(x=>x.planet_id));
        for(const c of colonies(s))if(!oldColonies.has(c.planet_id))this.add(`colony:${c.planet_id}`,'家园',`新增殖民地：${safe(c.name)||'新的家园'}。`,s.date,at);
        const crossed=levels.filter(n=>power(p)<n&&power(s)>=n).at(-1);
        if(crossed)this.add(`power:${crossed}`,'舰队',`舰队总战力突破${crossed>=10000?crossed/10000+'万':crossed}。`,s.date,at);
        const oldEvents=new Set(eventTitles(p));
        for(const title of eventTitles(s))if(!oldEvents.has(title))this.add(`event:${title}`,'见闻',`遇到事件：${title}`,s.date,at);
        if(s.terminal&&!p.terminal)this.add('terminal','航程','这一段帝国旅程结束了。',s.date,at);
      }
      const net=s.resources?.alloys?.net;
      if(typeof net==='number') {
        if(net< -5){this.deficit=true;this.positive=0;}
        else if(this.deficit&&net>5){if(++this.positive>=2){this.add(`alloys:recovery:${at.slice(0,10)}`,'建设','合金收支重回盈余，后勤缓过来了。',s.date,at);this.deficit=false;this.positive=0;}}
        else this.positive=0;
      }
      this.previous={date:s.date,wars:s.wars||[],colonies:s.colonies||[],military:s.military,pendingEvents:s.pendingEvents||[],terminal:s.terminal};
      this.lastAt=at;this.dirty=true;
    } else if(row.type==='receipt'&&row.response?.success===true&&row.verification?.verified===true&&this.previous) {
      const date=this.previous.date,r=row.response;
      if(row.command==='adopt_ascension_perk') {
        const name=safe(r.perk_name||r.name);
        this.add(`ascension:${r.perk_key||r.key||row.requestId||at}`,'飞升',name?`获得飞升天赋「${name}」。`:'新的飞升天赋生效了。',date,at);
      }
      if(row.command==='set_district_zone'&&row.verification.phase==='construction_queue') {
        const c=colonies(this.previous).find(x=>x.planet_id===r.planet_id),name=safe(r.zone_name);
        if(c&&name)this.add(`zone:${r.planet_id}:${r.district_id}:${r.slot}:${r.zone}`,'建设',`${safe(c.name)}开始建设「${name}」。`,date,at);
      }
      this.lastAt=at;this.dirty=true;
    }
  }
  publicEntries(){return this.entries.map(({date,category,text,at})=>({date,category,text,at}));}
  serialize(){return {version:1,entries:this.entries,previous:this.previous,lastAt:this.lastAt,keys:[...this.keys].slice(-1000),deficit:this.deficit,positive:this.positive,era:this.era};}
}
