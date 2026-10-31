import test from 'node:test';import assert from 'node:assert/strict';
import {validateMarketInspectionScope,quoteMarketInspection} from '../src/market-inspection.mjs';
const market={settlement_currency:'trade',resources:[{key:'food',batch_size:100,buy_price_per_unit:1.3,sell_price_per_unit:.7},{key:'minerals',batch_size:100},{key:'rare_crystals',batch_size:10}]};
const quote=p=>({success:true,price_basis:'engine_transaction_total',includes_fee:true,...p,settlement_currency:'trade',total:p.units*(p.action==='sell'?.7:1.3)});
test('focused whole quote uses one native query instead of quoting every resource in both directions',async()=>{
 const calls=[],scope=validateMarketInspectionScope({topic:'market',resource:'food',action:'sell',units:300});
 const r=await quoteMarketInspection(market,scope,async(m,p)=>{calls.push([m,p]);return quote(p);});
 assert.equal(calls.length,1);assert.equal(r.resources.length,1);assert.equal(r.resources[0].sell_total,210);assert.deepEqual(r.resources[0].quote_coverage,['sell']);
 assert.equal(r.resources[0].price_basis_by_action.buy,'resource_definition_base_estimate');assert.equal(r.quoteScope.executionRequiresFreshWholeQuote,true);assert.equal(market.resources.length,3);assert.equal(market.resources[0].quote_units,undefined);
 const full=[];await quoteMarketInspection(market,{},async(m,p)=>{full.push(p);return quote(p);});assert.equal(full.length,6);
});
test('resource-only quote keeps both directions of one real batch and preserves their independent evidence',async()=>{
 const r=await quoteMarketInspection(market,{resource:'rare_crystals'},async(m,p)=>quote(p));
 assert.equal(r.resources[0].quote_units,10);assert.deepEqual(r.resources[0].quote_coverage,['buy','sell']);assert.equal(r.resources[0].price_basis,'engine_transaction_total');
 const partial=await quoteMarketInspection(market,{resource:'food'},async(m,p)=>p.action==='sell'?quote(p):{...quote(p),units:200});
 assert.deepEqual(partial.resources[0].quote_coverage,['sell']);assert.equal(partial.resources[0].price_basis,'resource_definition_base_estimate');
});
test('unknown quantities and unselected resource keys cannot trigger quote requests',async()=>{
 for(const args of [{topic:'ships',resource:'food'},{topic:'market',resource:'../food'},{topic:'market',action:'sell'},{topic:'market',resource:'food',units:100},{topic:'market',resource:'food',action:'buy',units:1.5},{topic:'market',resource:'food',action:'buy',units:5001}])assert.throws(()=>validateMarketInspectionScope(args));
 let calls=0;const rpc=async()=>{calls++;throw Error('must not call');};
 for(const scope of [{resource:'unknown'},{resource:'food',action:'sell',units:101}])await assert.rejects(quoteMarketInspection(market,scope,rpc));
 assert.equal(calls,0);
 const unknownCurrency=await quoteMarketInspection({...market,settlement_currency:undefined},{resource:'food'},rpc);
 assert.equal(unknownCurrency.resources[0].price_basis,'resource_definition_base_estimate');assert.equal(calls,0);
});
test('mismatched whole quote metadata never becomes verified preview pricing',async()=>{
 for(const change of [{success:false},{resource:'minerals'},{action:'buy'},{units:200},{settlement_currency:'energy'},{includes_fee:false},{total:NaN},{total:0},{price_basis:'base_estimate'}]){
  const r=await quoteMarketInspection(market,{resource:'food',action:'sell'},async(m,p)=>({...quote(p),...change}));
  assert.deepEqual(r.resources[0].quote_coverage,[]);assert.equal(r.resources[0].price_basis,'resource_definition_base_estimate');assert.ok(r.resources[0].quote_error);
 }
});
