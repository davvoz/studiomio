# studiomio

DAW nel browser con warp in stile Ableton Live: arrangement (timeline), clip audio con
warp, clip MIDI con piano roll e strumenti in AudioWorklet. Il modello è pensato per
aggiungere la session view.

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
    track.ts           Track → AudioTrack, MidiTrack (mixer, timeline, slot della session, strumento)
    clip.ts            Clip → AudioClip (sample + warp), MidiClip (note)
    note-edits.ts      operazioni del piano roll sulle note (funzioni pure)
    instrument.ts      impostazioni dello strumento di una traccia (tipo, preset, parametri)
    arrangement.ts     clip posate sulla timeline (sovrapposizioni come in Live)
    warp-markers.ts    mappa di warp di una clip audio
  store/
    project-store.ts   progetto corrente, annulla/ripeti, modifiche continue unite
    edits.ts           una modifica per azione dell'utente (funzioni pure)
    clipboard.ts       appunti: copia e incolla di clip e di note
  persistence/
    project-codec.ts   progetto ⇄ JSON, con registri per tipi di clip e traccia
    project-folder.ts  cartella del progetto: progetto.json, backup, audio/
    directory.ts       interfaccia Directory (+ in memoria); fs-access-directory.ts per il disco
  engine/              riproduzione, sulle interfacce di audio-graph.ts (Web Audio o finto nei test)
    playback-engine.ts trasporto: play/stop/seek, aggiornamento a ogni versione del progetto
    scheduler.ts       programmazione in anticipo, loop della timeline a corse
    segments.ts        clip posata → tratti continui di contenuto
    players/           un player per tipo di traccia (audio, MIDI), interfaccia degli strumenti, metronomo
    worklet-instruments.ts  gli strumenti nel browser: nodi AudioWorklet
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
    context-menu.ts    menu contestuale: le voci sono dati (etichetta, scorciatoia, azione)
    clip-editor/       editor delle clip audio; clip-frame.ts è la cornice comune (righello, loop, bandierine)
    piano-roll/        editor delle note: tastiera, griglia, velocity, gesti, pannello
    device/            vista dello strumento: manopole e scelte generate dai parametri
    bottom-panel.ts    l'area in basso, una vista alla volta
    waveform.ts        picchi della forma d'onda a più risoluzioni
  instruments/         gli strumenti
    params.ts          descrizione dei parametri (da cui nascono controlli, default, validazione)
    registry.ts        i tipi di strumento disponibili
    analog/            il synth Analog: descrizione e preset (analog.ts), suono (analog-core.ts)
    dsp/               mattoni per i synth: oscillatori PolyBLEP, ADSR, filtro SVF, polifonia
    worklet/           processore AudioWorklet unico, coda delle note al campione, motori per tipo
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
| Trascina nel vuoto | selezione a riquadro; un clic toglie la selezione |
| Clic su una clip | la seleziona e basta (la riproduzione continua) |
| Parte bassa del righello | clic o trascina: sposta il cursore (l'unico punto che lo fa) |
| Fascia alta del righello | bordi del loop: sposta quell'estremo tenendo fermo l'altro · corpo: sposta il loop · fuori: disegna un loop nuovo · clic: accende/spegne |
| Doppio clic su una traccia MIDI vuota | nuova clip di una battuta |
| Spazio · Invio | play/stop · stop e torna all'inizio |
| Ctrl+Z / Ctrl+Y · Canc · Ctrl+D · Ctrl+E | annulla/ripeti · elimina · duplica · dividi al cursore |
| Ctrl+X · Ctrl+C · Ctrl+V | taglia · copia · incolla al cursore, sulle tracce di partenza (il cursore va alla fine: Ctrl+V di nuovo continua in fila) |
| Tasto destro | menu: su una clip (apri, taglia, copia, incolla, duplica, dividi, elimina), su una corsia (incolla qui, nuova clip MIDI), sull'intestazione di una traccia (rinomina, strumento, mute/solo, elimina, nuove tracce) |
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
| Trascina la forma d'onda | scorre la vista |
| Clic sul righello | porta lì il cursore della timeline |
| Tasto destro | menu: 1.1.1 qui, elimina marker, aggiungi marker qui, Auto-Warp, Segui tempo, quantizza, azzera, warp acceso/spento |
| Pannello | warp, modalità e opzioni, BPM della clip o del segmento, :2 ×2, 1.1.1 qui, Auto-Warp, Segui tempo, Quantizza, Azzera, transpose, detune, gain |

## Piano roll

Doppio clic su una clip MIDI (sulla timeline, doppio clic su una traccia MIDI vuota crea una clip).

| | |
|---|---|
| Doppio clic sullo spazio vuoto · su una nota | nuova nota (con l'ultima durata usata) · elimina |
| Trascina una nota | sposta nel tempo (sulla griglia) e in altezza; con Ctrl copia; con Alt senza griglia |
| Trascina il bordo di una nota | durata (dall'inizio o dalla fine) |
| Trascina nel vuoto · Maiusc+clic | selezione a riquadro · aggiunge o toglie dalla selezione |
| B | modo disegno: premi e trascina crea una nota, un clic su una nota la toglie |
| Corsia in basso | trascina una barra: velocity (le note selezionate la seguono) |
| Tastiera a sinistra | suona le note con lo strumento della traccia |
| ↑ ↓ (Maiusc: ottava) · ← → · Q · Ctrl+D · Ctrl+A · Canc | trasponi · sposta di un passo · quantizza · duplica · seleziona tutto · elimina |
| Clic nel vuoto · Ctrl+X / C / V | punto d'inserimento (linea bianca) · taglia, copia, incolla lì (poi il punto va alla fine delle note incollate) |
| Tasto destro | menu: su una nota (taglia, copia, incolla, duplica, quantizza, ottava, elimina), nel vuoto (incolla qui, seleziona tutto, modo disegno) |
| Rotella · Maiusc+rotella · Ctrl+rotella · Alt+rotella | scorri le altezze · scorri il tempo · zoom del tempo · altezza delle righe |

## Strumenti

Ogni traccia MIDI ha uno strumento: il pulsante accanto al nome della traccia (o "Strumento"
nel piano roll) apre le sue manopole. Trascina una manopola in verticale (Maiusc: fine), rotella
per piccoli passi, doppio clic per il valore predefinito. Ogni modifica si annulla e si sente
subito, anche mentre suona.

**Analog**: due oscillatori (Saw, Square, Triangle, Sine; il secondo intonabile), filtro
passa-basso/banda/alto risonante con inviluppo e key track, inviluppo del volume, LFO su
intonazione e cutoff, 16 voci. Preset: Init, Basso, Acid, Pad, Pluck, Lead.

Per aggiungere un synth:

1. la descrizione (`InstrumentType`: parametri raggruppati in sezioni e preset) in
   `src/instruments/<nome>/`, registrata in `registry.ts`;
2. il motore DSP (`InstrumentCore`: `noteOn`, `noteOff`, `setParams`, `render`), registrato con
   lo stesso nome in `worklet/cores.ts`. `VoicePool`, `Adsr`, `Svf` e gli oscillatori sono pronti.

Interfaccia, salvataggio, preset, annulla e messaggi verso l'audio vengono da soli. Il
processore AudioWorklet è uno solo: riceve le note con il tempo del contesto audio e
divide ogni blocco nel campione esatto di ogni nota.

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
  più un `ClipCodec` registrato e un editor in `clipEditors`; un nuovo tipo di traccia è una
  sottoclasse di `Track` più una voce in `defaultTrackTypes` e in `addTrack`; un nuovo strumento
  è una descrizione più un motore DSP (vedi sopra).
- **I file vecchi si aprono.** Il formato del progetto ha una versione; ogni cambiamento porta
  una migrazione (la 1 → 2 ha dato uno strumento alle tracce MIDI).
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
