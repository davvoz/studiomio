import { App } from './app/app';
import { userPresets } from './devices/user-presets';
import { userRacks } from './devices/user-racks';

// the user's presets and racks before the devices (they're few files); without them, the app starts anyway
await Promise.all([
  userPresets.load().catch(e => console.warn('presets: couldn\'t read them', e)),
  userRacks.load().catch(e => console.warn('racks: couldn\'t read them', e)),
]);

const app = new App(document.getElementById('app')!);

// in development the app is reachable from the console (and from the automated checks); in the
// installed app only the controllers, for diagnosis from F12: copy(studiomio.surfaces.report())
Object.assign(window, { studiomio: import.meta.env.DEV ? app : { surfaces: app.surfaces } });
