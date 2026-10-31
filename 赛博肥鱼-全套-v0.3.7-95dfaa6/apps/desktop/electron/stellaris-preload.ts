import { contextBridge, ipcRenderer } from 'electron'
import type { StellarisBridge } from '../../../packages/shared/src/stellaris'
const bridge: StellarisBridge = {
  getStatus: () => ipcRenderer.invoke('dsh:status'),
  setHybridSurvey: enabled => ipcRenderer.invoke('dsh:set-hybrid-survey',enabled),
  setNativeCountryAI: enabled => ipcRenderer.invoke('dsh:set-native-country-ai',enabled),
  start: () => ipcRenderer.invoke('dsh:start'),
  stop: () => ipcRenderer.invoke('dsh:stop'),
  chooseProject: () => ipcRenderer.invoke('dsh:choose-project'),
  saveGameKey: key => ipcRenderer.invoke('dsh:save-game-key', key),
  music: {
    view: () => ipcRenderer.invoke('dsh:music-view'),
    action: (action,value) => ipcRenderer.invoke('dsh:music-action',action,value),
    feedback: (generation,kind) => ipcRenderer.invoke('dsh:music-feedback',generation,kind),
  },
  live: {
    info: () => ipcRenderer.invoke('dsh:live-info'),
    action: (action,value) => ipcRenderer.invoke('dsh:live-action', action,value),
  },
  ai: {
    view: () => ipcRenderer.invoke('dsh:ai-view'),
    action: action => ipcRenderer.invoke('dsh:ai-action', action),
  },
  speech:{view:()=>ipcRenderer.invoke('dsh:speech-view'),action:action=>ipcRenderer.invoke('dsh:speech-action',action)},
}
contextBridge.exposeInMainWorld('stellaris', bridge)
