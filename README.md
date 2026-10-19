# studiomio

DAW nel browser con warp in stile Ableton Live: arrangement (timeline) e session view con il
lancio delle clip, clip audio con warp, clip MIDI con piano roll, modulazioni delle clip,
strumenti (quattro synth e una drum machine) ed effetti in AudioWorklet, mixer con misuratori di livello.

Nasce dal motore DSP di [WarpMio](../warpmio), portato in TypeScript.

## Scarica

[![Scarica per Windows](https://img.shields.io/github/v/release/davvoz/studiomio?label=Scarica%20per%20Windows&style=for-the-badge&color=ff9d2e)](https://github.com/davvoz/studiomio/releases/latest)

1. Apri l'[ultima versione](https://github.com/davvoz/studiomio/releases/latest) e scarica
   `studiomio-setup-<versione>.exe` (sotto "Assets").
2. Avvialo: si installa da solo, senza domande, con le icone sul desktop e nel menu Start.
3. Alla prima installazione Windows può mostrare "Windows ha protetto il PC": clicca
   "Ulteriori informazioni" → "Esegui comunque" (l'installer non è firmato digitalmente).

Gli aggiornamenti arrivano da soli: quando esce una nuova versione, studiomio la scarica e propone
di riavviare. Serve Windows 10 o 11 a 64 bit; l'APC40 mkII e i Launchpad funzionano appena collegati.

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
| `npm run app` | l'app in Electron, come la vedranno gli utenti |
| `npm run dist` | installer Windows in `release/` (`studiomio-setup-<versione>.exe`) |

Per usare gli algoritmi WebAssembly nell'app: `VITE_DSP_WASM=1 npm run dev`.

Gli script in `scripts/` girano con i moduli dell'app (risolti da Vite):
`node scripts/run.mjs scripts/<nome>.ts <argomenti…>`. `build-acid-live.ts`,
`build-pazzi-live.ts`, `build-sacrificio-live.ts`, `build-fuori-live.ts`,
`build-sottosuolo-live.ts` e `build-prestabiliti-live.ts` costruiscono i live "Acido crudo",
"Siete pazzi", "Sacrificio", "Fuori dal corpo", "Sottosuolo" e "Prestabiliti" come cartelle di progetto (vedi sotto: I live). `render-project.ts`
calcola in Node il mix della timeline di una cartella di progetto (vedi sotto: Render senza
browser).

Requisiti: Node 22+, Rust (`rustup target add wasm32-unknown-unknown`) e `wasm-pack`.
Il pacchetto WebAssembly non è nel repository: dopo `npm install` lancia una volta
`npm run wasm` e `npm run wasm:test` (servono anche per i test e la build).

## App per Windows

La stessa app, installabile: Electron porta con sé il suo Chromium, quindi memoria condivisa,
MIDI (APC40, Launchpad) e cartelle dei progetti funzionano senza browser, senza server e senza rete.
`src/` non sa di girare in Electron: tutto sta in `electron/main.ts`, che serve `dist/` da un
protocollo interno (`app://studiomio`, con le intestazioni COOP/COEP), concede i permessi solo
all'app e controlla gli aggiornamenti. F12 apre gli strumenti per sviluppatori.

Per rilasciare una versione:

```sh
npm version minor          # 0.1.0 → 0.2.0: commit e tag v0.2.0 (patch / minor / major)
git push --follow-tags
```

Il tag avvia `.github/workflows/release.yml`: su Windows compila WebAssembly, lancia i test,
costruisce l'installer e lo pubblica nelle Releases del repository insieme a `latest.yml`. Le app
installate leggono `latest.yml` all'avvio, scaricano la nuova versione in background e propongono
di riavviare (altrimenti si installa alla chiusura). Senza rete l'app funziona come sempre.

L'installer non è firmato (vedi sopra: Scarica); gli aggiornamenti non mostrano l'avviso di
Windows. L'icona è `build/icon.png` (512×512).

## Struttura

```
src/
  core/                id tipizzati, eventi, tempo musicale (battiti, tempo, metro)
  model/               il progetto, immutabile
    project.ts         radice: tracce (e i loro gruppi), scene, sample, tempo, loop, master (volume ed effetti), quantizzazione del lancio
    launch.ts          i passi della quantizzazione del lancio (1/16 … 4 battute)
    effect-list.ts     operazioni su una catena di effetti, per tracce e master (funzioni pure)
    rack.ts            i rack: gruppi di dispositivi di seguito con 8 macro e le loro mappature (funzioni pure)
    track.ts           Track → AudioTrack, MidiTrack, GroupTrack (mixer, timeline, slot della session, strumento, gruppo)
    clip.ts            Clip → AudioClip (sample + warp), MidiClip (note); ogni clip ha le sue modulazioni
    envelope.ts        modulazioni delle clip: bersagli, scale, punti, valore nel tempo della clip
    note-edits.ts      operazioni del piano roll sulle note (funzioni pure)
    device.ts          dispositivi di una traccia: strumento e catena degli effetti (tipo, preset, parametri)
    arrangement.ts     clip posate sulla timeline (sovrapposizioni come in Live)
    warp-markers.ts    mappa di warp di una clip audio
  store/
    project-store.ts   progetto corrente, annulla/ripeti, modifiche continue unite
    edits.ts           una modifica per azione dell'utente (funzioni pure)
    clipboard.ts       appunti: copia e incolla di clip (timeline e slot) e di note
    session-edits.ts   modifiche della session: clip negli slot, scene
    clip-ref.ts        una clip sulla timeline o in uno slot: gli editor lavorano su entrambe
  persistence/
    project-codec.ts   progetto ⇄ JSON, con registri per tipi di clip e traccia
    project-folder.ts  cartella del progetto: progetto.json, backup, audio/
    directory.ts       interfaccia Directory (+ in memoria); fs-access-directory.ts per il disco
  engine/              riproduzione, sulle interfacce di audio-graph.ts (Web Audio o finto nei test)
    playback-engine.ts trasporto: play/stop/seek, aggiornamento a ogni versione del progetto
    scheduler.ts       programmazione in anticipo, loop della timeline a corse, orologio continuo
    session.ts         la session nel motore: per ogni traccia cosa suona e da quando (timeline, clip lanciata)
    modulation.ts      le modulazioni delle clip programmate in anticipo (AudioParam del canale, dispositivi)
    track-content.ts   i tratti che una traccia suona in una finestra, dalla timeline o dalla session
    segments.ts        clip posata → tratti continui di contenuto
    players/           un player per tipo di traccia (audio, MIDI), interfaccia degli strumenti, metronomo
    effect-chain.ts    catena degli effetti di un canale: crea, aggiorna e ricollega solo ciò che cambia
    worklet-devices.ts strumenti, effetti e misuratori nel browser: nodi AudioWorklet
    meters.ts          misuratori di livello (picco e RMS) di tracce e master
    clip-audio.ts      clip audio → buffer pronto (render di warp o sample originale)
    render-cache.ts    render di warp per contenuto, LRU con budget di memoria
    mixer-graph.ts     canali con volume, pan, mute/solo; master con i suoi effetti
    offline-mix.ts     export del mix con lo stesso motore (OfflineAudioContext)
    warp-job.ts        dalla clip audio al lavoro di warp per il DSP
  app/
    app.ts             monta l'app e implementa i comandi
    audio-system.ts    monta insieme worker, sample, cache, AudioContext e motore
    effect-spectrum.ts lo spettro prima e dopo un effetto (AnalyserNode)
    project-session.ts cartella del progetto: importa, apri, salva, salva con nome
  control/
    control-surfaces.ts i controller MIDI (Web MIDI): riconosce APC40 mkII e Launchpad, li collega e li scollega a caldo; il report per la diagnosi
    session-surface.ts ciò che i controller hanno in comune: riquadro, stato di slot e scene, dispositivi, fader, LED
    palette.ts         la tavolozza dei pad RGB (la stessa per APC40 mkII e Launchpad)
    mixer-scale.ts     da 0..127 a volume e pan, come in Live
    apc40/protocol.ts  il protocollo dell'APC40 mkII: note, CC, SysEx dell'Ableton mode
    apc40/apc40.ts     l'APC40 sulla session: lancio, riquadro rosso, mixer, dispositivi, trasporto, LED
    launchpad/protocol.ts i modelli di Launchpad: porte, griglia, SysEx della DAW mode, layout, fader
    launchpad/launchpad.ts il Launchpad sulla session: lancio, mappa dei blocchi, mixer, fader sulla griglia, LED
  ui/
    timeline/          arrangement: geometria, disegno su canvas, gesti, pianificazione
    track-headers.ts   intestazioni delle tracce (nome, mute/solo, volume, livello; rientro e ▸/▾ dei gruppi)
    track-groups.ts    i gruppi dall'interfaccia: Ctrl+G, Ctrl+Maiusc+G, voci dei menu delle tracce
    session/           la session view: griglia di slot e scene, mixer in fondo alle colonne
    master-strip.ts    la riga del master
    meters/            misuratori: scala dei dB, balistica, un ciclo di disegno per tutti
    transport-bar.ts   barra in alto
    keymap.ts          scorciatoie da tastiera (una riga per comando)
    context-menu.ts    menu contestuale: le voci sono dati (etichetta, scorciatoia, azione)
    clip-editor/       editor delle clip audio; clip-frame.ts è la cornice comune (righello, loop, bandierine)
    piano-roll/        editor delle note: tastiera, griglia, velocity, gesti, pannello
    envelopes/         l'editor delle modulazioni: menu dei bersagli e corsia con la curva (piano roll ed editor audio)
    device/            catena dei dispositivi: un pannello per dispositivo, controlli generati dai parametri;
                       rack-panel.ts il pannello di un rack (macro, Map, minimo e massimo delle mappature);
                       displays.ts registra i pannelli grafici (eq/: grafico con spettro e curva;
                       drums/: griglia dei pad; drive/: curva, spettro e forme;
                       wavetable/: le tabelle d'onda disegnate, con la posizione da trascinare;
                       prisma/: pagine, fonti da trascinare sulle manopole, editor di inviluppi e LFO, matrice)
    dom.ts             creazione degli elementi
    bottom-panel.ts    l'area in basso, una vista alla volta
    waveform.ts        picchi della forma d'onda a più risoluzioni
  devices/             strumenti ed effetti
    params.ts          descrizione dei parametri (da cui nascono controlli, default, validazione)
    device-type.ts     un tipo di dispositivo: sezioni di parametri e preset
    registry.ts        gli strumenti e gli effetti disponibili
    rack-params.ts     i parametri di un dispositivo della catena per chiave, e il valore che gli dà una macro
    rates.ts           le velocità a tempo delle modulazioni (8 battute … 1/32)
    instruments/analog/  il synth Analog: descrizione e preset (analog.ts), suono (analog-core.ts)
    instruments/neuro/   il synth Neuro dei bassi reese: descrizione e preset (neuro.ts), suono (neuro-core.ts)
    instruments/wavetable/  il synth Wavetable: descrizione e preset (wavetable.ts), tabelle d'onda (tables.ts), suono (wavetable-core.ts)
    instruments/prisma/  il synth Prisma (tipo Serum): descrizione, fonti e destinazioni (prisma.ts), preset (prisma-presets.ts),
                       curve e forme degli LFO (shapes.ts), inviluppo (curved-env.ts), filtro (prisma-filter.ts), suono (prisma-core.ts)
    instruments/drums/   la Drum Machine: pad, modelli e kit (drums.ts), suono (drums-core.ts)
    effects/delay/     il Delay: descrizione e preset (delay.ts), suono (delay-core.ts)
    effects/phaser/    il Phaser (anche flanger): descrizione e preset (phaser.ts), suono (phaser-core.ts)
    effects/eq/        l'EQ: descrizione (eq.ts), matematica dei filtri comune a suono e disegno (eq-math.ts), suono (eq-core.ts)
    effects/drive/     il Drive: descrizione e preset (drive.ts), curve e primitive (drive-math.ts), suono (drive-core.ts)
    effects/clipper/   il Clipper: descrizione e preset (clipper.ts), suono (clipper-core.ts)
    effects/stereo/    lo Stereo (larghezza e bassi mono): descrizione (stereo.ts), suono (stereo-core.ts)
    dsp/               mattoni: oscillatori PolyBLEP, ADSR, filtro SVF, rumore, polifonia, voce sola (mono-player.ts), sovracampionamento; interfacce dei motori
    worklet/           i processori AudioWorklet (strumenti, effetti, misuratori), coda delle note, bypass, motori per tipo;
                       mod-timeline.ts applica le modulazioni ai parametri
  dsp/                 motore audio: funzioni pure, nessuna dipendenza dal DOM
    stretch/           modalità di warp, una classe per algoritmo (TimeStretcher)
    analysis/          onset, transienti, tempo, beat tracking
    codec/             WAV e ZIP
    wasm/              ponte verso il crate Rust
  workers/             RPC tipizzato, worker pool, worker DSP, DspService
  demo/                loop e progetto demo; patterns.ts (parti scritte come su una drum
                       machine o una 303: ritmi, linee, chop, rulli, pompa, gate),
                       live-builder.ts (un live come dati → progetto) e i live acid-live.ts,
                       pazzi-live.ts, sacrificio-live.ts, fuori-live.ts, sottosuolo-live.ts
                       e prestabiliti-live.ts
scripts/               script in Node con i moduli dell'app (run.mjs li avvia; live-folder.ts
                       copia i suoni e salva la cartella di un live; headless-render.ts calcola
                       il mix senza browser, loudness.ts lo misura secondo BS.1770)
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

## Session view

**Tab** (o i pulsanti in alto **☰ Arr.** / **▦ Session**) passa dalla timeline alla session e
viceversa. Nella session ogni traccia è una colonna di slot, una riga per scena; a destra il
master con il lancio delle scene; in fondo a ogni colonna il mixer (pan, volume, livello,
mute/solo, FX), che il pulsante **Mixer** nasconde quando serve spazio.

| | |
|---|---|
| ▶ su una clip | la lancia al prossimo confine della quantizzazione ("Lancio": da nessuna a 4 battute; 1 battuta di partenza). A trasporto fermo parte subito, con il trasporto |
| ▶ su una scena | lancia tutta la riga; le tracce con lo slot vuoto si fermano |
| ■ in uno slot vuoto o sotto la colonna | ferma la traccia · **Ferma tutte** ferma tutte le clip |
| Clic su una clip | la sceglie e la apre nell'editor (piano roll o editor audio): le modifiche si sentono mentre suona |
| Doppio clic su uno slot MIDI vuoto | nuova clip di una battuta |
| Trascina una clip | in un altro slot (anche di un'altra traccia dello stesso tipo); con Ctrl la copia |
| Trascina file audio su uno slot | importa lì (sulla traccia, o su una nuova se non è audio) |
| Invio · Canc · Ctrl+D · frecce | lancia · elimina · duplica nello slot sotto · sposta la scelta |
| Ctrl+C · Ctrl+X · Ctrl+V | copia e incolla tra slot; una clip copiata dalla session si incolla anche nella timeline, al cursore (e viceversa) |
| Doppio clic sul nome di una scena o di una traccia | rinomina · tasto destro: duplica, inserisci, elimina; sulle scene anche il colore |

Come in Live, una traccia a cui si lancia una clip smette di seguire la sua timeline (che
nell'arrangement si vede spenta) finché non si preme **↩** (Torna all'arrangement), acceso
quando serve. Le clip della session girano su un orologio che non salta: con il loop della
timeline acceso o spostando il cursore restano in fase. Le clip della session non finiscono
nell'export, che è il mix della timeline.

### Akai APC40 mkII

Plug and play come in Live: si collega l'APC40 mkII e funziona, senza mappature. Serve Chrome
o Edge (Web MIDI con il SysEx): la prima volta si preme **🎛** in alto e si dà il permesso al
MIDI; da lì in poi, a ogni avvio e ogni volta che lo si collega, si attiva da solo (lo mette in
Ableton mode). Un altro programma che tiene aperto l'APC40 (Live) lo blocca: uno alla volta.

| Sull'APC40 | In studiomio |
|---|---|
| Griglia 8×5 | le clip del **riquadro rosso** della session: colore della clip, verde fisso = suona, verde che lampeggia = in coda (il lampeggio lo fa l'APC da sé, come con Live); un pad su uno slot vuoto ferma la traccia |
| Frecce · Shift+frecce · Bank | spostano il riquadro di 1 · di una pagina (8 tracce, 5 scene) · Bank acceso: sempre di una pagina |
| Shift + griglia | mappa dei blocchi 8×5 (bianco: il riquadro, verde: suona, ambra: ci sono clip); un pad porta lì il riquadro |
| Scene Launch · Clip Stop · Stop All Clips | lancia la riga · ferma la traccia (lampeggia se lo stop è in coda) · ferma tutte le clip |
| Track Select · Master | sceglie la traccia o il master (con i dispositivi aperti, mostra i suoi) |
| Activator · Solo | mute (acceso = la traccia suona) · solo |
| Fader · Master | volume come in Live (0 dB all'85% della corsa, +6 dB in cima, in fondo silenzio) |
| Manopole in alto | pan (Pan acceso) |
| Device Control (8 manopole) | i parametri del dispositivo scelto, evidenziato in blu nel pannello (su un rack: le sue 8 macro; il rack viene prima dei suoi dispositivi); Device ◂ ▸ cambia dispositivo, Bank ◂ ▸ passa ai parametri successivi (nella barra di stato: quali sono), Device On/Off accende e spegne l'effetto, Device Lock blocca le manopole su quel dispositivo |
| Clip/Device View · Detail View | passa dai dispositivi alla clip della traccia · mostra o nasconde l'area in basso |
| Play · Shift+Play · Metronome | play/stop · stop e torna all'inizio · metronomo |
| Tempo · Shift+Tempo · Tap Tempo | ±1 BPM · ±0,1 BPM · il tempo dai colpi |

Fader e manopole sono un solo passo di annullamento per ogni movimento. Un parametro mappato su
una macro non si muove dalla sua manopola: lo muove la macro. Non ci sono ancora
(il pulsante lo dice nella barra di stato): Record Arm e registrazione, mandate (Sends, User),
crossfader, cue e nudge.

### Novation Launchpad

Come l'APC40, plug and play come in Live, sui modelli che Live guida con i suoi script:
**Launchpad X**, **Mini MK3**, **Pro MK3** e **MK2** (i Launchpad più vecchi, a due colori, no).
Li si mette in DAW mode (il MK2 nel layout Session) e la griglia 8×8 suona un riquadro di 8
tracce × 8 scene. Uno alla volta: con APC40 e Launchpad collegati insieme vince l'APC40.

| Sul Launchpad | In studiomio |
|---|---|
| Griglia 8×8 | le clip del riquadro: colore della clip, verde che pulsa = suona, verde che lampeggia = in coda; un pad su uno slot vuoto ferma la traccia |
| Pulsanti a destra | lanciano le scene (del colore della scena; lampeggiano se qualcosa della riga è in coda) |
| Frecce | spostano il riquadro di 1 (Pro MK3 con Shift, e sulla mappa dei blocchi: di una pagina) |
| Session | X e Mini MK3: doppio clic = mappa dei blocchi (bianco: il riquadro, verde: suona, azzurro: ci sono clip; un pad ci porta il riquadro), un clic la chiude. Pro MK3 e MK2: la mappa finché lo si tiene. Se il controller mostra un suo layout (Note, Custom…), torna alla Session |
| X: Session (un clic) | il **mixer**: i pulsanti a destra scelgono Volume e Pan (fader sulla griglia, 0 dB all'85% come in Live), Stop, Mute, Solo (sull'ultima riga della griglia); di nuovo lo stesso pulsante per tornare ai clip |
| Mini MK3: Stop Solo Mute | l'ultimo pulsante a destra fa girare stop, solo e mute sull'ultima riga della griglia (le altre scene lanciano) |
| Pro MK3: riga sotto la griglia | sceglie la traccia; con Mute, Solo, Stop Clip fa quello |
| Pro MK3: Volume · Pan · Device | i fader sulla griglia: volume, pan, o gli 8 parametri del dispositivo scelto (i pulsanti a destra cambiano banco, ◂ ▸ cambiano dispositivo) |
| Pro MK3: Play · Shift+Play · Shift+Record Arm · Shift+Mute · Shift+Solo · Shift+Sends | play/stop · stop e torna all'inizio · annulla · ripeti · metronomo · tap tempo |
| MK2: Mixer | il mixer sulla griglia: righe di stop, mute, solo (e azzera volume e pan); a destra Volume e Pan (fader), Stop (tutto), Mute e Solo (li toglie a tutte) |

Non ci sono ancora (lo dice la barra di stato): i modi Note, Custom, Drums, Keys, User,
registrazione e Record Arm, mandate, Clear/Duplicate/Quantise/Fixed Length.

Il Launchpad ha più porte MIDI e i programmi usano quella "DAW" (su Windows: `MIDIIN2 (LPX MIDI)`
per X e Mini MK3, `MIDIIN3 (LPProMK3 MIDI)` per il Pro MK3). Se non risponde, dalla console (F12):
`studiomio.surfaces.ports()` elenca le porte, `studiomio.surfaces.launchpadPort = 1` prova
un'altra interfaccia (`undefined` torna alla scelta automatica), e
`copy(studiomio.surfaces.report())` copia un resoconto (porte, avvio, ultimi messaggi MIDI) da
mandare a chi sviluppa. Il supporto dei Launchpad è scritto sugli script di Live 11, senza
l'hardware sotto mano: va provato.

## Gruppi di tracce

Come i Group Track di Live: un gruppo raccoglie delle tracce (anche altri gruppi) e le loro
uscite si sommano nel suo canale, con i suoi effetti, il suo volume, pan, mute e solo, che poi
va nel master (o nel gruppo che lo contiene). Un gruppo non ha clip.

| | |
|---|---|
| Clic · Maiusc+clic · Ctrl+clic sull'intestazione (o sulla testa della colonna) | sceglie la traccia · tutte fino a lì · aggiunge o toglie dalla scelta |
| Ctrl+G (o tasto destro: "Raggruppa") | raggruppa le tracce scelte: il gruppo prende il posto della prima, le altre lo seguono |
| Ctrl+Maiusc+G (o tasto destro: "Separa il gruppo") | toglie il gruppo (quello scelto o quello della traccia scelta); le tracce restano |
| ▾ / ▸ | chiude o apre il gruppo: chiuso, le sue tracce non si vedono (timeline, session, controller) ma suonano |
| Tasto destro su una traccia · su un gruppo | "Nuova traccia … qui sotto" (nello stesso gruppo) · anche "nel gruppo" |
| × su un gruppo · "Elimina il gruppo e le sue tracce" | elimina il gruppo con tutto ciò che contiene (Ctrl+Z lo riporta) |
| File audio trascinati su un gruppo | vanno in una traccia nuova in fondo al gruppo |

Nella timeline la corsia del gruppo mostra in piccolo le clip delle sue tracce, una striscia per
traccia; le clip non si posano sul gruppo. Nella session lo slot di un gruppo ha ▶ se almeno una
sua traccia ha una clip in quella riga: lancia la riga delle sue tracce, come una scena ristretta
al gruppo (quelle senza clip lì si fermano); ■ sotto la colonna le ferma tutte. Solo e mute come
in Live: il solo di una traccia lascia passare il suo gruppo (e zittisce le altre), il solo del
gruppo vale per tutte le sue tracce, il mute del gruppo le zittisce. Aperto o chiuso si salva con
il progetto ed è un passo di annullamento.

## Rack e macro

Come l'Instrument Rack e l'Audio Effect Rack di Live, con una catena sola (niente catene parallele):

| | |
|---|---|
| Clic sul nome di un dispositivo · Maiusc+clic | lo sceglie · sceglie tutti quelli fino a lì |
| Ctrl+G (o tasto destro sull'intestazione) | raggruppa i dispositivi scelti in un rack (con lo strumento è un Instrument Rack) |
| Ctrl+Maiusc+G · ⊟ | separa il rack: i dispositivi restano, macro e mappature spariscono |
| ◂ ▸ di un dispositivo | dentro il rack lo sposta; dal bordo del rack ne esce, accanto a un rack ci entra |
| ◂ ▸ · + · × del rack | sposta il rack intero · aggiunge un effetto in fondo al rack · elimina il rack con i suoi effetti |
| Map, poi clic su una macro, poi clic su un parametro | mappa il parametro sulla macro (una macro ne muove quanti si vuole, un parametro va su una macro sola) |
| Tasto destro su un parametro | "Mappa su Macro N" · "Togli dalla macro" |
| Map acceso, macro scelta | le sue mappature, con Min e Max (al contrario se Min > Max), "+ Parametro" per i pannelli grafici (EQ, Drive, Drum Machine) |
| Tasto destro su una macro | rinomina (senza nome prende quello del primo parametro mappato) |

Le macro vanno da 0 a 127; la prima mappatura di una macro le dà la posizione del parametro, così
non salta niente. Un parametro mappato si vede attenuato con il numero della macro e non si muove a
mano. Anche le modulazioni delle clip possono muovere una macro (il rack è nei bersagli).

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
| F (o **Fold** nel pannello) | solo le righe delle altezze che hanno note, come il Fold di Live; le righe seguono le note (spostandone una a un'altezza nuova compare la sua riga) |
| Corsia in basso | trascina una barra: velocity (le note selezionate la seguono) |
| Tastiera a sinistra | suona le note con lo strumento della traccia; con la Drum Machine ci sono i nomi dei pad al posto dei tasti |
| ↑ ↓ (Maiusc: ottava) · ← → · Q · Ctrl+D · Ctrl+A · Canc | trasponi · sposta di un passo · quantizza · duplica · seleziona tutto · elimina |
| Clic nel vuoto · Ctrl+X / C / V | punto d'inserimento (linea bianca) · taglia, copia, incolla lì (poi il punto va alla fine delle note incollate) |
| :2 · ×2 (nel pannello) | la clip intera (note, loop, modulazioni) dura la metà o il doppio, come :2 e ×2 delle clip audio; sulla timeline la clip si accorcia o si allunga dal suo inizio |
| Tasto destro | menu: su una nota (taglia, copia, incolla, duplica, quantizza, ottava, elimina), nel vuoto (incolla qui, seleziona tutto, modo disegno) |
| Rotella · Maiusc+rotella · Ctrl+rotella · Alt+rotella | scorri le altezze · scorri il tempo · zoom del tempo · altezza delle righe |
| Trascina il bordo arancione in alto | altezza dell'editor (anche quello audio; doppio clic: l'altezza iniziale); si ricorda |

La griglia, qui e nell'editor audio, è come quella di Live: linee più marcate per battute,
quarti e ottavi, e fasce alternate (ogni quarto, o ogni battuta da lontano); sul righello le
tacche sono più lunghe sui quarti.

## Modulazioni delle clip

Come gli inviluppi di clip di Live: ogni clip può muovere i parametri della sua traccia mentre
suona. Nel pannello della clip (piano roll o editor audio) il riquadro **Modulazioni** ha due
menu: il dispositivo (Mixer, lo strumento, gli effetti della traccia) e il parametro (volume,
pan, o un parametro numerico del dispositivo); il segno ● indica cosa è già modulato. Scelto il
parametro, sotto l'editor compare la corsia con la curva, allineata alle note o alla forma d'onda.

| Gesto | Azione |
| --- | --- |
| clic nel vuoto | un punto (sulla griglia; Alt: libero), già da trascinare |
| trascina un punto | battito e valore; Maiusc per la regolazione fine |
| doppio clic su un punto | lo elimina |
| ✎ (o tasto destro → "Disegno a scalini") | trascinando si dipingono scalini sulla griglia |
| × · tasto destro | cancella la modulazione del parametro · elimina il punto, cancella, disegno |
| rotella · Ctrl+rotella | scorre · zooma il tempo, come l'editor |

Le modulazioni sono **relative**: la manopola resta dov'è e la curva la sposta. Il volume va da 0
a 100 % del volume della traccia (metà curva ≈ −12 dB), il pan si somma al pan, un parametro si
sposta fino a una corsa intera della manopola in su o in giù, nella sua scala (il cutoff in
ottave). La curva è nel tempo della clip: gira con il suo loop e vale sulla timeline e nella
session; dove la clip non suona, o non ha quella curva, il parametro torna com'è. Volume e pan
sono automazioni degli AudioParam del canale (precise al campione); i parametri dei dispositivi
arrivano all'AudioWorklet come scalini e rampe con il loro istante e si applicano a ogni blocco
di 128 campioni. Anche l'export le suona.

## Strumenti ed effetti

Ogni traccia ha una catena di dispositivi, in fila come in Live: lo strumento (solo tracce MIDI)
e poi gli effetti, nell'ordine in cui il suono li attraversa, prima del volume della traccia.
Si apre con **FX** nell'intestazione della traccia (il numero dice quanti effetti ci sono), con
il pulsante dello strumento accanto al nome o con "Strumento" nel piano roll; dal tasto destro
sull'intestazione c'è anche "Aggiungi Delay". **+ Effetto** aggiunge un effetto in fondo; ogni
effetto ha ⏻ (acceso/spento, con una dissolvenza senza click), ◂ ▸ per spostarlo, × per
toglierlo e il suo menu dei preset. I controlli che non contano con le impostazioni attuali
si attenuano (es. i millisecondi con il delay a tempo). Trascina una manopola in verticale (Maiusc: fine), rotella
per piccoli passi, doppio clic per il valore predefinito. Ogni modifica si annulla e si sente
subito, anche mentre suona.

**Il master** è la riga in fondo all'arrangement: mute, volume ed **FX**, e a destra la sua
catena in breve (un clic la apre, il tasto destro ha "Aggiungi Delay"). Tutte le tracce si
sommano nel master, passano per i suoi effetti e poi per il suo volume; il metronomo entra
dopo gli effetti, così non li attraversa. Anche gli effetti del master finiscono nell'export.

**I livelli**: ogni traccia e il master hanno un misuratore stereo accanto all'intestazione,
dopo volume, pan e mute (mostra ciò che si sente): barra piena per l'RMS, più chiara per il
picco, un segno che resta fermo un attimo sul valore più alto, la spia rossa in cima quando
il segnale tocca 0 dB (un clic la spegne). Sul master c'è anche il picco massimo in numero.
I misuratori sono nell'AudioWorklet e scrivono in memoria condivisa (SharedArrayBuffer): non
perdono nessun picco e leggerli non costa nulla.

**Analog**: due oscillatori (Saw, Square, Triangle, Sine; il secondo intonabile), filtro
passa-basso/banda/alto risonante con inviluppo e key track, inviluppo del volume, LFO su
intonazione e cutoff, libero in Hz o a tempo (da 8 battute a 1/32). La voce: **Poli** (16 voci), **Mono** (una voce, ogni nota riparte, con
il glide dalla nota di prima) o **Legato** (una voce: le note che si sovrappongono scivolano
senza far ripartire gli inviluppi, lo slide della 303; le note staccate ripartono senza glide).
**Accento**: le note con velocity oltre 100 suonano più forti e aprono il filtro con un
inviluppo breve che si accumula sugli accenti vicini (il "wow" della 303). Preset: Init, Basso,
Acid e Acid quadra (Legato, glide e accento), Pad, Pluck, Lead. **Unison**: fino a 7 copie
per voce, scordate a ventaglio (Scordatura, in centesimi) e aperte nello stereo (Apertura),
con un filtro per canale: il "supersaw" per lead e accordi larghi; il livello resta quello di
una copia.

**Neuro**: il synth dei bassi reese e neuro, a una voce (Mono o Legato, con il glide). Due
oscillatori con l'unison (fino a 7 copie scordate e aperte: il reese è due o tre dente di sega
che battono lenti), la **FM** (modulazione di fase, con il suo rapporto) per il ringhio, il
**Fold** (wavefolder), il filtro (LP 24, LP 12, banda, passa-alto, notch) con la sua saturazione
davanti, il **Formante** che fa parlare il basso (tre formanti che passano per le vocali A E I O
U, spostabili di un'ottava), la **Distorsione** finale (tanh asimmetrico) e, a parte, il **Sub**:
un seno pulito e centrato, mentre il corpo passa da un crossover Linkwitz-Riley e resta sopra
il **Taglio** (il basso resta definito anche con il corpo largo e distorto). Il movimento: due
**LFO a tempo** (da 8 battute a 1/32, terzine e puntate; Sine, Triangle, Saw giù e su, Square,
S&H e S&H morbido; ripartenza a ogni nota o liberi, fase iniziale) e un **inviluppo di
modulazione**, ognuno verso due destinazioni a scelta (Cutoff, Risonanza, Vocale, Formante,
Fold, FM, Drive, Distorsione, Pitch, Scordatura, Volume) con una quantità positiva o negativa;
il **Trasporto** continuo, modulato da una clip, fa salite e picchiate di pitch. Tutto gira al
doppio della frequenza di campionamento (FM, fold e distorsione non si ripiegano in aliasing)
e torna giù con il filtro a mezza banda. Preset: Reese, Reese parlante, Neuro ringhio, Colpo
neuro, Sub pulito. Gli strumenti ricevono il tempo del progetto come gli effetti. Costo
misurato: 3.4 % di un core con tre copie e il formante, 4.2 % con sette.

**Wavetable**: il synth a tabelle d'onda, come Wavetable di Live. Due oscillatori leggono ognuno
una **tabella** (Base: seno → triangolo → dente di sega → quadra; PWM; Armoniche: un dente di sega
con il filtro che si apre; Sync; Fold; FM; Vocale: le vocali A E I O U; Organo: i tiranti che si
aprono; Digitale: un seno a scalini) e la **Posizione** sceglie dove leggerla, sfumando fra le 16
forme della tabella. Le tabelle sono generate nel codice e salvate in una versione per ottava con
sempre meno armoniche: ogni nota legge quella che non ha nulla sopra Nyquist, così anche le note
acute non fanno aliasing. Poi il **Sub** (un seno a una o due ottave sotto), l'**Unison** (fino a
7 copie scordate e aperte nello stereo; con **Posizioni** le copie leggono anche forme diverse
della tabella), il filtro (passa-basso/banda/alto con key track), l'inviluppo del volume e
l'**inviluppo di modulazione** verso due destinazioni, due **LFO** (a tempo o in Hz, che ripartono a
ogni nota o liberi) verso una destinazione ciascuno: Posizione A, B o tutte e due, Cutoff,
Risonanza, Pitch, Livello B, Volume. Posizioni, livello di B e volume modulati arrivano in rampa
campione per campione, senza graffi. La voce come Analog: Poli (16 voci), Mono o Legato con il
glide. Il pannello disegna le due tabelle una forma dietro l'altra, con quella che suona in
evidenza: trascinarle in verticale sposta la posizione (Maiusc per la regolazione fine). 28 preset:
Init; bassi (Basso sync, Basso reese, Basso FM growl, Basso 808, Basso acido, Wobble, Basso wobble
lento); lead (Lead FM, Lead sync urlante, Lead quadra, Supersaw); pad (Pad che respira, Coro
vocale, Pad ripiegato, Atmosfera digitale, Archi); tastiere, campane e pluck (Pluck digitale,
Pluck armonico, Campane FM, Arpa di vetro, Keys digitali, Gocce S&H); ottoni e organi (Ottoni,
Organo, Organo rock); ritmici ed effetti (Gate trance, Salita). I volumi sono pareggiati. Costo
misurato: 6 % di un core per quattro note a sette copie con due oscillatori, 15 % per sedici note
di Supersaw.

**Drum Machine**: 16 pad sulle note da C1 (36) a D#2 (51), come il Drum Rack di Live, con il
kit di partenza sulla mappa General MIDI (36 cassa, 38 rullante, 42 hi-hat chiuso, 46 aperto…),
così le parti di batteria scritte altrove suonano giuste. Ogni pad ha un suono sintetizzato
(Cassa, Cassa 808, Rullante, Clap, Rimshot, Hi-hat chiuso e aperto, Piatto, Tom, Campanaccio,
Shaker) o un **Sample**; e i suoi controlli: intonazione, decay, tono, snap (il significato di
tono e snap dipende dal suono ed è scritto accanto al menu), livello, pan e gruppo di choke (un
pad ferma gli altri del suo gruppo: l'hi-hat chiuso ferma l'aperto). Un colpo nuovo sullo
stesso pad fa sfumare quello prima in 4 ms, senza click; la durata delle note non conta.

I pad **Sample** suonano un file audio del progetto: un file trascinato da Esplora risorse su un
pad lo carica lì (più file: sui pad dopo), oppure "Carica…" o il menu dei sample del progetto
accanto al suono. Il file si copia nella cartella del progetto come quelli delle clip audio e il
pad prende il suo nome. Intonazione in semitoni (anche se il file ha un'altra frequenza di
campionamento), Decay che accorcia il sample restando pieno fino quasi alla fine, Tono come un
filtro da DJ (a sinistra passa-basso, a destra passa-alto, a metà aperto), Snap come
saturazione. **Inizio** sceglie da dove parte nel file (al centesimo di percento: con più pad
sullo stesso loop lo si affetta, come lo slice mode di Live) e **Verso** lo suona al contrario:
lo stesso pezzo (da Inizio per la durata del decay) dalla fine all'inizio, con l'inviluppo che
sale e finisce secco. Scambiando o copiando i pad il sample va con loro.

| Gesto | Azione |
| --- | --- |
| clic su un pad | lo sceglie (a destra i suoi controlli) e lo suona |
| trascina un pad su un altro · con Ctrl | li scambia · lo copia |
| tasto destro su un pad | il suono; "Carica un sample…", "Togli il sample"; "Riporta il pad com'era nel kit di partenza" |
| file audio trascinati su un pad | diventano i sample di quel pad e dei successivi |
| menu del suono | il pad prende il suono con i suoi valori di decay, tono e snap |

Mentre suona, i pad delle note che partono si accendono. Nel piano roll la tastiera mostra i
nomi dei pad e le righe si adattano per farli stare tutti. Preset: Init, 808, Secco.

**Drive**: saturazione e distorsione, da un calore leggero a un fuzz rotto, fatto per suonare
pieno. Sei forme: Morbida (tanh, armoniche dispari), Valvola (asimmetrica: armoniche pari,
calde), Nastro (ginocchio larghissimo), Dura, Fuzz (molto asimmetrica), Fold (ripiegamento).

| Controllo | |
| --- | --- |
| Drive · Bias | quanto si spinge nella curva (0–36 dB) · asimmetria: più armoniche pari |
| Colore | inclina lo spettro prima della curva e lo raddrizza dopo: a destra satura di più sugli alti, a sinistra sui medio-bassi; il timbro resta, cambia dove nasce la distorsione |
| Bassi puliti · Crossover | sotto il crossover (Linkwitz-Riley, bassi + alti = suono intero) i bassi restano puliti in questa misura: con tanto drive il basso resta pieno e definito |
| Tono · Auto gain · Uscita · Dry/Wet | passa-basso dopo la curva · alzando il drive il volume resta lì (cambia il colore, non il livello) · mix parallelo |
| Oversampling | 2×, 4× (predefinito), 8× |

Il pannello mostra la curva come si sente (con drive, bias, compensazione e mix) e lo spettro
prima (linea) e dopo (pieno): si vedono nascere le armoniche. Preset: Init, Calda, Nastro,
Basso 808, Batteria parallela, Presenza, Fuzz, Rotto.

Sotto il cofano, per non sporcare: tutto gira sovracampionato con filtri a mezza banda a fase
lineare (anche il dry e i bassi puliti, così i rami restano allineati e il mix parallelo non fa
filtri a pettine), e la curva usa l'antialiasing ADAA con la primitiva esatta di ogni forma
(in tabella, con interpolazione di Hermite). Misurato in un test: un clip duro su un seno a
4.9 kHz senza sovracampionamento ripiega armoniche udibili a −18 dB, con il Drive a −113 dB.
Costo misurato: circa il 2.8 % di un core per un'istanza stereo a 4× (in silenzio non calcola).
Il WASM non è servito: il tempo andava nelle funzioni trascendenti, tolte con le tabelle.

**Compressore**: soglia, rapporto e ginocchio morbido; attacco e rilascio (la riduzione si
leviga in dB, come nei compressori da studio); rilevatore a picco o RMS con un passa-alto
(così i bassi non lo fanno pompare); canali legati; guadagno manuale o automatico; dry/wet per
la compressione parallela. Preset: Colla, Punch batteria, Parallela, Basso, Voce, Schiaccia.

**Limiter**: per il master. Guadagno, Tetto, Rilascio e Anticipo: guarda avanti di qualche
millisecondo (minimo scorrevole del guadagno richiesto, poi una media mobile lunga quanto
l'anticipo), quindi il guadagno è già sceso quando arriva il picco e l'attacco non si deforma.
Con **Tra i campioni** misura i picchi su una copia sovracampionata 4× (true peak): verificato
in un test, un seno a un quarto della frequenza di campionamento con i campioni a −3 dB e il
picco vero a 0 dB resta sotto il tetto. Preset: Master, Forte, Trasparente.

**Riverbero**: rete di 8 linee di ritardo con matrice di Hadamard (FDN), diffusione con allpass,
smorzamento degli alti nella retroazione, due linee appena modulate contro il suono metallico.
Dimensione e Decadimento separati (il decadimento è esatto: −60 dB nel tempo scelto, misurato
in un test), Pre-delay, Diffusione, Smorzamento, Low cut sulla coda, Larghezza, Dry/Wet a
potenza costante. Preset: Stanza, Sala, Piatto, Lancio voce, Coda infinita.

**Multibanda**: compressione su tre bande (crossover Linkwitz-Riley) verso il basso e verso
l'alto, come l'OTT: i picchi scendono, i dettagli piani salgono, il suono si fa denso e vicino.
Profondità, Tempo (attacco e rilascio insieme), quanto verso l'alto e verso il basso, Ingresso,
i due tagli, il guadagno di ogni banda, Uscita e Dry/Wet. A riposo è piatta (le bande risommate
sono un allpass, verificato in un test su tutta la banda); sotto −70 dB non alza nulla.
Preset: OTT, Denso, Lead aggressivo, Batteria, Master leggero.

Costo misurato per un'istanza stereo: compressore 0.2 %, limiter 0.6 %, riverbero 0.6 %,
multibanda 1 % di un core.

**Phaser**: il movimento che gira. Da **Phaser** è una fila di allpass (2–12 stadi) attorno al
Centro, risommata al suono: le buche nello spettro salgono e scendono; da **Flanger** è un
ritardo cortissimo che oscilla (il "jet"). Velocità a tempo o in Hz, Profondità, Stereo (il
canale destro sfasato fino a 180°), Feedback anche negativo (passa da una tanh: non esplode),
Dry/Wet. Il phaser lascia passare il sub com'è (in basso gli allpass non spostano la fase),
il flanger no: sui bassi va il phaser. Preset: Phaser lento, Jet, Reese che gira, Hat metallici,
Gola. Costo: 0.5 % di un core.

**Clipper**: taglia i picchi sopra il Tetto senza tempi (né attacco né rilascio): la forma
d'onda si appiattisce solo dove supera. Sulla cassa toglie i picchi dell'attacco e lascia il
corpo; prima del Limiter del master si prende i picchi più brevi, così il limiter lavora meno e il
mix suona forte senza pompare. Ingresso, Tetto, Ginocchio (0 = taglio netto, 100 = una tanh
intera: la curva resta dritta fino al ginocchio e poi entra nel tetto con pendenza 1, senza
spigoli), Uscita. Gira sovracampionato (2×, 4× predefinito, 8×) con gli stessi filtri a mezza
banda del Drive: misurato in un test, un seno a 7 kHz tagliato di 12 dB lascia l'alias a 13 kHz
a −54 dB, contro −17 dB senza sovracampionamento. Preset: Cassa, Batteria, Master, Saturazione.

**Stereo**: l'immagine, come l'Utility di Live. Larghezza (0 % mono … 200 %) e **Bassi mono**:
sotto la frequenza scelta il lato (la differenza tra i canali) passa da un passa-alto
Linkwitz-Riley a 24 dB e sparisce, il mezzo non passa da nessun filtro (un suono mono esce
identico, verificato in un test). Il sub e la cassa restano al centro, come vogliono gli impianti
dei club e il vinile. Preset: Master, Basso mono, Largo, Mono.

**Delay**: eco a tempo (da 1/32 a 1/1, con puntate e terzine, segue il BPM del progetto) o in
millisecondi, stereo o ping-pong, feedback con low cut e high cut sulle ripetizioni, dry/wet.
Preset: Init, Ping-pong 1/8., Slapback, Eco lungo, Dub.

**EQ**: equalizzatore parametrico a 8 bande, come EQ Eight. Ogni banda è Low cut, Low shelf,
Bell, Notch, High shelf o High cut (i tagli a 12, 24 o 48 dB/ottava), con frequenza, guadagno
e Q. Il grafico mostra la curva e, mentre suona, lo spettro: linea tenue prima dell'EQ, pieno
dopo (inclinato di 4.5 dB/ottava, come negli analizzatori delle DAW). Sul grafico:

| Gesto | Azione |
| --- | --- |
| trascina un punto | frequenza (orizzontale) e guadagno (verticale); Maiusc per la regolazione fine |
| rotella su un punto | Q |
| doppio clic su un punto | accende o spegne la banda |
| doppio clic sul vuoto | accende lì la prima banda spenta |
| tasto destro su un punto | tipo, pendenza, accendi/spegni, riporta com'era |

Sotto il grafico, i pulsanti 1–8 scelgono la banda e le manopole la regolano; "Uscita" è il
guadagno finale. La curva disegnata è esattamente ciò che si sente: suono e disegno usano
la stessa matematica (filtri TPT, equivalenti alla trasformata bilineare dei prototipi
analogici), e un test lo verifica confrontando la risposta all'impulso con la curva.
Preset: Init, Pulizia bassi, Voce, Basso presente, Telefono, Aria.

Per aggiungere un dispositivo (synth o effetto) servono due parti:

1. la descrizione (`DeviceType`: parametri raggruppati in sezioni e preset) in
   `src/devices/instruments/<nome>/` o `src/devices/effects/<nome>/`, registrata in `registry.ts`;
2. il motore DSP, registrato con lo stesso nome in `worklet/cores.ts`: per uno strumento un
   `InstrumentCore` (`noteOn`, `noteOff`, `setParams`, `render`; `VoicePool`, `Adsr`, `Svf` e gli
   oscillatori sono pronti), per un effetto un `EffectCore` (`setParams`, `setTempo`, `process`).

Interfaccia, salvataggio, preset, annulla, bypass e messaggi verso l'audio vengono da soli
(con più di sei sezioni le schede vanno su due righe che scorrono con la catena).
Un dispositivo che vuole un'interfaccia sua (come l'EQ o la Drum Machine) la registra in
`ui/device/displays.ts`; uno strumento che dà un nome alle note (`noteNames`) li fa vedere nel
piano roll. I
processori AudioWorklet sono due, uno per gli strumenti (riceve le note con il tempo del
contesto e divide ogni blocco nel campione esatto di ogni nota) e uno per gli effetti.

## I live

Sei live montati per la session con i sample della libreria dell'utente. Ogni live è descritto
come dati in `src/demo` (tracce, kit, suoni di Analog e Neuro, effetti, scene, ordine della
registrazione; nei kit un pad è un sample o un suono sintetizzato della Drum Machine) e montato da `live-builder.ts`; lo script copia i file (elencati nello script)
nella cartella del progetto:

```sh
node scripts/run.mjs scripts/build-acid-live.ts "C:/Users/<utente>/Music" "C:/…/Acido crudo"
node scripts/run.mjs scripts/build-pazzi-live.ts "C:/Users/<utente>/Music" "C:/…/Siete pazzi"
node scripts/run.mjs scripts/build-sacrificio-live.ts "C:/Users/<utente>/Music" "C:/…/Sacrificio"
node scripts/run.mjs scripts/build-fuori-live.ts "C:/Users/<utente>/Music" "C:/…/Fuori dal corpo"
node scripts/run.mjs scripts/build-sottosuolo-live.ts "C:/Users/<utente>/Music" "C:/…/Sottosuolo"
node scripts/run.mjs scripts/build-prestabiliti-live.ts "C:/Users/<utente>/Music" "C:/…/Prestabiliti"
```

poi **Apri** sulla cartella creata. In tutti la timeline tiene una "registrazione" del live
(le scene una dopo l'altra), utile anche per l'export.

### Acido crudo

Hard acid a 150 BPM in La. Otto tracce: Cassa, Clap, Piatti, Percussioni ed FX sono Drum
Machine con pad Sample (casse distorte intonate in La, clap, rullanti e rullo, hi-hat, ride,
percussioni metalliche, crash, sirena, riser e discese); Rumble è un seno di Analog che rotola
sui sedicesimi in levare, saturato dal Drive; Acido e Acido 2 sono due Analog in Legato con
slide e accenti (dente di sega e quadra), distorti (Dura, Fuzz), con eco a tempo. Dieci scene:
Intro, Cassa e rumble, Entra l'acido, Acido pieno, Break (rullo che sale anche d'intonazione e
riser che arriva sul drop), Drop, Acido 2, Martello (casse doppie, Drive dell'acido che sale a
scalini), Break 2, Outro. Le modulazioni delle clip aprono e chiudono i filtri, alzano l'eco e
sfumano l'uscita; sul master un Drive a nastro leggero incolla. Registrazione: 160 battute,
circa 4 minuti.

### Siete pazzi

Drum & bass a 175 BPM in Sol# minore, con l'amen affettato e glitchato, stacchi di voce, riser e
tagli. Dieci tracce: **Amen** (un amen di 4 battute in 16 fette da un ottavo, in choke: in fila
ricompongono il loop, rimontate fanno i chop), **Glitch** (colpi dell'amen al contrario e
intonati, la versione "decimated" e quella glitchata, per rulli a trentaduesimi e swell),
**Cassa** e **Rullante** (due tempi), **Piatti**, **Sub** (un seno pulito) e **Reese** (due denti
di sega scordati, piegati dal Drive, compressi e allargati con un'eco Haas), **Pad**, **Voci**
(la frase cantata, le sue sillabe sui pad dove cadono gli attacchi, la frase al contrario, la
seconda frase, le frasi parlate degli stacchi) ed **FX** (riser di esattamente 8 battute a 175,
discese, crash, impatti). La pompa del sidechain su reese, sub e pad è fatta con le modulazioni
di volume sulle casse e sui rullanti; gli stutter con modulazioni di volume a scatti. Undici
scene: Intro, Salita, Stacco ("siete pazzi" da solo), Drop, Drop B, Glitch, Pausa, Stacco 2,
Drop 2, Drop 2B, Fine. Master: EQ (taglio a 25 Hz), Compressore "Colla", Limiter con i picchi
tra i campioni. Misurato sul render (BS.1770): drop tra −8.3 e −8.7 LUFS, −9.7 LUFS integrati,
true peak −0.42 dBTP; nessuna traccia oltre 0 dB. Registrazione: 130 battute, circa 3 minuti.

### Sacrificio

Techno dura e scura a 150 BPM in La frigio: intro, drop, bridge, drop modificato, outro. La
**Cassa** è una cassa industriale distorta portata in La, tagliata da un limiter veloce come un
clipper (picchi giù, corpo su). Il **Rumble** è fatto come nella techno di oggi: la stessa cassa
in un riverbero tutto bagnato, poi distorta, chiusa da un passa-basso e schiacciata dalla pompa
a ogni colpo. Il gancio è un **Lead** supersaw (unison a 7) in La frigio sulla progressione La
minore – Si bemolle – Sol minore – La minore, spinto dalla Multibanda; nel drop modificato
arrivano gli **Stab** supersaw in levare e il gancio sale d'ottava. **Cori**: il bordone "atmos"
in La minore, il coro alzato in La con il Si bemolle sopra, il mostro nel vuoto. **Voci**:
"kill", "sacrifice", "ho visto qualcosa dentro di lei", sussurri, "open fire" prima del drop.
Master: EQ, Multibanda leggera, Compressore "Colla", Limiter. Misurato sul render: drop a
−8.5/−8.3 LUFS (intro −10.6), −9.0 LUFS integrati, true peak −0.46 dBTP, PLR circa 8 dB;
nessuna traccia oltre 0 dB. Registrazione: 112 battute, 3 minuti.

### Fuori dal corpo

Techno da rave buio a 140 BPM in Sol frigio, senza melodie: lo portano il groove e i bassi che
si muovono, come la neuro di Noisia in quattro quarti. Intro, groove, salita, drop, vuoto (il
break), salita, secondo drop, outro. La **Cassa** è un layer: il corpo è la cassa sintetica in
Sol (scende e decade in fretta, lascia spazio al basso), l'attacco è quello distorto di un
campione; un limiter veloce la taglia come un clipper. **Rullante** e clap sul due e sul
quattro con i fantasmi in levare, **Piatti** a sedicesimi in un flanger lento, **Percussioni**
sincopate su due battute con l'eco: tutto con lo swing. Il **Reese** è Neuro (tre dente di sega
scordati, formante, fold, distorsione, sub pulito): un riff a domanda e risposta in cui ogni
nota "parla" (l'inviluppo apre il filtro e sposta la vocale, un LFO in quarti la fa ondeggiare)
e lascia buchi per il **Neuro**: fette dei loop reese della libreria, tutte in Sol, che si
tagliano a vicenda come gli edit di Noisia. Nel secondo drop il **Ringhio** (FM, un LFO in
terzine contro i quarti della cassa, il tritono). Il **Vuoto** è il bordone che dissocia: un
cluster Sol–Re–La bemolle che ondeggia d'intonazione, nel phaser e in una coda di 12 secondi;
nel break il reese respira da solo su note lunghe legate e finisce con una picchiata di
un'ottava. **Atmosfere**, **Voci** (frasi spezzate e un robot abbassato di una quinta) e **FX**.
La pompa e il movimento lento dei bassi (vocale, cutoff, fold, trasporto) sono modulazioni
delle clip. Misurato sul render: drop a −8.9/−9.2 LUFS, salita −9.0, intro −10.3, break
−12.6, −9.6 LUFS integrati, true peak −0.49 dBTP, PLR circa 8.5 dB; nessuna traccia oltre 0 dB.
Registrazione: 144 battute, 4 minuti e 8 secondi.

### Sottosuolo

Techno underground scura e ipnotica a 133 BPM in Sol# frigio, costruita come la farebbe chi
suona nei magazzini: il pezzo lo portano il groove della cassa e del basso, non una melodia.
Tredici tracce. La **Cassa** ha due strati: il corpo pulito di una cassa già in Sol#1 (52 Hz,
nessuna trasposizione che sporchi il colpo; scelta guardando forma d'onda e spettrogramma di
tutte le casse della libreria: molte sono troncate a 343 ms senza sfumatura) e la grana di una
cassa industriale tenuta solo sopra i 230 Hz; l'EQ toglie 6 dB al seno a 52 Hz e ne dà 4 al colpo
a 90 Hz, il Clipper le toglie i picchi, lo Stereo la tiene mono. Il **Rumble** è la cassa distorta
in un riverbero tutto bagnato e mono, saturata e chiusa sotto i 190 Hz, con la pompa disegnata:
zero sul colpo, pieno sul levare dell'ottavo, poi respira prima del colpo dopo. Il **Basso** è
Neuro senza sub, sedicesimi che non cadono mai sul battere, con un clipper morbido che toglie la
punta del primo mezzo periodo della sega. La **Sequenza** (Analog a una voce, sega con l'ottava
sotto) gira a passi di tre sedicesimi contro il quattro quarti, nel delay puntato; nel secondo
drop sale d'ottava. **Stab** (Sol# minore con la nona bemolle, nella cattedrale), **Bordone**,
**Piatti** (swing leggero), **Ride**, **Clap** (con il rullante sotto e i fantasmi),
**Percussioni** (tom intonati in Sol#), **Atmosfere** (un bordone campionato in Sol#, il coro della
pausa), **Voci** (sussurri, "darkness" e lo stesso giù di una quinta) ed **FX**. I suoni tonali
della libreria sono stati scelti analizzandone il croma: restano solo quelli compatibili con Sol#
frigio. Dieci scene: Intro e Groove (32 battute per chi mixa), Tensione (con due battute senza
cassa prima del drop), Drop, Pausa, Salita, Drop 2, Dopo, Outro e Fine (sola batteria). Master:
EQ (−2.5 dB a 50 Hz, −4 dB sopra i 10 kHz), compressore "Colla", Clipper, bassi mono sotto i
110 Hz, Limiter con i picchi tra i campioni.

Il mix è stato bilanciato misurando, come in mastering: render senza browser, stem per traccia,
loudness per sezione, spettro a terzi d'ottava confrontato con un bersaglio (la media di un
profilo da techno da club e delle tracce dark techno della libreria): da 100 Hz a 10 kHz sta
entro ±1.5 dB. Misurato sul render (BS.1770, verificato anche con ffmpeg): −8.4 LUFS integrati,
drop a −7.9/−7.8 LUFS (short-term massima −7.4), pausa −10.2, true peak −0.79 dBTP, PLR 7.6 dB,
crest dei drop 8.6 dB; bassi in fase (correlazione 1.00 sotto i 120 Hz). Registrazione: 184
battute, 5 minuti e 32 secondi. Nella cartella del progetto c'è anche il master renderizzato.

### Prestabiliti

Hard techno a 146 BPM in Fa frigio, costruita sullo sketch "brehho23" e pensata per essere
suonata dalla session con l'APC40: otto tracce (una pagina della griglia) e dieci scene (due
pagine). Il tempo è quello della voce: il monologo dello sketch ("0 Lead Vocals", parlato in
italiano) è a 146 BPM, così le sue frasi affettate sui pad restano a tempo senza warp. La
tonalità viene dai suoni dello sketch: il Robotoid è un Fa1 tenuto, gli One_Shot 23 e 26 sono
in Fa, il motivo del basso (Do–Reb–Fa#: tonica, seconda bemolle, tritono) diventa Fa–Solb–Si.
La **Cassa** è "ancora" dello sketch (il corpo è un Fa#1 a 45 Hz, portato giù di un semitono)
con la grana di una cassa industriale sopra i 230 Hz; il **Rumble** è la stessa cassa nel
riverbero tutto bagnato, saturata, chiusa sotto i 190 Hz e schiacciata dalla pompa. L'**Acido**
è la patch "Acid" dello sketch (Legato, glide 60, accento 70, con la sua Multibanda "Denso" e
il suo EQ) aperta in una 303: il motivo, la linea piena a sedicesimi, il martello del secondo
drop, le note lunghe del break. **Robot**: il Robotoid a pezzi in choke dove non c'è il rumble
(break, ritmo spezzato, outro) e gli One_Shot in Fa come stab in levare nei drop. **Clap** con
la "fruity snare" dello sketch sotto; **Piatti**; **Perc & FX** con il kit dello sketch (il rim
giù di nove semitoni e gli One_Shot 17, 18, 19 con i loro decay) e il suo groove, tom in Fa,
salite e impatti. La **Voce** ha tredici frasi (dieci del monologo, tre di "terrible cicle":
"never speak to me of such things again", "we are born men…", "you must break the chain…"),
trovate trascrivendo i file e misurandone i silenzi; tutte in choke, ognuna chiusa da un pad
muto nello stesso choke dove finisce (sono pezzi di un file solo: senza taglio continuerebbero
nella frase dopo); più "again", anche giù di una quarta. Scene: Intro, Groove, Monologo,
Tensione (due battute senza cassa, il rullo, "mi sento… prigioniera"), Drop, Prigioniera (il
break senza cassa), Libera ("libera di espandermi solo entro confini prestabiliti" e l'eco di
"prestabiliti" sulla salita), Drop 2, Catena (il ritmo spezzato dello sketch, cassa sull'uno e
sul levare del tre, che torna dritto con "you must break the chain"), Outro. Nella session le
clip della Voce si lanciano e si fermano a piacere sopra qualunque scena.

Misurato sul render (BS.1770, verificato con ffmpeg): −8.0 LUFS integrati, drop a −7.5/−7.6
LUFS, break −10.0, true peak −0.80 dBTP; nessuna traccia oltre 0 dB; bassi in fase
(correlazione 1.00 sotto i 120 Hz); da 40 Hz a 10 kHz lo spettro dei due drop sta entro 1.5 dB
da quello del primo drop di Sottosuolo (gli stab del Robot hanno un picco a 1.8–2.2 kHz: l'EQ
gli toglie 3 dB lì); la voce, mentre parla, sta in mediana circa 7 LU sotto il resto (sopra,
nel break). Registrazione: 184
battute, 5 minuti e 4 secondi. Nella cartella del progetto c'è anche il master renderizzato.

## Render senza browser

```sh
node scripts/run.mjs scripts/render-project.ts "C:/…/Sottosuolo" mix.wav [cartella degli stem]
```

calcola il mix della timeline con gli stessi motori DSP dell'AudioWorklet (strumenti, effetti,
modulazioni a blocchi di 128 campioni, canale del mixer con la modulazione del volume al quadrato
e il pan stereo di Web Audio), stampa la loudness (integrata, short-term massima, true peak) e
salva il WAV (32 bit float, o 24 bit se il nome finisce con `.24.wav`) e, a richiesta, una
traccia per stem. Gira a circa 3–5 volte il tempo reale. Verificato su "Fuori dal corpo": −9.63
LUFS e −0.47 dBTP, come la misura fatta sul render del browser.

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
  una migrazione (la 1 → 2 ha dato uno strumento alle tracce MIDI, la 2 → 3 una catena di
  effetti a tutte le tracce, la 3 → 4 una al master, la 4 → 5 la quantizzazione del lancio, la 5 → 6
  le modulazioni delle clip, un campo facoltativo).
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
