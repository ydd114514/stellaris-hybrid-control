import {fileURLToPath} from 'node:url';
import {saveHybridSettings as save,loadHybridSettings as load,saveNativeCountryAISettings as saveNative} from './hybrid-settings-store.mjs';
export const hybridSettingsPath=fileURLToPath(new URL('../.local/hybrid-control/settings.json',import.meta.url));
export const saveHybridSettings=(survey,options={})=>save(survey,{path:hybridSettingsPath,...options});
export const loadHybridSettings=(options={})=>load({path:hybridSettingsPath,...options});
export const saveNativeCountryAISettings=(enabled,options={})=>saveNative(enabled,{path:hybridSettingsPath,...options});
