import { contextBridge, ipcRenderer } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on: (channel: string, listener: (event: any, ...args: any[]) => void) => {
    const subscription = (event: any, ...args: any[]) => listener(event, ...args)
    ipcRenderer.on(channel, subscription)
    return () => {
        ipcRenderer.removeListener(channel, subscription)
    }
  },
  off: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, listener)
  },
  send: (channel: string, ...args: any[]) => {
    ipcRenderer.send(channel, ...args)
  },
  invoke: (channel: string, ...args: any[]) => {
    return ipcRenderer.invoke(channel, ...args)
  },
})
