/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" per usare gli algoritmi WebAssembly dove esistono. */
  readonly VITE_DSP_WASM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** La versione dell'app, da package.json (vedi vite.config.ts). */
declare const __APP_VERSION__: string;
