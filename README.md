# studiomio

DAW nel browser con warp in stile Ableton Live. Si parte dall'arrangement (timeline);
il modello è pensato fin dall'inizio per aggiungere la session view, le clip MIDI col
piano roll e gli strumenti.

Nasce dal motore DSP di [WarpMio](../warpmio), portato in TypeScript.

## Avvio

```sh
npm install
npm run dev        # http://localhost:5173 – l'app (Chrome o Edge: servono per aprire e salvare le cartelle)
                   # http://localhost:5173/bench.html – banco di prova del DSP
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
  core/                id tipizzati, eventi, tempo musicale (battiti, tempo, metro)
  model/               il progetto, immutabile
    project.ts         radice: tracce, scene, sample, tempo, loop
    track.ts           Track → AudioTrack, MidiTrack (mixer, timeline, slot della session)
    clip.ts            Clip → AudioClip (sample + warp), MidiClip (note)
    arrangement.ts     clip posate sulla timeline (sovrapposizioni come in Live)
    warp-markers.ts    mappa di warp di una clip audio
  store/
    project-store.ts   progetto corrente, annulla/ripeti, modifiche continue unite
    edits.ts           una modifica per azione dell'utente (funzioni pure)
  persistence/
    project-codec.ts   progetto ⇄ JSON, con registri per tipi di clip e traccia
    project-folder.ts  cartella del progetto: progetto.json, backup, audio/
    directory.ts       interfaccia Directory (+ in memoria); fs-access-directory.ts per il disco
  engine/              riproduzione, sulle interfacce di audio-graph.ts (Web Audio o finto nei test)
    playback-engine.ts trasporto: play/stop/seek, aggiornamento a ogni versione del progetto
    scheduler.ts       programmazione in anticipo, loop della timeline a corse
    segments.ts        clip posata → tratti continui di contenuto
    players/           un player per tipo di traccia (audio, MIDI), strumenti, metronomo
    clip-audio.ts      clip audio → buffer pronto (render di warp o sample originale)
    render-cache.ts    render di warp per contenuto, LRU con budget di memoria
    mixer-graph.ts     canali con volume, pan, mute/solo e master
    offline-mix.ts     export del mix con lo stesso motore (OfflineAudioContext)
    warp-job.ts        dalla clip audio al lavoro di warp per il DSP
  app/
    app.ts             monta l'app e implementa i comandi
    audio-system.ts    monta insieme worker, sample, cache, AudioContext e motore
    project-session.ts cartella del progetto: importa, apri, salva, salva con nome
  ui/
    timeline/          arrangement: geometria, disegno su canvas, gesti, pianificazione
    track-headers.ts   intestazioni delle tracce (nome, mute/solo, volume)
    transport-bar.ts   barra in alto
    keymap.ts          scorciatoie da tastiera (una riga per comando)
    clip-editor/       editor delle clip audio: asse, disegno, gesti, pannello
    waveform.ts        picchi della forma d'onda a più risoluzioni
  dsp/                 motore audio: funzioni pure, nessuna dipendenza dal DOM
    stretch/           modalità di warp, una classe per algoritmo (TimeStretcher)
    analysis/          onset, transienti, tempo, beat tracking
    codec/             WAV e ZIP
    wasm/              ponte verso il crate Rust
  workers/             RPC tipizzato, worker pool, worker DSP, DspService
  demo/                loop e progetto demo
crates/dsp/            phase vocoder in Rust → WebAssembly (SIMD)
tests/                 un file per modulo; test di equivalenza con WarpMio
```

La cartella di un progetto:

```
MioBrano/
  progetto.json        tracce, clip, marker, mixer (testo leggibile, versionato)
  progetto.bak.json    il salvataggio precedente
  audio/               i file audio originali, copiati all'importazione
```

## Uso della timeline

| | |
|---|---|
| Trascina file audio sulla timeline | importa (sulla traccia sotto, o su una nuova) |
| Trascina una clip | sposta (anche su un'altra traccia dello stesso tipo); con Ctrl copia; con Alt senza griglia |
| Trascina il bordo di una clip | accorcia o allunga |
| Trascina nel vuoto | selezione a riquadro; un clic sposta il cursore |
| Fascia alta del righello | bordi del loop: sposta quell'estremo tenendo fermo l'altro · corpo: sposta il loop · fuori: disegna un loop nuovo · clic: accende/spegne |
| Doppio clic su una traccia MIDI vuota | nuova clip di una battuta |
| Spazio · Invio | play/stop · stop e torna all'inizio |
| Ctrl+Z / Ctrl+Y · Canc · Ctrl+D · Ctrl+E | annulla/ripeti · elimina · duplica · dividi al cursore |
| Ctrl+L · Ctrl+4 · Ctrl+Maiusc+M | loop · griglia · metronomo |
| Rotella · Maiusc+rotella · Ctrl+rotella · + / − | scorri · scorri in orizzontale · zoom |
| Ctrl+S · Ctrl+O | salva · apri |

## Editor delle clip audio

Doppio clic su una clip audio: si apre in basso (Esc per chiudere).

| | |
|---|---|
| Trascina un warp marker (striscia gialla) | cambia il battito su cui cade; con Maiusc sposta l'audio sotto il marker |
| Trascina da un transiente (segni grigi) | crea un marker lì e lo trascina |
| Doppio clic sulla striscia o sulla forma d'onda | aggiunge un warp marker |
| Canc | elimina il marker selezionato |
| Fascia arancione in alto | come la fascia del loop sul righello, per il loop della clip |
| Bandierine bianche | inizio e fine della clip |
| Trascina la forma d'onda · clic | scorre la vista · porta lì il cursore della timeline |
| Pannello | warp, modalità e opzioni, BPM della clip o del segmento, :2 ×2, 1.1.1 qui, Auto-Warp, Segui tempo, Quantizza, Azzera, transpose, detune, gain |

## Principi

- **Modello immutabile.** Ogni modifica produce un nuovo `Project` che condivide le parti non
  toccate: annulla/ripeti è una pila di versioni, e chi osserva capisce cosa è cambiato
  confrontando i riferimenti. Le posizioni sono in battiti; i secondi servono solo per suonare.
- **Funzionale per i calcoli, oggetti per lo stato.** Il DSP è fatto di funzioni pure; le
  classi incapsulano stato e ciclo di vita (FFT con tabelle, phase vocoder, pool).
- **Tabelle invece di switch.** Le modalità di warp sono un'unione discriminata e
  `StretcherTable` associa a ognuna il suo algoritmo: aggiungere una modalità significa
  aggiungere un tipo e una classe, e il compilatore segnala ciò che manca.
- **Dipendenze iniettate.** Il renderer riceve la tabella degli algoritmi, il pool la fabbrica
  dei worker, lo store la fabbrica degli id, il salvataggio una `Directory`: si sostituiscono
  (WASM, worker finti, cartella in memoria nei test) senza toccare il resto.
- **Tipi nuovi senza toccare il vecchio.** Un nuovo tipo di clip è una sottoclasse di `Clip`
  più un `ClipCodec` registrato; un nuovo tipo di traccia è una sottoclasse di `Track` più una
  voce in `defaultTrackTypes` e in `addTrack`.
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
