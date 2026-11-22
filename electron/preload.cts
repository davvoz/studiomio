// What the app (src/) can ask the main process for: the user's preset and rack files and the
// project folders on disk. The rest of the app doesn't know it runs in Electron.
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
  folders: {
    pick: () => ipcRenderer.invoke('folders:pick'),
    exists: (root: string, path: string) => ipcRenderer.invoke('folders:exists', root, path),
    read: (root: string, path: string) => ipcRenderer.invoke('folders:read', root, path),
    write: (root: string, path: string, data: Uint8Array) => ipcRenderer.invoke('folders:write', root, path, data),
    list: (root: string, dir: string) => ipcRenderer.invoke('folders:list', root, dir),
    remove: (root: string, path: string) => ipcRenderer.invoke('folders:remove', root, path),
    markProject: (root: string) => ipcRenderer.invoke('folders:mark', root),
    launched: () => ipcRenderer.invoke('folders:launched'),
    onOpen: (fn: (folder: string) => void) => { ipcRenderer.on('folders:open', (_event, folder: string) => fn(folder)); },
  },
});
