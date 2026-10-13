import { App } from './app/app';

const app = new App(document.getElementById('app')!);

// in sviluppo l'app è raggiungibile dalla console (e dalle verifiche automatiche)
if (import.meta.env.DEV) Object.assign(window, { studiomio: app });
