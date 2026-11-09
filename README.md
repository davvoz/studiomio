# studiomio

A DAW in the browser (and in Electron) modelled on Ableton Live: arrangement and session view, audio
clips with warp, MIDI clips, clip modulations, instruments and effects in AudioWorklet, racks with
macros, MIDI controllers. TypeScript; the warp engine comes from [WarpMio](../warpmio).

## Download

[![Download for Windows](https://img.shields.io/github/v/release/davvoz/studiomio?label=Download%20for%20Windows&style=for-the-badge&color=ff9d2e)](https://github.com/davvoz/studiomio/releases/latest/download/studiomio-setup.exe)

The button downloads the installer of the latest version straight away (Windows 10/11, 64-bit). It
isn't signed: on the first install choose "More info" → "Run anyway". It updates itself. Notes and
earlier versions are in the [Releases](https://github.com/davvoz/studiomio/releases).

## Development

Requirements: Node 22+, Rust with `wasm32-unknown-unknown` and `wasm-pack`. After `npm install`, run
`npm run wasm` and `npm run wasm:test` once (the WebAssembly package isn't in the repository).

| Command | |
|---|---|
| `npm run dev` | development server on http://localhost:5173 (COOP/COEP headers; Chrome or Edge) |
| `npm test` · `npm run typecheck` | tests (Vitest) · types |
| `npm run build` | production build in `dist/` |
| `npm run bench` | warp timings, TypeScript against WebAssembly (`/bench.html`) |
| `npm run app` · `npm run dist` | the app in Electron · the installer in `release/` |

`VITE_DSP_WASM=1` turns on the WebAssembly algorithms. The scripts in `scripts/` run with the app's
modules: `node scripts/run.mjs scripts/<name>.ts …`.

**Release**: `npm version <patch|minor|major>` and `git push --follow-tags`. The tag starts
`.github/workflows/release.yml` (WASM, tests, installer, publishing with `latest.yml`, which the
installed apps read to update themselves). The CHANGELOG entries under "Unreleased" go into the release.

## Architecture

```
UI (DOM + canvas) ──commands──▶ ProjectStore ──immutable versions──▶ PlaybackEngine
                                    │                                    │
                              persistence/ (JSON)          Web Audio: mixer, sends, groups
                                                           AudioWorklet: instruments, effects, meters
                                                           Worker pool: warp renders (TS or WASM)
```

```
src/
  core/         typed ids, events, musical time (beats, BPM, time signature)
  model/        the immutable project: tracks (audio, MIDI, group, bus), clips, warp markers,
                notes, modulations, devices, racks and macros, scenes, launch quantization
  store/        ProjectStore (undo/redo as a stack of versions) and the edits, pure functions
                Project → Project, one per user action
  persistence/  project ⇄ JSON with version and migrations; the project folder on a Directory
                (File System Access, Node or in memory)
  engine/       playback: scheduler with lookahead, session (what each track plays and since when),
                scheduled modulations, effect chains updated by difference, LRU cache of the warp
                renders, offline export; all on audio-graph.ts (Web Audio or fake)
  devices/      instruments and effects: descriptions (parameters, sections, presets), DSP engines,
                factory racks; worklet/ the AudioWorklet processors; dsp/ the building blocks
                (PolyBLEP oscillators, SVF/TPT, ADSR, LFO, polyphony, oversampling, step sequencer)
  dsp/          warp engine, without DOM: stretch/ (beats, tones, texture, complex, repitch),
                analysis/ (onset, transients, tempo), codec/ (WAV, ZIP), wasm/ (bridge to Rust)
  workers/      typed RPC, worker pool, DspService
  browser/      the browser as data: sources, items, search
  control/      controllers via Web MIDI: APC40 mkII, Launchpad X / Mini MK3 / Pro MK3 / MK2
  ui/           timeline, session, piano roll, audio editor, modulations, device chain
                (controls generated from the parameters, graphic panels registered in displays.ts)
  app/          assembly: AudioContext, workers, engine, commands, opening and saving
electron/       main.ts: serves dist/ from app://studiomio with COOP/COEP, permissions, updates
crates/dsp/     phase vocoder in Rust → WebAssembly (SIMD)
scripts/        rendering without a browser (headless-render.ts, render-project.ts), BS.1770 loudness
tests/          one file per module; equivalence with WarpMio (tests/reference/)
```

A project folder holds `progetto.json` (readable, versioned), `progetto.bak.json` (the previous
save) and `audio/` (the original files, copied on import).

### Real-time audio

- **Two AudioWorklet processors**: one for the instruments (notes with the context time, each block
  split at the exact sample of each note) and one for the effects. The DSP engines are registered by
  type in `devices/worklet/cores.ts`.
- **Parameters and modulations**: device parameters arrive as timed steps and ramps, applied in
  blocks of 128 samples (`mod-timeline.ts`). Volume and pan are AudioParams, sample-accurate.
- **Transport**: effects and instruments that follow the bar (delay, gate, beat repeat, sequencer)
  get a beat ↔ context time anchor.
- **Meters**: peak and RMS written into a SharedArrayBuffer, which is why COOP/COEP are needed.
- **Warp**: audio clips are rendered in the workers and kept in an LRU cache by content. Session
  clips run on a continuous clock, which stays in phase with the timeline loop.

## Features

- **Arrangement**: canvas timeline, loop, grid, cut/copy/paste, split, metronome.
- **Session**: slots and scenes, quantized launch (from none to 4 bars), return to the arrangement
  per track as in Live.
- **Tracks**: audio, MIDI, nested groups (with solo and mute as in Live) and post-fader send buses.
- **Audio clips**: warp markers, Auto-Warp from the transients, warp modes, transpose, gain.
- **MIDI clips**: piano roll with velocity, fold, quantization, :2 / ×2.
- **Clip modulations**: relative curves on volume, pan, any parameter or macro. They run with the
  clip loop and end up in the export.
- **Racks**: single-chain Instrument Racks and Audio Effect Racks, with 8 macros (knob, toggle,
  button or spring, which returns to its rest by itself when released) mappable with minimum and
  maximum. Presets can be saved; factory racks.
- **Browser**: devices, presets, racks, kits, project samples and disk folders, with search and
  preview.
- **Controllers**: plug-and-play APC40 mkII and Launchpad (Ableton/DAW mode): clip grid, box, mixer,
  8 macros or device parameters, transport. To diagnose the Launchpad support, which hasn't been
  tested on the hardware, there's `studiomio.surfaces.report()`.
- **Export**: timeline mix with OfflineAudioContext. In Node, `scripts/render-project.ts` computes
  the mix and the stems with the same DSP engines and measures the loudness (integrated, short-term,
  true peak).

### Devices

| Instruments | |
|---|---|
| Analog | two-oscillator subtractive, Poly/Mono/Legato with glide, 303-style accent, unison up to 7 |
| Wavetable | two oscillators on band-limited tables per octave, sub, unison, 2 LFOs, modulation envelope |
| Prisma | Serum-style wavetable: draggable modulation sources, matrix, 13 filter types |
| Neuro | reese/neuro basses, mono: FM, wavefolder, formants, sub on a crossover, 2× oversampled |
| Sampler | Classic / One-Shot / Slice, up to 32 zones with their own pitch, filter, envelopes and LFO |
| Drum Machine | 16 synthesized or sampled pads, choke, sample start and direction |

Analog and Neuro have a **step sequencer**. With a held note it plays a deterministic pattern (128
patterns), locked to the transport's bar and transposed onto that note. It's controlled by density,
scale, accents, slide, steps (1–32), rate and gate.

**Effects**: EQ (8 bands, TPT, the graph uses the same maths as the sound), Compressor (with
sidechain), Multiband (OTT style), Drive (6 curves, ADAA, oversampled), Clipper, Redux,
Auto Filter, Auto Pan, Chorus, Phaser/Flanger, Pitch Shifter, Trance Gate, Noise Gate, Beat Repeat, Tape Stop, Reverse,
Delay, Reverb (8-line FDN), Stereo (width and mono lows), Limiter (lookahead, true peak).

### Adding a device

1. The description (`DeviceType`: parameter sections and presets) in `src/devices/instruments/<name>/`
   or `src/devices/effects/<name>/`, registered in `registry.ts`.
2. The engine, registered under the same name in `devices/worklet/cores.ts`. For an instrument it's
   an `InstrumentCore` (`noteOn`, `noteOff`, `setParams`, `render`), for an effect an `EffectCore`
   (`setParams`, `setTempo`, `process`).

Interface, saving, presets, undo, bypass, mapping to macros and messages to the audio come by
themselves. A graphic panel of its own is registered in `ui/device/displays.ts`.

## Principles

- **Immutable model**: every edit produces a new `Project` that shares the untouched parts.
  Undo/redo is a stack of versions, and the engine works out what changed by comparing references.
  Positions are in beats; seconds are only for playing.
- **Pure functions for computations, classes for state**: edits and DSP are functions; classes
  encapsulate state and lifecycle (voices, FFT, pool).
- **Tables instead of switches**: warp modes, clip kinds, tracks and devices are registries. Adding
  one means adding an entry, and the compiler points out what's missing.
- **Injected dependencies**: algorithms, workers, ids, Directory and audio graph are replaced in tests.
- **Backward compatibility**: the format has a version, and every change brings a migration.
- **Reference**: the tests compare the warp with WarpMio's original engine.

## Performance (warp, 16 s stereo, Complex)

| | |
|---|---|
| TypeScript | ~290 ms |
| WebAssembly (Rust, SIMD) | ~330 ms |
| 8 workers in parallel | 5× faster than in sequence |

The WASM is ready but off: on this load V8 is faster, and the real gain comes from the workers'
parallelism.
