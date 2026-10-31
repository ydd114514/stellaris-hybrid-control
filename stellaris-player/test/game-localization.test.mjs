import test from'node:test'
import assert from'node:assert/strict'
import{parseLocalization,createNameResolver}from'../src/game-localization.mjs'
test('game name variables resolve from local text while unknown and cyclic keys stay unknown',()=>{
  const map=parseLocalization(' PREFIX_NAME_FORMAT: "$PREFIX$$NAME$"\n PREFIX:0 "UNS"\n SHIP: "信风"\n TECH:1 "§Y动力外骨骼§!"\n CYCLE: "$CYCLE$"')
  const resolver=createNameResolver(map)
  assert.equal(resolver.resolve({key:'PREFIX_NAME_FORMAT',variables:[{key:'PREFIX',value:{key:'PREFIX'}},{key:'NAME',value:{key:'SHIP'}}]}),'UNS信风')
  assert.equal(resolver.resolve('TECH'),'动力外骨骼');assert.equal(resolver.resolve('missing'),null);assert.equal(resolver.resolve('CYCLE'),null)
})
