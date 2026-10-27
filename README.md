# studiomio

DAW nel browser (e in Electron) sul modello di Ableton Live: arrangement e session view, clip
audio con warp, clip MIDI, modulazioni delle clip, strumenti ed effetti in AudioWorklet, rack con
macro, controller MIDI. TypeScript; il motore di warp viene da [WarpMio](../warpmio).

## Scarica

[![Scarica per Windows](https://img.shields.io/github/v/release/davvoz/studiomio?label=Scarica%20per%20Windows&style=for-the-badge&color=ff9d2e)](https://github.com/davvoz/studiomio/releases/latest/download/studiomio-setup.exe)

Il pulsante scarica subito l'installer dell'ultima versione (Windows 10/11 a 64 bit). Non è
firmato: alla prima installazione "Ulteriori informazioni" → "Esegui comunque". Si aggiorna da
solo. Note e versioni precedenti nelle [Releases](https://github.com/davvoz/studiomio/releases).

## Sviluppo

Requisiti: Node 22+, Rust con `wasm32-unknown-unknown` e `wasm-pack`. Dopo `npm install` lancia una
volta `npm run wasm` e `npm run wasm:test` (il pacchetto WebAssembly non è nel repository).

| Comando | |
|---|---|
| `npm run dev` | server di sviluppo su http://localhost:5173 (intestazioni COOP/COEP; Chrome o Edge) |
| `npm test` · `npm run typecheck` | test (Vitest) · tipi |
| `npm run build` | build di produzione in `dist/` |
| `npm run bench` | tempi del warp, TypeScript contro WebAssembly (`/bench.html`) |
| `npm run app` · `npm run dist` | l'app in Electron · l'installer in `release/` |

`VITE_DSP_WASM=1` attiva gli algoritmi WebAssembly. Gli script in `scripts/` girano con i moduli
dell'app: `node scripts/run.mjs scripts/<nome>.ts …`.

**Rilascio**: `npm version <patch|minor|major>` e `git push --follow-tags`. Il tag avvia
`.github/workflows/release.yml` (WASM, test, installer, pubblicazione con `latest.yml`, che le app
installate leggono per aggiornarsi). Le voci del CHANGELOG sotto "Unreleased" finiscono nella release.

## Architettura

```
UI (DOM + canvas) ──comandi──▶ ProjectStore ──versioni immutabili──▶ PlaybackEngine
                                    │                                    │
                              persistence/ (JSON)          Web Audio: mixer, mandate, gruppi
                                                           AudioWorklet: strumenti, effetti, misuratori
                                                           Worker pool: render del warp (TS o WASM)
```

```
src/
  core/         id tipizzati, eventi, tempo musicale (battiti, BPM, metro)
  model/        il progetto immutabile: tracce (audio, MIDI, gruppo, bus), clip, warp marker,
                note, modulazioni, dispositivi, rack e macro, scene, quantizzazione del lancio
  store/        ProjectStore (annulla/ripeti come pila di versioni) e le modifiche, funzioni pure
                Project → Project, una per azione dell'utente
  persistence/  progetto ⇄ JSON con versione e migrazioni; cartella del progetto su Directory
                (File System Access, Node o in memoria)
  engine/       riproduzione: scheduler con anticipo, session (cosa suona ogni traccia e da quando),
                modulazioni programmate, catene degli effetti aggiornate per differenza, cache LRU
                dei render di warp, export offline; tutto su audio-graph.ts (Web Audio o finto)
  devices/      strumenti ed effetti: descrizioni (parametri, sezioni, preset), motori DSP, rack di
                fabbrica; worklet/ i processori AudioWorklet; dsp/ i mattoni (oscillatori PolyBLEP,
                SVF/TPT, ADSR, LFO, polifonia, sovracampionamento, sequencer a passi)
  dsp/          motore di warp, senza DOM: stretch/ (beats, tones, texture, complex, repitch),
                analysis/ (onset, transienti, tempo), codec/ (WAV, ZIP), wasm/ (ponte verso Rust)
  workers/      RPC tipizzato, worker pool, DspService
  browser/      il browser come dati: fonti, voci, ricerca
  control/      controller via Web MIDI: APC40 mkII, Launchpad X / Mini MK3 / Pro MK3 / MK2
  ui/           timeline, session, piano roll, editor audio, modulazioni, catena dei dispositivi
                (controlli generati dai parametri, pannelli grafici registrati in displays.ts)
  app/          montaggio: AudioContext, worker, motore, comandi, apertura e salvataggio
electron/       main.ts: serve dist/ da app://studiomio con COOP/COEP, permessi, aggiornamenti
crates/dsp/     phase vocoder in Rust → WebAssembly (SIMD)
scripts/        render senza browser (headless-render.ts, render-project.ts), loudness BS.1770
tests/          un file per modulo; equivalenza con WarpMio (tests/reference/)
```

Una cartella di progetto contiene `progetto.json` (leggibile, versionato), `progetto.bak.json` (il
salvataggio precedente) e `audio/` (i file originali copiati all'importazione).

### Audio in tempo reale

- **Due processori AudioWorklet**: uno per gli strumenti (note con il tempo del contesto, ogni blocco
  diviso al campione esatto di ogni nota) e uno per gli effetti. I motori DSP sono registrati per
  tipo in `devices/worklet/cores.ts`.
- **Parametri e modulazioni**: i parametri dei dispositivi arrivano come scalini e rampe datati,
  applicati a blocchi di 128 campioni (`mod-timeline.ts`). Volume e pan sono AudioParam, precisi al
  campione.
- **Trasporto**: effetti e strumenti che seguono la battuta (delay, gate, beat repeat, sequencer)
  ricevono un'ancora battito ↔ tempo del contesto.
- **Misuratori**: picco e RMS scritti in SharedArrayBuffer, per questo servono COOP/COEP.
- **Warp**: le clip audio sono renderizzate nei worker e tenute in una cache LRU per contenuto. Le
  clip della session girano su un orologio continuo, che resta in fase con il loop della timeline.

## Funzionalità

- **Arrangement**: timeline su canvas, loop, griglia, taglia/copia/incolla, split, metronomo.
- **Session**: slot e scene, lancio quantizzato (da nessuno a 4 battute), ritorno all'arrangement
  per traccia come in Live.
- **Tracce**: audio, MIDI, gruppi annidati (con solo e mute come in Live) e bus di mandata
  post-fader.
- **Clip audio**: warp marker, Auto-Warp dai transienti, modalità di warp, transpose, gain.
- **Clip MIDI**: piano roll con velocity, fold, quantizzazione, :2 / ×2.
- **Modulazioni delle clip**: curve relative su volume, pan, qualsiasi parametro o macro. Girano con
  il loop della clip e finiscono nell'export.
- **Rack**: Instrument Rack e Audio Effect Rack a catena singola, con 8 macro (manopola, interruttore,
  pulsante o molla, che lasciata torna da sola al suo riposo) mappabili con minimo e massimo.
  Preset salvabili, rack di fabbrica.
- **Browser**: dispositivi, preset, rack, kit, sample del progetto e cartelle del disco, con ricerca
  e anteprima.
- **Controller**: APC40 mkII e Launchpad plug and play (Ableton/DAW mode): griglia delle clip,
  riquadro, mixer, 8 macro o parametri del dispositivo, trasporto. Per diagnosticare il supporto
  Launchpad, che non è provato sull'hardware, c'è `studiomio.surfaces.report()`.
- **Export**: mix della timeline con OfflineAudioContext. In Node, `scripts/render-project.ts`
  calcola il mix e gli stem con gli stessi motori DSP e misura la loudness (integrata, short-term,
  true peak).

### Dispositivi

| Strumenti | |
|---|---|
| Analog | sottrattivo a due oscillatori, Poli/Mono/Legato con glide, accento stile 303, unison fino a 7 |
| Wavetable | due oscillatori a tabelle band-limited per ottava, sub, unison, 2 LFO, inviluppo di modulazione |
| Prisma | wavetable tipo Serum: fonti di modulazione trascinabili, matrice, 13 tipi di filtro |
| Neuro | bassi reese/neuro, mono: FM, wavefolder, formanti, sub su crossover, 2× sovracampionato |
| Sampler | Classic / One-Shot / Slice, fino a 32 zone con pitch, filtro, inviluppi e LFO propri |
| Drum Machine | 16 pad sintetizzati o da sample, choke, inizio e verso del sample |

Analog e Neuro hanno un **sequencer a passi**. Con una nota tenuta suona un pattern deterministico
(128 pattern), agganciato alla battuta del trasporto e trasposto su quella nota. Lo controllano
densità, scala, accenti, slide, passi (1–32), velocità e gate.

**Effetti**: EQ (8 bande, TPT, il grafico usa la stessa matematica del suono), Compressore (con
sidechain), Multibanda (stile OTT), Drive (6 curve, ADAA, sovracampionato), Clipper, Redux,
Auto Filter, Auto Pan, Chorus, Phaser/Flanger, Pitch Shifter, Gate a passi, Beat Repeat, Tape Stop, Reverse,
Delay, Riverbero (FDN 8 linee), Stereo (larghezza e bassi mono), Limiter (lookahead, true peak).

### Aggiungere un dispositivo

1. La descrizione (`DeviceType`: sezioni di parametri e preset) in `src/devices/instruments/<nome>/`
   o `src/devices/effects/<nome>/`, registrata in `registry.ts`.
2. Il motore, registrato con lo stesso nome in `devices/worklet/cores.ts`. Per uno strumento è un
   `InstrumentCore` (`noteOn`, `noteOff`, `setParams`, `render`), per un effetto un `EffectCore`
   (`setParams`, `setTempo`, `process`).

Interfaccia, salvataggio, preset, annulla, bypass, mappatura sulle macro e messaggi verso l'audio
vengono da soli. Un pannello grafico proprio si registra in `ui/device/displays.ts`.

## Principi

- **Modello immutabile**: ogni modifica produce un nuovo `Project` che condivide le parti non
  toccate. Annulla/ripeti è una pila di versioni, e il motore capisce cosa è cambiato confrontando i
  riferimenti. Le posizioni sono in battiti; i secondi servono solo per suonare.
- **Funzioni pure per i calcoli, classi per lo stato**: le modifiche e il DSP sono funzioni; le
  classi incapsulano stato e ciclo di vita (voci, FFT, pool).
- **Tabelle invece di switch**: modalità di warp, tipi di clip, tracce e dispositivi sono registri.
  Aggiungerne uno vuol dire aggiungere una voce, e il compilatore segnala ciò che manca.
- **Dipendenze iniettate**: algoritmi, worker, id, Directory e grafo audio si sostituiscono nei test.
- **Retrocompatibilità**: il formato ha una versione, e ogni cambiamento porta una migrazione.
- **Riferimento**: i test confrontano il warp con il motore originale di WarpMio.

## Prestazioni (warp, 16 s stereo, Complex)

| | |
|---|---|
| TypeScript | ~290 ms |
| WebAssembly (Rust, SIMD) | ~330 ms |
| 8 worker in parallelo | 5× più veloce che in sequenza |

Il WASM è pronto ma spento: su questo carico V8 è più veloce, e il guadagno vero viene dal
parallelismo dei worker.
