import {inspectNativeProcess} from '../src/native-process.mjs';
const binding=await inspectNativeProcess({op:'identity'});
console.log(JSON.stringify(await inspectNativeProcess({op:'ships',...binding,fleetIds:[],countryId:0}),null,2));
