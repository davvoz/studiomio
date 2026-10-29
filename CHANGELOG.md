# Changelog

What's new in each version of studiomio. New entries go under "Unreleased": `release.bat`
assigns them to the version it publishes and the build puts them in the GitHub release.
Sections: Added, Changed, Fixed.

## [Unreleased]

### Added
- A Drum Machine pad can now play a whole instrument, like a Drum Rack pad in Live: choose Kick,
  Snare or Hat e Piatti in the pad's sound menu (under Strumenti). The instrument's own panel
  opens next to the pad, with its presets, and works as it does on its own, samples included. A
  Hat e Piatti pad plays the piece you choose in its panel. The pad keeps its level, pan and
  choke group, so a closed and an open hi-hat on two pads choke each other. Dragging a pad onto
  another moves or copies its instrument with it. The instrument's knobs can be mapped to macros
  and get modulation curves like any other parameter.
- New Drum Machine kits built with the instruments, on the General MIDI notes (kick, side stick,
  snares, closed, pedal and open hats choking each other, second kick, crash, ride): Strumenti,
  Rave (rumble kick in E, snare with room, dry hats), Industriale (everything driven, ring-mod
  metals), 808 strumenti, Acustica and Lo-fi. They are also in the browser under Batterie.
- New presets: Acustica for the Kick, Industriale for the Snare, Lo-fi for Hat e Piatti.
- More Drum Machine kits made with the instruments: House, Dub techno, Breakbeat, Trap, Minimal,
  Electro.
- Drum racks among the factory Instrument Racks: Batteria rave, Batteria dub, Batteria rotta,
  Batteria industriale (Drum Machine kits with effects, whose macros reach into the instruments
  on the pads: the kick's tail and rumble, the snare's room, the hi-hats' decay and brightness),
  plus Cassa, Rullante and Hat in movimento to build a kick, a snare or moving hi-hats from eight
  knobs.
- Many new synth presets. Analog: Sub, Basso pulsante, Basso in levare and Acid frenetico (with
  the step sequencer on), Basso funk, Reese analogico, Stab rave, Accordo dub, Archi analogici,
  Ottoni analogici, Pad scuro, Lead quinta, Lead portamento, Organo analogico, Campanella,
  Zanzara, Pluck dub. Neuro: Reese che pompa, Wobble neuro, Talkbox, Basso frigio (sequencer),
  Ringhio lento, Industriale, Sub con morso, Reese scuro, Stab neuro, Glitch S&H, Caduta.
  Wavetable: Sirena rave, Stab digitale, Pad pulsar, Basso metallico, Lead additivo, Arpeggio a
  ottave, Vento spettrale, Basso growl a 1/16. Prisma: Sirena, Stab rave, Pad di vocali, Basso
  comb, Arpa metallica, Accordo dub. Kick: House, Trance, Dub techno, Hardgroove, Electro,
  Minimal, Breakbeat. Snare: Breakbeat, Trap, Dubstep, Spazzole, Elettro. Hat e Piatti: 909,
  Trap, Dub, Gong, Minimal.

## [0.3.39] - 2026-10-29

### Added
- Snare, a new instrument for building snares in layers, like the Kick. Colpo: the stick (a click,
  filtered noise or a sample). Pelle: the drum's tone, the two modes of the head tuned to the note
  with a small pitch drop (amount, time, overtone, shape), or a sample. Cordiera: the snare wires,
  filtered noise that starts after a short delay, with Grana to make it crunchy like an old
  sampler. Stanza: a short stereo room. The head is tuned to a note (A1 to A3, or following the
  notes played from D1), and soft hits are quieter and, with Vel → tono, darker, as on a real
  snare. Drop an audio file or a browser sample on the Colpo or Pelle card to use it. Presets:
  909, 808, Techno, Rimshot, Lo-fi, Stanza grande, Acustica.
- Hat e Piatti, a new instrument just for hi-hats and cymbals. Six pieces on the General MIDI
  notes, so drum parts written elsewhere play right: closed hat (F#1), pedal hat (G#1), open hat
  (A#1), crash (C#2), ride (D#2) and ride bell (F2). Closed and pedal choke the open hat, like a
  real hi-hat. Each piece is a synth (six detuned squares, noise and bell partials, filtered) or
  a sample, with tuning, decay, brightness, noise, bell, level and pan. For all pieces: three
  kinds of metal (808, Ruvido, Anello), variation from hit to hit, stereo width, drive. The panel
  shows the pieces as pads (click to play, drop an audio file or a browser sample on a pad to use
  it) and draws the hit of the chosen piece. Presets: 808, Techno secca, Industriale, Acustica.

## [0.3.38] - 2026-10-29

### Added
- Racks inside racks, as in Live. Ctrl+G on devices that are already in a rack makes a new rack
  inside it; Ctrl+G on a whole rack (click its name) wraps it in a new one. ◂ ▸ move a device or a
  rack out of the rack it's in, and into the rack next to it; right-click a rack's header to put
  it into the rack before or after. A macro can map any parameter inside its rack, however deep,
  and the macros of the racks inside it: with Map on, choose a macro and click a macro of an inner
  rack (or use its right-click menu). An inner macro moved by an outer one shows its badge and
  can't be turned by hand. Clip curves on an outer macro reach the inner racks' parameters.
  Nested racks are saved in projects and in saved racks (★).
- Kick, a new instrument for building kicks in layers. Snap: a click, filtered noise or a sample.
  Body: a sine dropping from above to the note (amount, time, curve, shape) or a kick sample, with
  attack, hold and decay. Tail: the sub that stays on the note. Rumble: the dark, driven techno
  tail that swells between hits. The kick is tuned to a note (C0 to C2, or following the notes
  played), and the output has soft, hard or folding saturation and a low cut. The panel draws the
  hit as it sounds, with the pitch drop; drop an audio file or a browser sample on the Snap or
  Body card to use it. Presets: Techno, 909, 808 lunga, Rumble, Industriale, Profonda, Secca.

## [0.3.37] - 2026-10-28

### Added
- Fades on audio clips in the arrangement, as in Live: hover a clip (or select it) and drag the
  small handles in its top corners to set the fade in and the fade out. The faded part is shaded
  with the volume line drawn over it. Fades don't follow the grid, and you hear them while
  dragging. They are saved with the project, a split keeps only the fades of the original edges,
  and Consolidate bakes them into the new file.
- Audio clips can modulate their own transpose, like Live's Transposition envelope: in the clip
  editor's Modulations choose Clip › Transpose and draw a curve (−48 to +48 semitones, added to
  the clip's transpose). The clip plays the nearest semitone, keeping its timing with every warp
  mode. Each semitone the curve reaches is rendered once, so the first play of a new value can
  take a moment.

## [0.3.36] - 2026-10-28

### Added
- Consolidate (Ctrl+J, in the Edit menu and in the clip menu), as in Live: on each track, the
  selected clips from the first to the last become a single clip that sounds the same. Clips in
  between are included, and loops become real notes or audio. With a time selection only that
  stretch is consolidated. MIDI clips merge their notes and clip modulations. Audio clips are
  rendered without the track's effects into a new file in the project folder, and their clip
  modulations stay on the new clip. A single undo restores the original clips.

## [0.3.35] - 2026-10-28

### Added
- Time selection in the arrangement, as in Live: a box that only covers part of a clip now
  selects just that stretch of time, and its edges follow the grid. Dragging the highlighted
  stretch splits the clip at its edges and moves only that part (Ctrl copies it). Delete removes
  only the stretch, and Ctrl+E splits the clip at both edges. A single undo puts the clip back
  together.

## [0.3.34] - 2026-10-28

### Added
- Rack macros have a new mode, Spring: a knob that goes back on its own. While you move it the
  mapped parameters follow, and when you let go it glides back to its rest position. Both are
  set under the knob: drag ↺ up or down for the rest position, and click the return time to
  choose it in note values (1/16 to 4 bars, following the tempo) or milliseconds (50 ms to
  5 s), or type your own (for example 300 ms, 3/16 or 2 bars). It works from everything that
  moves macros: the mouse, mapped computer keys, MIDI-mapped controllers, the APC40 mkII and the
  Launchpads. A key or a MIDI note pulls the spring all the way while held. Knobs and faders
  can't say when you let go, so the spring waits until they stop moving for a moment.
  Moving a spring doesn't fill the undo history, and the project and saved racks always store
  it at rest.

## [0.3.33] - 2026-10-27

### Added
- Scenes can be dragged to change their order: grab a scene in the session and drop it where
  the line shows. Its clips move with it, and the move can be undone.

## [0.3.32] - 2026-10-27

### Changed
- A scene is now highlighted as soon as one of its clips is playing: launching a clip from
  another scene highlights both scenes.
- On the APC40 mkII the playing scene is steady green, like the playing clips, instead of
  pulsing. Scenes that have clips but no colour are white instead of green, so they don't
  look like they are playing.

## [0.3.31] - 2026-10-27

### Added
- The scene that is playing is now highlighted, like in Live: a scene plays when all of its
  clips are playing. In the session its ▶ turns green with a green outline (and blinks while
  the scene waits to start). On the APC40 mkII and the Launchpads its launch button pulses
  green.

## [0.3.30] - 2026-10-27

### Added
- A Pitch Shifter effect: it moves the pitch up or down by up to two octaves (Semitones and
  Fine) without changing the tempo. Window sets the grain: short sounds metallic and robotic,
  long sounds smoother. Stereo detunes the left channel down and the right up, to double a
  voice; Feedback sends the shifted sound back in, so it spirals up or down; Glide makes
  changes of Semitones slide, for dives on a macro. Presets include octave down and up, a
  demon voice, doubling, a fifth, a spiral and a robot.

## [0.3.29] - 2026-10-26

### Added
- Tracks can be dragged to change their order: grab a track header in the arrangement (or a
  column head in the session) and drop it where the line shows. A group moves with its tracks.
  Dropping a track among the tracks of an open group puts it in that group, and dropping it
  below all the tracks takes it out. Buses can be dragged too, among the other buses.
- Buses can be collapsed in the session with ▾ on their head (or from their menu). A collapsed
  bus keeps playing but its column is narrow: its name runs down the column, and its mixer
  shows only mute and solo. Click ▸ or the column to open it again. Collapsed buses stay that
  way when the project is saved.
- Clicking the master opens its effect chain, like clicking a track does: its header in the
  arrangement (anywhere except its buttons and volume) and its head in the session.

### Changed
- The master row in the arrangement no longer lists its effects: with many effects the list
  ran off the right edge, and clicking the master now opens the whole chain. The row is empty,
  like a track lane, and a click on it opens the chain too.

## [0.3.28] - 2026-10-25

### Added
- The knobs of instruments and effects now follow the automation while it plays: when a clip
  curve or a master curve moves a parameter, its pointer and number show the value you hear (in
  red, with an arc from where the knob is set), then go back when the curve ends or playback
  stops. It works through rack macros too (the macro and the parameters it moves), and choices
  show the option the curve picks.
- The APC40 mkII follows the automation too: the LED rings of the 8 Device Control knobs show
  the value you hear while a curve plays (the Launchpad Pro MK3's device faders do the same).
  Turning a knob starts from that value, without jumps, and sets the parameter so you hear
  where the knob is.

### Fixed
- On the APC40 mkII the LED rings of the Device Control knobs could stay dark after choosing a
  track (only a knob whose value kept changing lit up) until you moved to another device and
  back. A moment after a device, bank or track is chosen, all 8 rings are now sent again.

## [0.3.27] - 2026-10-25

### Added
- The device view (instruments and effects) can be made taller by dragging its top edge, like
  the piano roll; the height is remembered and a double click brings back the starting one.
  Dragging it further down once it is at its smallest folds it: the view slides down until only
  its title bar is left (let go earlier and it comes back up). Drag the edge up again to bring
  it back.

### Fixed
- The timeline no longer goes black for a moment while the area below it is resized.

## [0.3.26] - 2026-10-24

### Fixed
- With Windows display scaling above 100% (125%, 150%…) the drawings of the devices grew wider
  at every redraw, without end: Prisma's wavetables, envelopes and LFOs stretched forever and
  the Sampler's waveform turned into a white box. They now keep their size at any scaling.

## [0.3.25] - 2026-10-24

### Added
- The master automation can now be drawn and seen: the "A" button in the master row (or
  right-click › "Mostra l'automazione") opens a row under it. On the left pick the effect (or
  rack) and the parameter (or macro), on the right draw the curve on the timeline, with its zoom
  and scrolling: click adds a point, drag moves it, double-click deletes it, ✎ paints steps on
  the grid, × clears the curve. The "A" button has a dot when the master has curves, and effects
  with a curve show a ● in the master row and in the menus.

### Fixed
- Modulation editor: deleting the effect whose curve is shown closes the lane instead of leaving
  it on a parameter that no longer exists.

## [0.3.24] - 2026-10-24

### Added
- Master automation on the timeline: curves in timeline beats on the master's effect parameters
  and on the macros of its racks (Macchina, Tornado…), like clip envelopes but for the whole mix.
  They move the knob from where it is, play live and in "Esporta il mix in WAV…", restart with
  each pass of the timeline loop, flip switch and button macros past halfway as if pressed, and
  go back to neutral when the transport stops. They're saved with the project.

## [0.3.23] - 2026-10-22

### Added
- MIDI mapping for any controller, like Live's MIDI Map: turn on MIDI in the control bar (Ctrl+M,
  or Opzioni › Mappa il MIDI), click a control, then move the knob or fader or hit the pad that
  will move it (Canc removes it, Esc turns MIDI off). It maps rack macros, instrument and effect
  parameters, and the mixer: track volume, pan, sends, mute and solo, master volume and mute.
  A CC sets the control to its position (volume follows Live's fader, 0 dB at about 85%; pan
  centres at 64; mute, solo, switches and buttons are on from 64 up). A note works like a KEY
  press: switches and menus step, knobs jump end to end, button macros stay on while the note is
  held, mute and solo flip, volume goes between 0 dB and −∞. Controls are told apart by channel
  and number, whichever port they come from. One control can move several targets. Mappings are
  saved with the project, and a fader move is a single undo step. The APC40 mkII and Launchpads
  keep their own mapping; the other MIDI inputs are opened only while MIDI is on or the project
  has mappings (on Windows an open port can't be used by other programs).

## [0.3.22] - 2026-10-22

### Added
- File › Raccogli e salva in ZIP…: puts the whole project in one file you can pass to another
  user. The ZIP holds the project and all the audio it uses (and only that: unused files and the
  backup stay out). If the project is already on disk it's saved first. A missing audio file
  stops it and names the file.
- File › Apri progetto da ZIP… (or drop the ZIP on the window) opens a project received this
  way, with no need to unzip it. It opens as an unsaved project: Salva asks for the folder to put
  it in. ZIPs made by hand also work (compressed by Windows Explorer, 7-Zip or the Finder, with or
  without the project folder inside). Unzipped, the ZIP is an ordinary project folder.

## [0.3.21] - 2026-10-22

### Fixed
- Browser, User presets: the Instrument Rack and Audio Effect Rack folders no longer get mixed up
  (they opened and highlighted together and both showed the same racks).

## [0.3.20] - 2026-10-22

### Added
- Analog and Neuro have a step sequencer, like a 303 that writes its own lines (new Sequencer
  section, off by default: existing projects sound as before). Turned on, the synth doesn't play
  the notes it receives: while a note is held it plays a pattern of steps locked to the bar,
  transposed to that note, so a clip only has to hold the root (or the chords of a progression).
  Pattern picks one of 128 patterns (a new one starts at the top of the loop, as on a 303);
  Densità adds notes without moving the others (eighth-note offbeats first, the gaps between the
  kicks), Altezza widens the scale in order (Scala: Frigio, Frigio e tritono, Minore, Ottave,
  Quinte), Accenti and Slide set how many of each, plus Passi (1–32), Velocità (1/8, 1/16,
  1/16T, 1/32), Ottava, Gate and Battere › "Lascia alla cassa" (no steps on the beat). Map
  Pattern and Densità to rack macros and the line changes while you turn them. A clip can switch
  the sequencer on with its own modulation.
- Factory racks from the "Rave illegale" live:
  - Levare (Instrument Rack): Neuro offbeat bass with Cutoff, Morso, Coda, Sub, Ringhio,
    Distorsione, Vocale and Rumble; its sequencer is set up (off) to leave the downbeat to the kick.
  - 303 (Instrument Rack): Analog in Legato with Cutoff, Risonanza, Env Mod, Decay, Accento,
    Glide, and Pattern and Follia for the step sequencer (turn it on in the Sequencer section).
  - Acido FX (Audio Effect Rack): Distorsione, Taglio (step gate), Phaser, Eco, Spazio and a
    Ripeti button.
  - Macchina (Audio Effect Rack): Ripeti 1/8, 1/16 and 1/32, Al contrario and Stop nastro
    buttons, then Sottrazione (high-pass), Muro (low-pass) and Lo-fi. All at 0, the sound passes
    unchanged.

## [0.3.19] - 2026-10-21

### Changed
- Sampler: every zone can now have its own pitch (Transpose, Detune, Key track, Env pitch),
  filter, all three envelopes and LFO, besides loop and Reverse. As before, a zone follows zone 1
  until you change one of these with the zone selected. The card titles say which zone you are
  editing. Only the mode, the voice (Poli/Mono/Legato with Glide: one voice serves every zone)
  and the output stay shared; they are in the new "Voce e uscita" card. Existing projects sound
  as before.
- Sampler: the Zone card no longer has Tune and Fine, which did the same as the zone's Transpose
  and Detune. Projects and saved racks convert them when they open, so every zone keeps its pitch.
  Projects saved from this version on can't be opened by older versions.

### Fixed
- Sampler: the Zone card shows the zone's Pan again, and the "Voce e uscita" card shows the
  Sampler's own Pan (before, the zone's Pan ended up there and the overall Pan was missing).

## [0.3.18] - 2026-10-21

### Added
- Five new factory Audio Effect Racks in Effetti audio › Audio Effect Rack. With every macro at
  0 the sound passes untouched:
  - Fade to Grey: a transition like Live's. Turn Fade and the sound narrows into a grey wash:
    the filters close in from both sides, echo and reverb grow, the stereo image shrinks and
    the level drops. Eco, Tempo eco, Coda, Scuro and Risonanza shape the wash.
  - Dub: a King Tubby send delay with Lancio (feedback that runs away on its own), Tempo, Scuro,
    a sweeping high-pass, Molla (spring-like reverb) and Nastro.
  - French Touch: the resonant filter-house sweep, with Pompa (quarter-note sidechain pump),
    Phaser, Sporco and Colla.
  - Cassetta: a worn tape with Wow, Nastro, Bit, Opaco, Stretto and a Stop button that brakes it.
  - Muro: a shoegaze wall of sound with Fuzz, Leva (vibrato arm), Risucchio (reverse swell), Eco,
    an endless reverb and Larghezza.
- Four new factory Instrument Racks in Strumenti › Instrument Rack:
  - Nuova onda: a new-wave polysynth (Analog) with ensemble chorus, ping-pong echo and hall.
  - Ossigeno: Oxygène-style string machine (Wavetable) through a slow phaser.
  - Hoover: the rave hoover (Wavetable) with Swoop, Glide, PWM, Larghezza and Ottava sotto.
  - Jump: 80s polysynth brass (Analog) with Morso, Gonfia (brass swell), Spessore and Colla.

### Fixed
- Sampler: the bottom row of controls was cut off at the bottom of the device panel. The panel
  now fits its height, and the envelope knobs sit beside the drawing, which is about twice as
  tall as before.

## [0.3.17] - 2026-10-21

### Added
- Sampler: each zone can have its own loop (mode, crossfade, release), Reverse and volume
  envelope, so a kit can have a short hi-hat and a long crash in one Sampler. A zone follows
  zone 1 until you change one of these controls with it selected; then it keeps its own. The
  "Come zona 1" button next to the zone menu shows which is which and links the zone back.
  Existing projects and presets sound as before.

### Changed
- Sampler: the envelope drawing is taller and zooms to the envelope, filling the width instead
  of squeezing short times into the left corner. The zoom holds still while you drag a handle.

### Fixed
- Browser › Batterie lists only the Drum Machine kits, not the Sampler presets.

## [0.3.16] - 2026-10-21

### Changed
- Devices in the chain use the whole height of the panel: their sections wrap onto as many rows
  as fit, in reading order, so an effect like Beat Repeat is about half as wide instead of one
  long row with empty space below. Big instruments (Analog, Neuro) read left to right and then
  down, instead of column by column.

## [0.3.15] - 2026-10-21

### Added
- Tornado, a factory Audio Effect Rack to play live like Turnado: eight effects in a row, one
  macro each (Stutter, Reverse, Gate, Lo-fi, Filtro, Flanger, Pan, Stop). With a macro at 0
  its effect is out and the sound passes untouched; turning it brings the effect in harder.
  Stop is a button: hold it to brake the tape, let go and it spins back up. Find it in Effetti
  audio › Audio Effect Rack; on the APC40 the 8 Device Control knobs play the macros.
- Three factory Instrument Racks in Strumenti › Instrument Rack, each an instrument preset with
  effects and 8 macros that move both:
  - Acido: Analog's Acid with the 303 knobs (Cutoff, Risonanza, Env Mod, Decay, Accent, Glide),
    plus Sporco (saturation) and Eco (ping-pong delay and plate).
  - Nebbia: Wavetable's Pad che respira with Apri, Morph, Respiro, Larghezza, Lentezza, a trance
    Gate, Eco and Spazio.
  - Ringhio: Neuro's Neuro ringhio bass with Cutoff, Ringhio, Vocale, a tempo-synced Wobble and
    its Velocità, Distorsione, Phaser and OTT, with the lows kept mono.

## [0.3.14] - 2026-10-21

### Added
- Computer keyboard mapping, like Live's Key Map: turn on KEY in the control bar (Ctrl+K, or
  Opzioni › Mappa la tastiera del computer), click a rack macro or a parameter of an instrument
  or effect, then press the key that will move it (Canc removes it, Esc turns KEY off). Mapped
  keys show on their controls. With KEY off, a key flips a switch macro, holds a button macro on
  while it stays down, jumps a knob macro or a parameter between its two ends and steps a menu
  to its next choice. One key can move several controls. The mappings are saved with the
  project and every press can be undone (except holding a button). Keys that are already
  shortcuts (Space, Tab, Enter, Canc, +, −, Esc, arrows) can't be mapped; a mapped key takes
  over the piano roll's Q, B and F.
- Beat Repeat: the Solo Repeat switch turns off the repeats in time, so the effect repeats only
  while Repeat is on; with Repeat off the sound passes untouched, as if the effect were off,
  even in Gate mode (which then lets the sound through like Inserisci). Map Repeat to a key or
  to a rack's button macro to play it live.
- Saved racks, to reuse them in every project: ★ in a rack's header (or right-click the header ›
  Salva il rack…) saves its devices, their settings and the 8 macros with their mappings under
  the name you type. They show up in the browser, like Live's rack presets: Instrument Racks in
  Strumenti › Instrument Rack, Audio Effect Racks in Effetti audio › Audio Effect Rack, both in
  Preset dell'utente. Double-click or drag one onto a track: an Instrument Rack replaces the
  instrument of a MIDI track (or goes on a new one), an Audio Effect Rack goes at the end of the
  chain, also on the Master. Right-click the header to update or delete the saved rack. In the
  desktop app every rack is a file in Documenti\studiomio\Rack, so it can be copied to another
  computer. Loaded samples and sidechains belong to the project and aren't saved with the rack.

## [0.3.13] - 2026-10-21

### Added
- Beat Repeat, a new effect like Live's Beat Repeat: in time with the song, every Interval
  (shifted by Offset sixteenths) and with a given Chance, it captures a slice as long as the
  Grid and repeats it for the length of the Gate, for stutters, rolls and fills. Variation
  makes the slices randomly shorter, the repeats can drop in pitch (Pitch, and Discesa every
  repeat), fade (Decadimento) and go through a band-pass filter, and they add to the sound
  (Mix), replace it while they play (Inserisci) or play alone (Gate). The Repeat switch repeats
  right away, from the next grid line, for as long as it stays on: map it to a controller
  button to play it live. With the transport stopped only Repeat repeats.
- Auto Filter, a new effect like Live's Auto Filter: a resonant low-pass, high-pass, band-pass
  or notch filter (12 or 24 dB, with drive) whose cutoff moves by itself. Its LFO (sine,
  triangle, saws, square and two random shapes) runs in time and is locked to the bar: a 1/4
  cycle always starts on the beat, even after a jump, on every loop lap and in the export, and
  the right channel can be offset for stereo movement. The envelope opens (or closes) the
  filter with the loudness of the sound, or of another track through the sidechain: the kick
  that opens the bass.
- Gate, a new effect: the trance gate. A pattern of up to 32 steps, in time and locked to the
  bar, opens and closes the sound; each step has its own level, and Gate, attack and release
  shape how long and how softly it opens. Swing delays the odd steps, Profondità lets some of
  the sound through when closed (a stepped tremolo). Click a step to open or close it, drag up
  and down to set its level (across several steps too); right-click for all open, all closed,
  invert, random and shift.
- Tape Stop, a new effect: turn Stop on and the sound slows down to a halt like a tape or a
  turntable switched off, over a time in beats or milliseconds and with a linear, smooth or
  fast curve; turn it off and it comes back, at once or speeding up from standstill
  (Ripartenza). With the transport running the brake can wait for the next grid line, so it
  lands in time.
- Reverse, a new effect: the sound backwards in slices locked to the bar (1/16 to 1 bar):
  during each slice you hear the previous one from its end to its start, the classic suck
  before a drop. Switch it on and off on the fly; Dry/Wet blends in the forward sound.

- Chorus, a new effect: slightly delayed copies of the sound with a gently swaying delay, to
  widen and thicken it. Chorus (two voices), Ensemble (three, denser: the strings of '80s
  synths) or Vibrato (one voice, pitch only); Larghezza offsets the right channel for stereo,
  feedback pushes it toward a flanger, and the movement can run in time with the song.
- Auto Pan, a new effect like Live's Auto Pan: the same LFO shapes as the Auto Filter, locked
  to the bar, move the sound from side to side (Stereo 180°) or turn it into a tremolo (0°),
  at constant power so it doesn't dip in the middle.
- Redux, a new lo-fi effect: lowers the sample rate (each sample holds until the next, for
  stepped waves and folded-back frequencies) and the bit depth (in fractional steps, so it
  sweeps smoothly). Jitter makes the sample clock uneven; the filter can remove what would fold
  back (Prima) or smooth the steps (Dopo).
- Rack macros can be switches and buttons, not only knobs (something Live's racks don't have):
  right-click a macro and choose Manopola, Interruttore (a click turns it on, another off) or
  Pulsante (on only while you hold it down). Switches and buttons move every mapped parameter
  from one end of its range to the other, so one button can turn on Stop, close a filter and
  raise a reverb at once. Mapping an on/off parameter such as Stop or Repeat to an empty macro
  makes it a switch by itself. Holding a button doesn't fill the undo history, and a clip
  modulation on a switch or button flips it at halfway, like pressing it.

### Changed
- Clip modulations can now move switches and menus too, not just knobs: draw a curve on
  Stop, Repeat or Reverse to switch them on and off in time, or on a menu such as Divisione
  to step through its options. A switch flips when the curve moves it past halfway; the lane
  shows with a dashed line what is actually heard, and the value under the pointer names the
  option ("On · +60 %").

## [0.3.12] - 2026-10-20

### Added
- Zones in the Sampler, like Live's Sampler: load up to 32 samples and put each on its own key
  or on a range of keys (and velocities), with its own root note, tune, volume, pan, start/end
  and loop. A note plays every zone that contains it, so zones can be layered or split by
  velocity. The new "Zone" tab shows the keyboard with one row per zone: drag a bar to move it,
  drag an edge to resize it, click a key to hear it. Drop several audio files at once and they
  become new zones: one key each from the key under the pointer (a drum kit), or, when every file
  name has a note in it ("Piano C3.wav"), spread across the keyboard around those notes (a
  multisampled instrument). Zones on a single key name their notes in the piano roll, and
  picking a preset no longer resets the key map.
- A scroll bar under the arrangement: drag it to move along the timeline, or click it to jump
  there. You can also drag the timeline with the middle mouse button (the pressed wheel), in
  any direction.

### Fixed
- Shift + mouse wheel didn't scroll the arrangement sideways on Windows.

## [0.3.11] - 2026-10-20

### Added
- Follow, like Live's: "↦ Segui" in the control bar (Ctrl+Shift+F, Options › Segui la testina).
  While playing, the arrangement scrolls to keep the playhead in view. Scrolling sideways,
  zooming or editing the timeline pauses it (the button shows an outline), so you can move
  around while the song plays; it comes back when you click the ruler, press Play again or click
  the button.
- Duplicate Loop (Ctrl+Shift+D). In the piano roll, like Live's "Dupl. Loop": the clip's loop
  doubles and its notes and modulations repeat in the second half (button next to :2 and ×2, or
  the right-click menu); an arrangement clip that ended with the loop grows with it. In the
  arrangement (Edit › Duplica loop, right-click on the ruler or on an empty lane): the stretch
  under the loop region is copied right after it on every track, and the loop moves onto the
  copy, so pressing it again lengthens the song one loop at a time.

### Changed
- In the piano roll, Ctrl+D places the copy after the end of the selection box, as in Live: a
  short note selected with a box one bar long repeats in the next bar. The box stays visible as
  a light band and moves onto the copy, so Ctrl+D again keeps going; Ctrl+A selects the whole
  loop, so Ctrl+A then Ctrl+D repeats the clip. Clicking a single note still copies it right
  after itself.

## [0.3.10] - 2026-10-20

### Added
- The Sampler, a new instrument like Live's Simpler and Sampler: it plays an audio file across
  the keyboard. Three modes: Classic (pitched from a root note, with a forward loop with
  crossfade or a ping-pong loop that holds the note; on release the loop keeps going or the
  sample plays on to its end), One-Shot (start to end on every hit; Trigger ignores the note
  length, Gate stops with it) and Slice (one slice per key from C1, cut at the transients, with
  a sensitivity, or on a grid of 4 to 64 equal parts). Reverse, transpose, detune, key tracking,
  poly/mono/legato with glide, the 13 filter types of Prisma, three envelopes with curves
  (volume, filter, pitch) and an LFO to pitch, cutoff, volume and pan. The panel shows the
  waveform: drag the start, end and loop markers (Shift for fine moves) or the whole loop, wheel
  to zoom, click a slice to hear it, double-click to add or remove a slice; a cursor follows
  every voice that plays. Drop an audio file or a browser sample on the panel to load it; a
  sample dropped on a MIDI track's device chain loads into a Sampler there.
- Copy a scene to the arrangement: right-click the scene › "Copia nell'arrangement". Every track
  gets a copy of its clip at the cursor, as long as the scene needs for its loops to come round
  (what was underneath is trimmed, as when pasting); then the cursor moves to its end, so the
  next scene lines up after it.

## [0.3.9] - 2026-10-20

### Added
- The browser, on the left like Live's (◧ Browser at the top, View › Browser or Ctrl+Alt+B;
  drag its right edge to resize it). It holds only what studiomio has: Instruments and Audio
  Effects (a folder per device, with its user and factory presets), Drums (the Drum Machine
  kits), Current Project (the project's samples), User Presets, and sample folders from disk
  that you add with "+ Folder…" (remembered between sessions). Ctrl+F searches every source,
  starting from the selected one. Double-click or Enter loads an item where you're working: a
  device into the open chain or onto the selected track (an instrument on a non-MIDI track gets
  a new MIDI track), a sample into the selected session slot or at the cursor on the timeline.
  Or drag it onto a timeline lane, a track header, a session slot or column, the open device
  chain or the master. Selecting a sample shows its waveform and, with 🎧 on, plays it.

## [0.3.8] - 2026-10-19

### Fixed
- In the session the buses sat right after the tracks: they now stay next to the master, on the
  right edge, like Live's return tracks, and keep their place while the tracks scroll sideways.
- With many buses the send knobs piled up in the mixer and covered the scenes: they are now
  smaller, three per row and at most two rows (scroll inside for more). Under each knob is the
  bus name; the value shows while you turn it.

## [0.3.7] - 2026-10-19

### Added
- Buses, like Live's return tracks: a bus has no clips, it receives what the tracks send it,
  runs it through its own effects (a shared reverb or delay, say) and goes to the master. Each
  mixer strip in the session gets a send knob per bus, from −∞ (closed) to 0 dB, post-fader;
  double-click closes it. Add buses with "+ Bus" in the session or Create › New bus; click a
  bus's header to open its effects, right-click to rename, recolor or delete it. Soloing a track
  keeps the buses open, so you hear it with its reverb; muting a track closes its sends too.
  Projects saved earlier open as they were, without buses.

### Changed
- A new project starts with a MIDI track, an audio track and two buses (A Bus, B Bus).

## [0.3.6] - 2026-10-19

### Changed
- A standard menu bar (File, Edit, Create, View, Options, Help) replaces the row of buttons at
  the top: open, save, import, export, undo, zoom, grid snap and MIDI controllers now live in
  the menus, with their shortcuts shown next to each entry. The control bar keeps only what you
  need while playing: transport, position, tempo, loop, metronome and the Arrangement/Session
  switch. Alt plus a menu's initial opens it; ← and → move between menus.

- Prisma's page tabs and modulation sources moved into the device's title bar, so the
  instrument fits the device view and the chain no longer scrolls vertically: it only scrolls
  sideways, like in Live.

- The ✕ button on every track header is gone (it was easy to hit by mistake and took room from
  the track name): delete a track from its right-click menu.
- The • next to the project name now means exactly "there are unsaved changes": an empty new
  project or the demo just loaded no longer shows it.

### Added
- Unsaved changes are no longer lost without warning: New project, Open, Load demo and closing
  the window ask whether to save first (Save / Don't save / Cancel).
- Ctrl+N: new project.
- Clip colors: right-click a clip (on the timeline or in a session slot) and pick a color from
  the swatches; on the timeline it colors every selected clip at once, in one undo step. The
  crossed swatch gives the clips their track's color back. Pads on the APC40 and Launchpad
  follow the new color.
- Track colors: right-click a track header (in the arrangement or the session) and pick a
  color. The track's clips that still had the track color follow it; clips given a color of
  their own keep it. One undo step brings back both.
- Help › Keyboard shortcuts lists every shortcut; Help › About shows the version.
- Ctrl+Shift+S: Save As.

## [0.3.5] - 2026-10-19

### Added
- Novation Launchpad support (Launchpad X, Mini MK3, Pro MK3 and MK2), plug and play like in
  Live: the 8×8 grid launches the clips of an 8-track × 8-scene box of the session (playing clips
  pulse green, queued ones blink), the right-hand buttons launch scenes, the arrows move the box
  and the Session button opens the overview of the whole session. Each model also gets its
  mixer as in Live: volume and pan faders drawn on the grid, stop, mute and solo buttons; on the
  Pro MK3, faders for the parameters of the selected device too. The Launchpad support was
  written from Live's own scripts without the hardware: please report anything that doesn't
  behave as described.

## [0.3.4] - 2026-10-19

### Added
- Crop for audio clips, as in Live: the "Crop" button in the clip editor (or right-click on
  the waveform) keeps only the loop, or the region when the loop is off. That part of the sample
  becomes a new audio file in the project and the clip plays only that, sounding as before.
  The original file stays in the project folder, and Undo brings the old clip back.
- Export a scene as audio: right-click a scene and choose "Esporta audio…" to get a WAV of
  what plays when you launch it. The length is automatic: long enough for all the scene's loops
  to come back to the start together (a 4-bar and a 3-bar loop give 12 bars), and at least as
  long as the longest clip that doesn't loop. When the scene loops, reverb and delay tails
  wrap around to the start of the file, so it loops without a gap.

## [0.3.3] - 2026-10-18

### Added
- Your own presets: the ★ button in the header of every instrument and effect saves its
  current settings as a preset, available in every project under "I miei preset" at the top of
  the preset menu. Right-click the header to update or delete the preset you're using, or to
  open the presets folder. Each preset is a file in Documents\studiomio\Preset, so presets
  survive uninstalling the app and can be copied to another computer or shared. Drum Machine
  samples aren't part of a preset.

## [0.3.2] - 2026-10-18

### Fixed
- Drum Machine: the pad editor no longer spills out of the device panel; the panel widens to
  fit it.

## [0.3.1] - 2026-10-18

### Added
- Prisma: 11 new presets built around movement: envelopes that speed up LFOs, a step
  sequence drawn in an LFO, polyrhythmic LFOs, sample & hold that changes the speed of other
  LFOs, one-shot LFOs used as multi-stage envelopes, and macros that set LFO depth through aux.

### Fixed
- Prisma: the first note played on each voice no longer skips the attack of envelopes 2–4.

## [0.3.0] - 2026-10-18

### Added
- Prisma: a big wavetable synth in the style of Serum (without effects). Two wavetable
  oscillators with warp modes (sync with anti-aliased resets, soft sync, bend, PWM, asymmetry,
  mirror, flip, quantize, FM/AM/RM from the other oscillator, FM from the sub) and up to 16
  unison voices each (detune, blend, stereo width, spread across the table, phase and random
  phase); a sub oscillator; a noise oscillator (white, pink, brown, digital, crackle); two
  stereo filters (LP 12/24, ladder, HP, BP, notch, peak, comb +/−, formant, phaser) with drive
  and mix, in series or in parallel, and every source picks its filter or goes direct; four
  envelopes with hold and curves (the first is the amp); four LFOs you can draw, with grid,
  curved segments, tempo sync, retrigger/free/one-shot, delay, rise and smoothing; four macros;
  poly, mono and legato with glide.
- Prisma's modulation matrix: 16 slots, each with a source (envelopes, LFOs, velocity, note,
  random, gate, macros), an amount in fraction of the target knob's travel, uni/bipolar, a curve
  and an aux source that scales it. Drag a source onto almost any knob to modulate it; click a
  source and Alt+drag on a knob to set its amount; rings around the knobs show where each
  modulation reaches; right-click a knob to remove its modulations. Slot amounts can be mapped
  to rack macros and automated from clips.
- Prisma can use any WAV file as an oscillator's wavetable (Serum-style files with one 2048-sample
  cycle per frame, a single cycle, or any sound sliced into frames): drop it on the table or use
  "Importa…". It comes with 25 presets (basses, leads, pads, plucks, keys, rhythmic and FX).
- Eight new wavetables, also available in Wavetable: Formanti, Spettrale, Additiva, Pulsar,
  Growl, Metallo, Seno caldo, Ottave.

### Fixed
- ◂ next to an Instrument Rack that holds only the instrument now moves the effect into the
  rack, as it does with any other rack; outside a rack an effect still cannot go before the
  instrument.

## [0.2.3] - 2026-10-18

### Fixed
- Device controls no longer spill out of their panel, in the chain or inside a rack (the EQ
  band row, the Analog oscillators, the Drive). Choices with three or four buttons now take two
  columns, so they are never taller than a knob; the EQ and Drive graphs take the height that is
  left above their controls. If a device ever needs more room, the panel grows and the chain
  scrolls instead.

## [0.2.2] - 2026-10-18

### Added
- Compressor sidechain: the new Sidechain card picks a track for the detector to listen to
  instead of the sound going through, like the kick that makes the bass pump. The detector
  hears that track after its effects and before its volume, so a muted kick still works as a
  trigger; the Detector high-pass filters it. Only tracks that would not loop back are offered
  (not the track itself, nor the group it is in). Deleting the track it listens to brings the
  compressor back to listening to itself. Existing projects sound exactly as before; projects
  saved with this version cannot be opened by older ones.

## [0.2.1] - 2026-10-18

### Added
- Piano roll: Fold (F, or the Fold button), like Live's: only the rows of the pitches that have
  notes are shown. The rows follow the notes as you edit them.
- The clip editors (piano roll and audio) can be made taller or shorter by dragging their top
  edge; double click resets the height. The height is remembered.
- Scene colors: right click a scene and pick a color from the row of swatches (the last one
  removes it). The scene is tinted in the session, duplicates keep the color, and on the APC40
  the scene launch buttons light up in the scene's color.

### Changed
- Clearer grid in the clip editors, like Live's: bars, beats and half beats have lines of
  different strength, every other beat (or bar, zoomed out) is shaded, and the ruler has
  longer ticks on the beats.

### Fixed
- Editing while the song plays no longer makes the sound drop out for a moment. Only the edited
  track is rescheduled, the others are not touched, notes already playing go on and audio clips
  crossfade. When the tempo changes, warped audio keeps playing in time while it is recomputed.

## [0.2.0] - 2026-10-18

### Added
- Wavetable: a new wavetable synth, like Live's. Two oscillators each read a table (Basic, PWM,
  Harmonics, Sync, Fold, FM, Vocal, Organ, Digital) at a position you can sweep with the
  modulation envelope and two LFOs; sub, unison with position spread, filter, poly/mono/legato
  with glide, 28 presets with matched loudness. High notes stay free of aliasing. The panel draws
  both tables and you drag them to move the position.
- Piano roll: :2 and ×2 buttons, like on audio clips, halve or double the whole MIDI clip (notes,
  loop and clip envelopes); on the timeline the clip gets shorter or longer from its start.

## [0.1.9] - 2026-10-17

### Changed
- Release notes are now written in English.

## [0.1.8] - 2026-10-17

### Added
- Devices in the chain can be folded into a vertical strip showing their name (▾/▸ or double
  click on the header), like in Live.
- The update dialog shows what's new, including the versions you skipped.

## [0.1.7] - 2026-10-17

### Added
- Reverse for audio clips: sound, waveform and transients are flipped together, in the mix export
  too.

## [0.1.6] - 2026-10-17

### Fixed
- Automatic updates work again: release 0.1.5 had been published without the file that announces
  them.

## [0.1.5] - 2026-10-17

### Fixed
- Fixes to the release build, no changes to the app.

## [0.1.4] - 2026-10-17

### Added
- Import audio straight into empty session slots: double click or "Importa audio…" on the slot;
  with the session open, the Import button uses the selected slot.

## [0.1.3] - 2026-10-17

### Added
- The app version is shown in the status bar.

## [0.1.2] - 2026-10-17

### Added
- Rack macros can be mapped to EQ controls too.

## [0.1.1] - 2026-10-17

First installable release for Windows, with automatic updates from the GitHub releases.

### Added
- Arrangement view and session view like in Live: clips and scenes launched in time, mixer, master
  with its own effects, level meters.
- Audio clip warping with an editor (warp markers, transients, Auto-Warp, loop) and a piano roll
  for MIDI clips; volume, pan and parameter modulations inside clips.
- Instruments: Analog (with unison and 303-style Legato mode), Neuro for basses, Drum Machine with
  synthesized or sampled pads.
- Effects: 8-band EQ, Delay, Drive, Compressor, Limiter, Reverb, Multiband (OTT), Phaser/Flanger,
  Stereo; track grouping; APC40 control.
- Projects saved in a folder, with undo/redo and mix export.
