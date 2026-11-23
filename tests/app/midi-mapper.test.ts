import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MidiMapper } from '../../src/app/midi-mapper';
import type { ControlSurfaces } from '../../src/control/control-surfaces';
import type { MidiControl, MidiTarget } from '../../src/model/midi-map';
import type { MidiTrack } from '../../src/model/track';
import { addEffect } from '../../src/store/edits';
import type { MacroSprings } from '../../src/store/macro-springs';
import { setMidi } from '../../src/store/midi-edits';
import { groupDevices, mapMacro, setMacroMode } from '../../src/store/rack-edits';
import { UiState } from '../../src/ui/ui-state';
import { setup } from '../helpers/fixtures';

type Listener = (e: unknown) => void;

const cc = (number: number, channel = 0): MidiControl => ({ type: 'cc', channel, number });
const note = (number: number, channel = 0): MidiControl => ({ type: 'note', channel, number });

function keydown(k: string, over: Record<string, unknown> = {}) {
  return {
    key: k, ctrlKey: false, metaKey: false, altKey: false, target: null, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    ...over,
  };
}

function rig(withSprings = false) {
  const s = setup({ midi: 1 });
  const t = s.track(0);
  s.store.apply(addEffect(t, 'delay', 'Delay'));
  s.store.apply(addEffect(t, 'tapeStop', 'Tape Stop'));
  const track = () => s.store.project.tracks[0] as MidiTrack;
  const [delay, stop] = track().effects.map(e => e.id);
  s.store.apply(groupDevices(t, [delay, stop]));
  const rack = track().racks[0].id;
  const macroAt = (index: number): MidiTarget => ({ kind: 'macro', owner: t, rack, index });
  const ui = new UiState();
  const said: string[] = [];
  let onMidi: ((d: Uint8Array) => void) | undefined;
  const surfaces = { listening: false, onMidi: (fn: (d: Uint8Array) => void) => { onMidi = fn; return () => {}; } };
  const springs = { hold: vi.fn() };
  const mapper = new MidiMapper(s.store, ui, surfaces as unknown as ControlSurfaces, x => said.push(x),
    withSprings ? (springs as unknown as MacroSprings) : undefined);
  const send = (...bytes: number[]) => onMidi!(new Uint8Array(bytes));
  return { ...s, t, track, delay, stop, rack, macroAt, ui, said, surfaces, springs, mapper, send, macro: (i: number) => track().racks[0].macros[i] };
}

describe('MidiMapper', () => {
  const listeners = new Map<string, Listener>();

  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
    vi.stubGlobal('addEventListener', (type: string, fn: Listener) => { listeners.set(type, fn); });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('opening the ports', () => {
    it('listens only when mapping, with mappings in the project, or with an armed track', () => {
      const r = rig();
      expect(r.surfaces.listening).toBe(false);
      r.ui.setMidiMapping(true);
      expect(r.surfaces.listening).toBe(true);
      r.ui.setMidiMapping(false);
      expect(r.surfaces.listening).toBe(false);
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setMidi(r.macroAt(0), cc(21)));
      expect(r.surfaces.listening).toBe(true);
    });
  });

  describe('playing mapped controls', () => {
    it('a CC moves its macro; CCs arriving together apply only the last value, in one undo step', () => {
      const r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setMidi(r.macroAt(0), cc(21)));
      const start = r.macro(0).value;
      r.send(0xb0, 21, 10);
      r.send(0xb0, 21, 40);
      r.send(0xb0, 21, 127);
      expect(r.macro(0).value).toBe(start); // waiting for the flush
      vi.advanceTimersByTime(20);
      expect(r.macro(0).value).toBe(127);
      r.send(0xb0, 21, 0);
      vi.advanceTimersByTime(20);
      expect(r.macro(0).value).toBe(0);
      vi.advanceTimersByTime(500); // the idle timer closes the undo step
      r.store.undo();
      expect(r.store.undoLabel).toBe('Map to MIDI');
    });

    it('ignores unmapped controls, other channels, system messages and malformed data', () => {
      const r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setMidi(r.macroAt(0), cc(21)));
      const project = r.store.project;
      r.send(0xb0, 22, 127);
      r.send(0xb1, 21, 127);
      r.send(0xf8);
      r.send(0xe0, 1, 1); // pitch bend isn't mapped
      r.mapper.receive([]);
      r.mapper.receive([0xb0]);
      vi.advanceTimersByTime(100);
      expect(r.store.project).toBe(project);
    });

    it('notes: a toggle changes at each note on; a note on with velocity 0 counts as note off', () => {
      const r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.stop, 'stop'));
      r.store.apply(setMidi(r.macroAt(0), note(36)));
      r.send(0x90, 36, 100);
      expect(r.macro(0).value).toBe(127);
      r.send(0x80, 36, 0);
      r.send(0x90, 36, 0);
      expect(r.macro(0).value).toBe(127);
      r.send(0x90, 36, 100);
      expect(r.macro(0).value).toBe(0);
    });

    it('a note holds a button macro while it is down', () => {
      const r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setMacroMode(r.t, r.rack, 0, 'button'));
      r.store.apply(setMidi(r.macroAt(0), note(40)));
      r.send(0x90, 40, 90);
      expect(r.macro(0).value).toBe(127);
      r.send(0x80, 40, 0);
      expect(r.macro(0).value).toBe(0);
    });

    it('holds and releases spring macros with the note', () => {
      const r = rig(true);
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setMacroMode(r.t, r.rack, 0, 'spring'));
      r.store.apply(setMidi(r.macroAt(0), note(41)));
      r.send(0x90, 41, 90);
      expect(r.springs.hold).toHaveBeenLastCalledWith(r.t, r.rack, 0, true);
      r.send(0x80, 41, 0);
      expect(r.springs.hold).toHaveBeenLastCalledWith(r.t, r.rack, 0, false);
    });

    it('a failing edit is said instead of thrown', () => {
      const r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.store.apply(setMidi(r.macroAt(0), note(36)));
      vi.spyOn(r.store, 'apply').mockImplementation(() => { throw new Error('boom'); });
      r.send(0x90, 36, 100);
      expect(r.said).toEqual(['MIDI: boom']);
    });
  });

  describe('learning (MIDI on)', () => {
    let r: ReturnType<typeof rig>;
    beforeEach(() => {
      r = rig();
      r.store.apply(mapMacro(r.t, r.rack, 0, r.delay, 'mix'));
      r.ui.setMidiMapping(true);
    });

    it('asks to choose a target first, once for a stream of CCs', () => {
      r.send(0xb0, 21, 5);
      r.send(0xb0, 21, 6);
      expect(r.said).toHaveLength(1);
      expect(r.said[0]).toContain('First click a macro');
      expect(r.store.project.midiMap).toEqual([]);
    });

    it('maps the moved control to the chosen target', () => {
      const start = r.macro(0).value;
      r.ui.chooseMidiTarget(r.macroAt(0));
      r.send(0xb0, 21, 64);
      r.send(0xb0, 21, 65);
      expect(r.store.project.midiMap).toEqual([{ control: cc(21), target: r.macroAt(0) }]);
      expect(r.said).toHaveLength(1);
      expect(r.said[0]).toMatch(/^Mapped to .*Del removes it, Esc turns MIDI off\.$/);
      expect(r.macro(0).value).toBe(start);
    });

    it('a note maps on note on only, and says when it also moves other controls', () => {
      r.store.apply(mapMacro(r.t, r.rack, 1, r.stop, 'stop'));
      r.store.apply(setMidi(r.macroAt(1), note(36)));
      r.ui.chooseMidiTarget(r.macroAt(0));
      r.send(0x80, 36, 0);
      expect(r.store.project.midiMap).toHaveLength(1);
      r.send(0x90, 36, 100);
      expect(r.store.project.midiMap).toHaveLength(2);
      expect(r.said.at(-1)).toContain('(it also moves another control)');
    });

    it('can say the same thing again after MIDI was turned off and on', () => {
      r.send(0xb0, 21, 5);
      r.ui.setMidiMapping(false);
      r.ui.setMidiMapping(true);
      r.send(0xb0, 21, 5);
      expect(r.said).toHaveLength(2);
    });

    it('Esc turns MIDI off, Del and Backspace remove the control of the target', () => {
      r.ui.chooseMidiTarget(r.macroAt(0));
      r.store.apply(setMidi(r.macroAt(0), cc(21)));
      const del = keydown('Delete');
      listeners.get('keydown')!(del);
      expect(del.defaultPrevented && del.stopped).toBe(true);
      expect(r.store.project.midiMap).toEqual([]);
      expect(r.said.at(-1)).toBe('MIDI control removed.');
      r.store.apply(setMidi(r.macroAt(0), cc(21)));
      listeners.get('keydown')!(keydown('Backspace'));
      expect(r.store.project.midiMap).toEqual([]);
      const esc = keydown('Escape');
      listeners.get('keydown')!(esc);
      expect(r.ui.midiMapping).toBe(false);
      expect(esc.stopped).toBe(true);
    });

    it('other keys, modifiers and text fields are ignored; so is everything when MIDI is off', () => {
      r.ui.chooseMidiTarget(r.macroAt(0));
      r.store.apply(setMidi(r.macroAt(0), cc(21)));
      listeners.get('keydown')!(keydown('a'));
      listeners.get('keydown')!(keydown('Delete', { ctrlKey: true }));
      listeners.get('keydown')!(keydown('Delete', { target: { tagName: 'TEXTAREA', isContentEditable: false } }));
      expect(r.store.project.midiMap).toHaveLength(1);
      r.ui.setMidiMapping(false);
      const esc = keydown('Escape');
      listeners.get('keydown')!(esc);
      expect(esc.defaultPrevented).toBe(false);
    });

    it('Esc without a target still turns MIDI off, and Del without a target does nothing', () => {
      const del = keydown('Delete');
      listeners.get('keydown')!(del);
      expect(del.defaultPrevented).toBe(false);
      expect(r.said).toEqual([]);
    });
  });
});
