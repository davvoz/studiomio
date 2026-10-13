# studiomio

DAW nel browser con warp in stile Ableton Live: arrangement (timeline) e session view con il
lancio delle clip, clip audio con warp, clip MIDI con piano roll, modulazioni delle clip,
strumenti (un synth e una drum machine) ed effetti in AudioWorklet, mixer con misuratori di livello.

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

Gli script in `scripts/` girano con i moduli dell'app (risolti da Vite):
`node scripts/run.mjs scripts/<nome>.ts <argomenti…>`. Per ora c'è `build-acid-live.ts`, che
costruisce il live "Acido crudo" come cartella di progetto (vedi sotto, "Acido crudo").

Requisiti: Node 22+, Rust (`rustup target add wasm32-unknown-unknown`) e `wasm-pack`.
Il pacchetto WebAssembly non è nel repository: dopo `npm install` lancia una volta
`npm run wasm` e `npm run wasm:test` (servono anche per i test e la build).

## Struttura

```
src/
  core/                id tipizzati, eventi, tempo musicale (battiti, tempo, metro)
  model/               il progetto, immutabile
    project.ts         radice: tracce, scene, sample, tempo, loop, master (volume ed effetti), quantizzazione del lancio
    launch.ts          i passi della quantizzazione del lancio (1/16 … 4 battute)
    effect-list.ts     operazioni su una catena di effetti, per tracce e master (funzioni pure)
    track.ts           Track → AudioTrack, MidiTrack (mixer, timeline, slot della session, strumento)
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
  ui/
    timeline/          arrangement: geometria, disegno su canvas, gesti, pianificazione
    track-headers.ts   intestazioni delle tracce (nome, mute/solo, volume, livello)
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
                       displays.ts registra i pannelli grafici (eq/: grafico con spettro e curva;
                       drums/: griglia dei pad; drive/: curva, spettro e forme)
    dom.ts             creazione degli elementi
    bottom-panel.ts    l'area in basso, una vista alla volta
    waveform.ts        picchi della forma d'onda a più risoluzioni
  devices/             strumenti ed effetti
    params.ts          descrizione dei parametri (da cui nascono controlli, default, validazione)
    device-type.ts     un tipo di dispositivo: sezioni di parametri e preset
    registry.ts        gli strumenti e gli effetti disponibili
    instruments/analog/  il synth Analog: descrizione e preset (analog.ts), suono (analog-core.ts)
    instruments/drums/   la Drum Machine: pad, modelli e kit (drums.ts), suono (drums-core.ts)
    effects/delay/     il Delay: descrizione e preset (delay.ts), suono (delay-core.ts)
    effects/eq/        l'EQ: descrizione (eq.ts), matematica dei filtri comune a suono e disegno (eq-math.ts), suono (eq-core.ts)
    effects/drive/     il Drive: descrizione e preset (drive.ts), curve e primitive (drive-math.ts), suono (drive-core.ts)
    dsp/               mattoni: oscillatori PolyBLEP, ADSR, filtro SVF, rumore, polifonia, sovracampionamento; interfacce dei motori
    worklet/           i processori AudioWorklet (strumenti, effetti, misuratori), coda delle note, bypass, motori per tipo;
                       mod-timeline.ts applica le modulazioni ai parametri
  dsp/                 motore audio: funzioni pure, nessuna dipendenza dal DOM
    stretch/           modalità di warp, una classe per algoritmo (TimeStretcher)
    analysis/          onset, transienti, tempo, beat tracking
    codec/             WAV e ZIP
    wasm/              ponte verso il crate Rust
  workers/             RPC tipizzato, worker pool, worker DSP, DspService
  demo/                loop e progetto demo; patterns.ts (parti scritte come su una drum
                       machine o una 303) e acid-live.ts (il live "Acido crudo")
scripts/               script in Node con i moduli dell'app (run.mjs li avvia)
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
| Doppio clic sul nome di una scena o di una traccia | rinomina · tasto destro: duplica, inserisci, elimina |

Come in Live, una traccia a cui si lancia una clip smette di seguire la sua timeline (che
nell'arrangement si vede spenta) finché non si preme **↩** (Torna all'arrangement), acceso
quando serve. Le clip della session girano su un orologio che non salta: con il loop della
timeline acceso o spostando il cursore restano in fase. Le clip della session non finiscono
nell'export, che è il mix della timeline.

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
| Tastiera a sinistra | suona le note con lo strumento della traccia; con la Drum Machine ci sono i nomi dei pad al posto dei tasti |
| ↑ ↓ (Maiusc: ottava) · ← → · Q · Ctrl+D · Ctrl+A · Canc | trasponi · sposta di un passo · quantizza · duplica · seleziona tutto · elimina |
| Clic nel vuoto · Ctrl+X / C / V | punto d'inserimento (linea bianca) · taglia, copia, incolla lì (poi il punto va alla fine delle note incollate) |
| Tasto destro | menu: su una nota (taglia, copia, incolla, duplica, quantizza, ottava, elimina), nel vuoto (incolla qui, seleziona tutto, modo disegno) |
| Rotella · Maiusc+rotella · Ctrl+rotella · Alt+rotella | scorri le altezze · scorri il tempo · zoom del tempo · altezza delle righe |

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
intonazione e cutoff. La voce: **Poli** (16 voci), **Mono** (una voce, ogni nota riparte, con
il glide dalla nota di prima) o **Legato** (una voce: le note che si sovrappongono scivolano
senza far ripartire gli inviluppi, lo slide della 303; le note staccate ripartono senza glide).
**Accento**: le note con velocity oltre 100 suonano più forti e aprono il filtro con un
inviluppo breve che si accumula sugli accenti vicini (il "wow" della 303). Preset: Init, Basso,
Acid e Acid quadra (Legato, glide e accento), Pad, Pluck, Lead.

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
saturazione. Scambiando o copiando i pad il sample va con loro.

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

Interfaccia, salvataggio, preset, annulla, bypass e messaggi verso l'audio vengono da soli.
Un dispositivo che vuole un'interfaccia sua (come l'EQ o la Drum Machine) la registra in
`ui/device/displays.ts`; uno strumento che dà un nome alle note (`noteNames`) li fa vedere nel
piano roll. I
processori AudioWorklet sono due, uno per gli strumenti (riceve le note con il tempo del
contesto e divide ogni blocco nel campione esatto di ogni nota) e uno per gli effetti.

## Acido crudo

Un piccolo live hard acid a 150 BPM in La, montato per la session con i sample della libreria
dell'utente (in `src/demo/acid-live.ts`; i file sono elencati in `scripts/build-acid-live.ts`):

```sh
node scripts/run.mjs scripts/build-acid-live.ts "C:/Users/<utente>/Music" "C:/…/Acido crudo"
```

poi **Apri** sulla cartella creata. Otto tracce: Cassa, Clap, Piatti, Percussioni ed FX sono Drum
Machine con pad Sample (casse distorte intonate in La, clap, rullanti e rullo, hi-hat, ride,
percussioni metalliche, crash, sirena, riser e discese); Rumble è un seno di Analog che rotola
sui sedicesimi in levare, saturato dal Drive; Acido e Acido 2 sono due Analog in Legato con
slide e accenti (dente di sega e quadra), distorti (Dura, Fuzz), con eco a tempo. Dieci scene:
Intro, Cassa e rumble, Entra l'acido, Acido pieno, Break (rullo che sale anche d'intonazione e
riser che arriva sul drop), Drop, Acido 2, Martello (casse doppie, Drive dell'acido che sale a
scalini), Break 2, Outro. Le modulazioni delle clip aprono e chiudono i filtri, alzano l'eco e
sfumano l'uscita; sul master un Drive a nastro leggero incolla. La timeline ne tiene una
registrazione di 160 battute (circa 4 minuti), utile anche per l'export.

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
