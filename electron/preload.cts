// Ciò che l'app (src/) può chiedere al processo principale: per ora i file dei preset
// dell'utente. Il resto dell'app non sa di girare in Electron.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('studiomioDesktop', {
  presets: {
    load: () => ipcRenderer.invoke('presets:load'),
    save: (folder: string, preset: unknown) => ipcRenderer.invoke('presets:save', folder, preset),
    remove: (type: string, name: string) => ipcRenderer.invoke('presets:remove', type, name),
    reveal: () => ipcRenderer.invoke('presets:reveal'),
  },
});
