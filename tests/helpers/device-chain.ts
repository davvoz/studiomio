/* The real device chain (DeviceView) on a real store, for the tests of the panels: what's done with
 * the mouse is read back from the project. For files with `// @vitest-environment happy-dom`. */
import { vi } from 'vitest';
import type { BrowserItem, LoadTarget } from '../../src/browser/item';
import type { DeviceId, SampleId } from '../../src/core/id';
import type { SampleData } from '../../src/devices/dsp/core';
import type { EffectSettings, InstrumentSettings } from '../../src/model/device';
import type { ModTarget } from '../../src/model/envelope';
import type { ChainOwner } from '../../src/model/project';
import type { MidiTrack } from '../../src/model/track';
import { Clipboard } from '../../src/store/clipboard';
import { addEffect, addSample, setInstrument } from '../../src/store/edits';
import { MacroSprings } from '../../src/store/macro-springs';
import { DeviceView } from '../../src/ui/device/device-view';
import { NO_SPECTRUM, type DynamicsReading, type SpectrumTap } from '../../src/ui/device/displays';
import { UiState } from '../../src/ui/ui-state';
import { fakeBrowser } from './browser';
import { sampleRef, setup } from './fixtures';

export interface ChainOptions {
  /** The instrument of the MIDI track (Analog if missing). */
  readonly instrument?: Partial<InstrumentSettings>;
  /** The effect types, in order. */
  readonly effects?: readonly string[];
  /** The instrument's samples can be drawn. */
  readonly audio?: SampleData;
  readonly spectrum?: SpectrumTap;
  readonly dynamics?: () => DynamicsReading | null;
  readonly modulation?: (target: ModTarget) => number | null;
}

/** The chain of a MIDI track, open; with a project that also has an audio track and two samples. */
export function openChain(o: ChainOptions = {}) {
  const browser = fakeBrowser();
  const { store, track, ids } = setup({ midi: 1, audio: 1 });
  const midi = store.project.tracks.find(t => t.kind === 'midi')!.id;
  const owner: ChainOwner = midi;
  const samples = [sampleRef(ids, { name: 'one' }), sampleRef(ids, { name: 'two', file: 'audio/two.wav' })];
  for (const s of samples) store.apply(addSample(s));
  if (o.instrument) store.apply(setInstrument(midi, { type: 'analog', preset: null, params: {}, ...o.instrument }));
  for (const type of o.effects ?? []) store.apply(addEffect(owner, type, type));
  const ui = new UiState();
  const said: string[] = [], auditioned: number[] = [], automated: ModTarget[] = [], dropped: [BrowserItem, LoadTarget][] = [];
  const played: number[] = [];
  let playheads: readonly number[] = [];
  const importSample = vi.fn(async (file: File) => {
    if (file.name.startsWith('broken')) throw new Error('not audio');
    return sampleRef(ids, { name: file.name, file: `audio/${file.name}` });
  });
  const view = new DeviceView({
    store, ui, importSample, sampleRate: 48000,
    audition: (_t, pitch) => { auditioned.push(pitch); },
    spectrum: () => o.spectrum ?? NO_SPECTRUM,
    dynamics: () => ({ read: o.dynamics ?? (() => null), dispose: () => undefined }),
    playedNotes: () => () => played.splice(0),
    sampleAudio: (_id: SampleId) => o.audio,
    playheads: () => playheads,
    say: t => { said.push(t); },
    clipboard: new Clipboard(),
    showAutomation: (_o, t) => { automated.push(t); },
    dropItem: (item, target) => { dropped.push([item, target]); },
    ...(o.modulation ? { modulation: (_o: ChainOwner, t: ModTarget) => o.modulation!(t) } : {}),
    springs: new MacroSprings(store),
  });
  document.body.replaceChildren(view.element);
  view.open(owner);
  const effects = (): readonly EffectSettings[] => store.project.track(owner)!.effects;
  const instrument = () => (store.project.track(owner) as MidiTrack).instrument;
  return {
    ...browser, store, track, owner, view, ui, said, auditioned, automated, dropped, played, samples, importSample, effects, instrument,
    setPlayheads: (at: readonly number[]) => { playheads = at; },
    effectId: (i: number): DeviceId => effects()[i].id,
    q: <T extends HTMLElement = HTMLElement>(selector: string): T => view.element.querySelector<T>(selector)!,
    all: <T extends HTMLElement = HTMLElement>(selector: string): T[] => [...view.element.querySelectorAll<T>(selector)],
    panels: () => [...view.element.querySelectorAll<HTMLElement>('.device-panel')],
  };
}

export type Chain = ReturnType<typeof openChain>;
