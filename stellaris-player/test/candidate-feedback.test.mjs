import test from 'node:test';import assert from 'node:assert/strict';
import {candidateFeedback,researchChoices} from '../src/candidate-feedback.mjs';
import {decisionReview} from '../src/decision-review.mjs';
test('feedback preserves exact candidate keys and command arguments without guessing unknown pools',()=>{
 assert.deepEqual(candidateFeedback('select_research',{candidates:[{key:'tech_x'}]},{slot:'society',observedAt:5}).candidates[0].arguments,{slot:'society',tech_key:'tech_x'});
 assert.deepEqual(candidateFeedback('adopt_ascension_perk',{candidates:[{key:'ap_x'}]}).candidates[0].arguments,{perk_key:'ap_x'});
 for(const candidates of [undefined,[{name:'missing key'}],[{key:'bad key'}],[{key:'dup'},{key:'dup'}]])assert.equal(candidateFeedback('adopt_tradition',{candidates}).known,false);
 const empty=candidateFeedback('adopt_tradition',{candidates:[]});assert.equal(empty.known,true);assert.equal(empty.complete,true);
});
test('large candidate hints are explicitly partial rather than dropping valid keys silently',()=>{
 const candidates=Array.from({length:40},(_,i)=>({key:'tech_'+i,name:'N'.repeat(200)}));const r=candidateFeedback('select_research',{candidates},{slot:'physics'});
 assert.equal(r.candidates.length,32);assert.equal(r.complete,false);assert.equal(r.candidates[0].name.length,80);
});
test('only observed idle research slots receive choices; stale review never republishes old candidates',()=>{
 const s={research:{physics:{current:null,candidates:[{key:'tech_p'}]},society:{current:{is_researching:true},candidates:[{key:'tech_s'}]},engineering:{candidates:[{key:'tech_e'}]}}};
 assert.deepEqual(researchChoices(s).map(x=>x.slot),['physics']);
 assert.equal(decisionReview(s,{observedAt:10,now:20}).researchChoices[0].candidates[0].key,'tech_p');
 assert.deepEqual(decisionReview(s,{observedAt:10,now:10011}).researchChoices,[]);
});
