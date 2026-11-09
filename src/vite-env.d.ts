/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" to use the WebAssembly algorithms where they exist. */
  readonly VITE_DSP_WASM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The app's version, from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string;
