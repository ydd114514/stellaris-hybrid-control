import {councilAgendaCandidates} from './council-agendas.mjs';
import {ordinaryEdictOptions,STRATEGY_DIMENSIONS} from './strategy-contract.mjs';

export function strategyDecisionOptions(state,{government,edicts,lockedDimensions,contract}={}){
  const dimensions=Object.keys(STRATEGY_DIMENSIONS);
  const gestalt=['hive','machine'].includes(state.empireType);
  const steering=Object.fromEntries(dimensions.map(dimension=>{
    const lock=lockedDimensions?.[dimension];
    const choices=STRATEGY_DIMENSIONS[dimension].filter(choice=>!gestalt||choice!=='consumer_stability');
    return [dimension,lock?{locked:lock.by}:{choices}];
  }));
  const edictOptions=ordinaryEdictOptions(edicts,state);
  const activeAgenda=state.council?.active_agenda;
  const available=typeof activeAgenda==='string'?[...new Set(councilAgendaCandidates(government??{})
    .map(row=>row.key).filter(key=>key!==activeAgenda&&/^agenda_[a-zA-Z0-9_]{1,100}$/.test(key)))].slice(0,4):[];
  const agendas={available,status:available.length?'ok':'无合法候选'};
  const allowed=[
    ...dimensions.filter(dimension=>steering[dimension].choices),
    ...(edictOptions.activatable.length||edictOptions.deactivatable?.length?['普通法令']:[]),
    ...(available.length?['内阁议程']:[]),
    '修改目标','维持理由',
  ];
  const options={steering,edicts:edictOptions,agendas,allowed};
  if(allowed.length===2){
    const actual=state.strategyContract?.steeringConfirmed===true?state.strategyContract:contract;
    const values=Object.fromEntries(dimensions.map(dimension=>[dimension,actual?.[dimension]??lockedDimensions[dimension].value]));
    options.contractTemplate={...values,goals:[],reason:'',domesticActions:[],oneOffActions:[]};
    options.instruction='本次只能修改目标或说明维持理由。国内设置无可执行候选。沿用模板方针，填写目标与理由并留空操作。若维持，理由以「维持理由：」开头并说明具体依据。';
  }
  return options;
}
