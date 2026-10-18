# Changelog

What's new in each version of studiomio. New entries go under "Unreleased": `release.bat`
assigns them to the version it publishes and the build puts them in the GitHub release.
Sections: Added, Changed, Fixed.

## [Unreleased]

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
