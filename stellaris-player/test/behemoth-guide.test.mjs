import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NativeGame} from '../src/native-game.mjs';

test('the guide index is available without a game session or a caller-chosen file path',async()=>{
  const offline={guard:()=>assert.fail('a guide lookup must not access the game')};
  const inspect=args=>NativeGame.prototype.inspect.call(offline,args);
  const index=await inspect({topic:'behemoth'});
  assert.equal(index.version,'4.5.2');
  assert.deepEqual(Object.keys(index.sections),['opening','hatch','finale','recovery','wilderness','sources']);
  assert.deepEqual(index.next,{topic:'behemoth',section:'opening'});
  await assert.rejects(inspect({topic:'behemoth',section:'../config.json'}),/章节或页码无效/);
  await assert.rejects(inspect({topic:'government',section:'opening'}),/仅用于兽灾攻略/);

  const source=await readFile(new URL('../docs/兽灾实战手册-4.5.2.md',import.meta.url),'utf8');
  const chapters=source.replaceAll('\r\n','\n').split(/^## /mu).slice(1);
  for(const [section,title] of Object.entries(index.sections)){
    const chapter=chapters.find(text=>text.startsWith(title+'\n'));
    assert.ok(chapter,title);
    let request={topic:'behemoth',section},text='';
    while(request){
      const response=await inspect(request);
      assert.ok(response.text&&Array.from(response.text).length<=3500);
      text+=response.text;
      request=response.next;
    }
    assert.equal(text,chapter.slice(title.length).trim());
  }
});

test('only an adopted perk triggers the review and only current player facts enter its summary',async()=>{
  const calls=[];
  const log={player_only_filter:true,special_projects:[{key:'BEHEMOTH_TRANSFERENCE_PROJECT'},{key:'UNRELATED_PROJECT'}],situations:[
    {key:'behemoth_finale_situation',is_player:false,owner_country_id:8,progress:900},
    {key:'behemoth_finale_situation',is_player:true,owner_country_id:0,progress:32,monthly_change:5,current_approach:'behemoth_finale_approach_brawn'},
  ]};
  const game={countryAI:{active:false},strategyReview:{},government:{authority:'auth_machine_intelligence'},
    strategyDirectionPlan:()=>({lockedDimensions:{}}),assertNativeWorld:()=>{},rpc:async(method,params)=>{
      calls.push([method,params]);
      if(method==='get_situation_log')return log;
      if(method==='get_contacts')return {empires:[]};
      return {};
    }};
  const state={strategy:{focus:'经营'},player:{country_id:0},resources:{
    food:{stockpile:30,net:-5},influence:{stockpile:0,stockpile_known:false,net:0},sr_living_metal:{stockpile:12,net:0,net_known:false},
  },operatorMessages:['观众说想看兽灾']};
  const review=()=>NativeGame.prototype.readStrategyBrief.call(game,state);
  assert.equal((await review()).behemoth,undefined);
  assert.equal(calls.some(([method])=>method==='get_situation_log'),false);

  state.ascensionPerks={adopted:[{key:'ap_behemoths'}]};
  const brief=await review();
  assert.deepEqual(calls.filter(([method])=>method==='get_situation_log'),[['get_situation_log',{player_only:true}]]);
  assert.deepEqual(brief.behemoth,{resources:{food:{stockpile:30,net:-5},influence:{stockpile:null,net:0},living_metal:{stockpile:12,net:null}},
    projects:['BEHEMOTH_TRANSFERENCE_PROJECT'],growingPains:{progress:32,monthlyChange:5,approach:'behemoth_finale_approach_brawn'},
    guide:{topic:'behemoth',section:'finale'}});

  log.player_only_filter=false;
  const unscoped=(await review()).behemoth;
  assert.equal(unscoped.projects,null);
  assert.equal(unscoped.growingPains,null);
  assert.equal(unscoped.guide.section,'hatch');
});
