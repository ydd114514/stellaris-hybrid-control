import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, Command, ShopBridge } from '../../../packages/shared/src/index'

const bridge: ShopBridge = {
  getState: () => ipcRenderer.invoke('shop:get-state'),
  command: (command: Command) => ipcRenderer.invoke('shop:command', command),
  subscribe(callback: (state: AppState) => void) {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state)
    ipcRenderer.on('shop:state', listener)
    return () => ipcRenderer.removeListener('shop:state', listener)
  },
  openStage: () => ipcRenderer.invoke('shop:open-stage'),
  exportLogs: () => ipcRenderer.invoke('shop:export-logs'),
}
contextBridge.exposeInMainWorld('shop', bridge)
