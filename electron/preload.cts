// What the app (src/) can ask the main process for: for now the user's preset and rack
// files. The rest of the app doesn't know it runs in Electron.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('studiomioDesktop', {
  presets: {
    load: () => ipcRenderer.invoke('presets:load'),
    save: (folder: string, preset: unknown) => ipcRenderer.invoke('presets:save', folder, preset),
    remove: (type: string, name: string) => ipcRenderer.invoke('presets:remove', type, name),
    reveal: () => ipcRenderer.invoke('presets:reveal'),
  },
  racks: {
    load: () => ipcRenderer.invoke('racks:load'),
    save: (rack: unknown) => ipcRenderer.invoke('racks:save', rack),
    remove: (name: string) => ipcRenderer.invoke('racks:remove', name),
    reveal: () => ipcRenderer.invoke('racks:reveal'),
  },
});
