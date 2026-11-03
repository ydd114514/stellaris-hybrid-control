import test from 'node:test';
import assert from 'node:assert/strict';
import {scriptBlocks,includeSteeredPlayer,compatibleEconomyPlans,compatibleExpansionBudgets,retiredUnityPersonalityFiles,compatiblePlayerServices,compatibleZoneTriggers,compatibleZoneCountWeights} from '../src/stellar-steering-compat.mjs';

test('source reader ignores comments and quoted braces without flattening nested rules',()=>{
 const rows=scriptBlocks('# ignored = {\n@cost = 10\nfirst = { title = "brace } # literal" nested = { x = yes } }\nsecond = { # } comment\n foo = no }');
 assert.deepEqual(rows.map(row=>row.key),['first','second']);assert.match(rows[0].text,/nested = \{ x = yes \}/);
 assert.throws(()=>scriptBlocks('broken = { nope = yes'),/不完整/);
});

test('economy integration retains actual tier identities and does not replace the overhaul recovery logic',()=>{
 const plan={key:'stellar_growing_economy',text:'stellar_growing_economy = { potential = { is_ai = yes is_nomadic = no } ai_weight = { weight = 150 } income = { energy = 50 } subplan = { set_name = "stellar_recovery" income = { food = 100 } } }'};
 const result=compatibleEconomyPlans([plan]);
 assert.deepEqual(result.plans,['stellar_growing_economy']);assert.match(result.content,/cfsteer_research_plan = \{ potential = \{ always = no/);
 assert.match(result.content,/cfsteer_economy_unity_traditions/);assert.match(result.content,/cfsteer_economy_research/);assert.match(result.content,/OR = \{ is_ai = yes OR =/);
 assert.doesNotMatch(result.content,/stellar_recovery|income = \{ energy = 50/);
 assert.match(result.content,/is_nomadic = no/);
 const foreign=compatibleEconomyPlans([{...plan,text:plan.text.replace('is_ai = yes','any_neighbor_country = { is_ai = yes } NOT = { is_ai = yes }')}]);
 assert.match(foreign.content,/any_neighbor_country = \{ is_ai = yes \} NOT = \{ is_ai = yes \}/);
 const nested=includeSteeredPlayer('OR = { is_ai = yes NOT = { is_ai = yes } } owner = { is_ai = yes }');
 assert.equal((nested.match(/has_edict = cfsteer_economy_balanced/g)??[]).length,1);
 assert.match(nested,/owner = \{ is_ai = yes \}/);
});

test('Stellar expansion preserves effective conditions and scales only colony and outpost alloy weights',()=>{
 const row=(key,resource,category)=>({key,text:`${key} = { resource = ${resource} type = expenditure category = ${category} potential = { always = yes } weight = { weight = 7 modifier = { factor = 3 is_at_war = yes } } }`,variables:'@keep = 42'});
 const result=compatibleExpansionBudgets([row('stellar_colonies','alloys','colonies'),row('stellar_outposts','influence','stations'),row('stellar_starbases','alloys','starbases'),row('stellar_shipyards','alloys','stations'),row('stellar_navy','alloys','ships')]);
 assert.deepEqual(result.keys,['stellar_colonies','stellar_outposts','stellar_starbases']);assert.match(result.content,/weight = 7 modifier = \{ factor = 3/);
 assert.equal((result.content.match(/NOT = \{ has_edict = cfsteer_expansion_consolidate/g)??[]).length,2);
 assert.equal((result.content.match(/factor = 2\s+has_edict = cfsteer_expansion_aggressive/g)??[]).length,2);
 assert.doesNotMatch(result.content,/stellar_shipyards|stellar_navy/);
});

test('Stellar compatibility retires its old peaceful personality with inert migration files',()=>{
 const files=retiredUnityPersonalityFiles();
 assert.equal(files.length,3);
 const personality=files.find(row=>row.path==='common/personalities/zz_cfsteer_unity_exploration.txt');
 assert.deepEqual(scriptBlocks(personality.content.toString()),[]);
 for(const {content} of files)assert.doesNotMatch(content.toString(),/military_spending|weapon_preferences|cfsteer_unity_exploration_\w+\s*:/);
});

test('human country service is complementary to NPC dispatch and excludes script resource or aid transactions',()=>{
 const category=keys=>({definitions:new Map(keys.map(key=>[key,{key,text:key+' = { is_ai = yes is_nomadic = no }',variables:''}]))});
 const triggers=category(['stellarai_managed_empire','stellarai_settled_ai_has_unemployment','stellarai_war_fleet_push','stellarai_colonization_push','stellarai_expansion_phase','stellarai_long_war_refit','stellarai_opportunity_ready','stellarai_army_objective','stellarai_fleet_readiness_focus']);
 const effects=category(['stellarai_plan_research_worlds','stellarai_run_monthly_aid','stellarai_run_monthly_market','stellarai_aid_transfer_resource']);
 effects.definitions.get('stellarai_plan_research_worlds').text='stellarai_plan_research_worlds = { if = { limit = { is_ai = yes } set_country_flag = planning } }';
 effects.definitions.get('stellarai_aid_transfer_resource').text='stellarai_aid_transfer_resource = { root = { add_resource = { energy = -1 } } add_resource = { energy = 1 } }';
 const result=compatiblePlayerServices(triggers,effects,'country_event = { id = stellarai_strategy.1 immediate = { change_variable = { which = stellarai_war_months value = @stellarai_refit_war_months } } }');
 assert.match(result.events,/is_ai = no/);assert.match(result.events,/country_event = \{ id = stellarai_commitment.904/);
 assert.doesNotMatch(result.events,/id = stellarai_strategy\.1\b|id = stellarai_commitment\.906\b/);
 assert.match(result.effects,/root = \{ NOT = \{ cfcompat_steered_country = yes/);
 assert.match(result.effects,/stellarai_run_monthly_market = \{ if = \{ limit = \{ NOT = \{ cfcompat_steered_country = yes/);
 assert.match(result.effects,/limit = \{ OR = \{ is_ai = yes/);
 assert.match(result.triggers,/NOT = \{ has_edict = cfsteer_expansion_consolidate/);
 assert.match(result.onActions,/on_monthly_pulse/);
});

test('research-unity remains a research family and custom zone counts participate in the existing scale',()=>{
 const keys=['has_any_research_zone','has_any_unspecialized_research_zone','has_any_research_unity_zone','has_any_research_physics_zone','has_any_research_society_zone','has_any_research_engineering_zone','has_any_unity_zone','stellarai_has_generic_research_zone','stellarai_has_research_unity_zone','stellarai_has_unity_zone','stellarai_has_research_zone_pair'];
 const category={definitions:new Map(keys.map(key=>[key,{key,text:key+' = { original = yes }',variables:''}]))};
 const result=compatibleZoneTriggers(category),blocks=scriptBlocks(result);
 assert.match(blocks.find(row=>row.key==='stellarai_has_research_unity_zone').text,/cfsteer_zone_research_unity/);
 assert.doesNotMatch(blocks.find(row=>row.key==='stellarai_has_unity_zone').text,/cfsteer_zone_research_unity/);
 assert.match(blocks.find(row=>row.key==='stellarai_has_research_zone_pair').text,/AND = \{ has_zone = \{ zone = zone_research \} has_zone = \{ zone = cfsteer_zone_research \}/);
 const weight=compatibleZoneCountWeights('complex_trigger_modifier = { trigger = num_zones parameters = { type = zone_research } mode = add mult = @unchanged }',['zone_research']);
 assert.match(weight,/type = cfsteer_zone_research/);assert.equal((weight.match(/mult = @unchanged/g)??[]).length,2);
 const trophy=compatibleZoneCountWeights('complex_trigger_modifier = { trigger = num_zones parameters = { type = zone_unity } mode = add mult = @unity_weight }',['zone_unity_bio_trophy']);
 assert.match(trophy,/type = cfsteer_zone_unity_bio_trophy/);assert.equal((trophy.match(/mult = @unity_weight/g)??[]).length,2);
});
