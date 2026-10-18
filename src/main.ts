import { App } from './app/app';
import { userPresets } from './devices/user-presets';

// i preset dell'utente prima dei dispositivi (sono pochi file); senza, l'app parte lo stesso
await userPresets.load().catch(e => console.warn('preset: non è stato possibile leggerli', e));

const app = new App(document.getElementById('app')!);

// in sviluppo l'app è raggiungibile dalla console (e dalle verifiche automatiche)
if (import.meta.env.DEV) Object.assign(window, { studiomio: app });
