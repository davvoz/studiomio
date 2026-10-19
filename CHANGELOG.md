# Changelog

What's new in each version of studiomio. New entries go under "Unreleased": `release.bat`
assigns them to the version it publishes and the build puts them in the GitHub release.
Sections: Added, Changed, Fixed.

## [Unreleased]

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
