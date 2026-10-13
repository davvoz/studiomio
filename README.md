# studiomio

DAW nel browser con warp in stile Ableton Live. Si parte dall'arrangement (timeline);
il modello è pensato fin dall'inizio per aggiungere la session view, le clip MIDI col
piano roll e gli strumenti.

Nasce dal motore DSP di [WarpMio](../warpmio), portato in TypeScript.

## Avvio

```sh
npm install
npm run dev        # http://localhost:5173 – oggi c'è il banco di prova del motore DSP
```

| Comando | Cosa fa |
|---|---|
| `npm run dev` | server di sviluppo (con le intestazioni COOP/COEP) |
| `npm test` | test: il DSP deve dare lo stesso risultato di WarpMio |
| `npm run bench` | tempi di ogni modalità di warp, TypeScript contro WebAssembly |
| `npm run typecheck` | controllo dei tipi |
| `npm run build` | build di produzione in `dist/` |
| `npm run wasm` / `wasm:test` | compila il crate Rust per il browser / per i test |

Per usare gli algoritmi WebAssembly nell'app: `VITE_DSP_WASM=1 npm run dev`.

Requisiti: Node 22+, Rust (`rustup target add wasm32-unknown-unknown`) e `wasm-pack`.
Il pacchetto WebAssembly non è nel repository: dopo `npm install` lancia una volta
`npm run wasm` e `npm run wasm:test` (servono anche per i test e la build).

## Struttura

```
src/
  dsp/                 motore audio: funzioni pure, nessuna dipendenza dal DOM
    fft.ts, signal.ts, time-map.ts
    stretch/           modalità di warp, una classe per algoritmo (TimeStretcher)
    analysis/          onset, transienti, tempo, beat tracking
    codec/             WAV e ZIP
    engine.ts          DspEngine: sample caricati + render + analisi
    wasm/              ponte verso il crate Rust
  workers/
    rpc.ts             RPC tipizzato tra thread
    worker-pool.ts     gruppo di worker con coda e sostituzione dei compiti
    dsp.worker.ts      il DspEngine dentro un worker
    dsp-service.ts     facciata usata dall'app
  demo/                loop demo
crates/dsp/            phase vocoder in Rust → WebAssembly (SIMD)
tests/                 test di equivalenza con WarpMio, pool, WASM; benchmark
```

## Principi

- **Funzionale per i calcoli, oggetti per lo stato.** Il DSP è fatto di funzioni pure; le
  classi incapsulano stato e ciclo di vita (FFT con tabelle, phase vocoder, pool).
- **Tabelle invece di switch.** Le modalità di warp sono un'unione discriminata e
  `StretcherTable` associa a ognuna il suo algoritmo: aggiungere una modalità significa
  aggiungere un tipo e una classe, e il compilatore segnala ciò che manca.
- **Dipendenze iniettate.** Il renderer riceve la tabella degli algoritmi, il pool riceve
  la fabbrica dei worker: si sostituiscono (WASM, worker finti nei test) senza toccare il resto.
- **Il riferimento è WarpMio.** `tests/reference/warpdsp.legacy.js` è il motore originale; i
  test verificano che la versione TypeScript dia lo stesso risultato.

## Prestazioni misurate (16 s stereo, Complex)

| | tempo |
|---|---|
| TypeScript | ~290 ms |
| WebAssembly (Rust, SIMD) | ~330 ms |
| 8 render in parallelo nel browser (8 worker) | 5× più veloce che in sequenza |

Oggi il guadagno vero viene dal **parallelismo** dei worker. Il WASM resta pronto ma non
è attivo di default: sul phase vocoder V8 è già più veloce, perché le funzioni
trigonometriche in WASM sono più lente. Servirà nel motore in tempo reale (AudioWorklet),
dove conta la regolarità più della velocità di picco.
