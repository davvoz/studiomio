import { App } from './app/app';
import { userPresets } from './devices/user-presets';
import { userRacks } from './devices/user-racks';

// i preset e i rack dell'utente prima dei dispositivi (sono pochi file); senza, l'app parte lo stesso
await Promise.all([
  userPresets.load().catch(e => console.warn('preset: non è stato possibile leggerli', e)),
  userRacks.load().catch(e => console.warn('rack: non è stato possibile leggerli', e)),
]);

const app = new App(document.getElementById('app')!);

// in sviluppo l'app è raggiungibile dalla console (e dalle verifiche automatiche); nell'app
// installata solo i controller, per la diagnosi da F12: copy(studiomio.surfaces.report())
Object.assign(window, { studiomio: import.meta.env.DEV ? app : { surfaces: app.surfaces } });
