import { describe, expect, it } from 'vitest';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { Launchpad } from '../../src/control/launchpad/launchpad';
import {
  COLOR, dawMode, dawPort, faderSetup, IDENTITY_REQUEST, identityFamily, layoutMessage, MK2_QUIT, MODELS, modelOfPort, padAt, padNote,
  portInterface, sceneAt, sceneButton, type ModelId,
} from '../../src/control/launchpad/protocol';
import { dbToFader, faderToDb } from '../../src/control/mixer-scale';
import { paletteIndex } from '../../src/control/palette';
import type { DetailView, SurfaceEngine } from '../../src/control/session-surface';
import { paramFromUnit } from '../../src/devices/params';
import { paramsOf, resolveParams } from '../../src/devices/device-type';
import { instrumentType } from '../../src/devices/registry';
import type { TrackSessionState } from '../../src/engine/session';
import { MidiClip } from '../../src/model/midi-clip';
import { Project, type ChainOwner } from '../../src/model/project';
import type { MidiTrack, Track } from '../../src/model/track';
import { addTrack, setSlot } from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';
import { UiState } from '../../src/ui/ui-state';

const model = (id: ModelId) => MODELS.find(m => m.id === id)!;

/** The identity reply of a Novation of the given family. */
const identityReply = (id: ModelId) => [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x00, 0x20, 0x29, ...model(id).family, 0x00, 0x00, 0x00, 0x01, 0x06, 0x02, 0xf7];

class FakeEngine implements SurfaceEngine {
  playing = false;
  position = 0;
  metronomeOn = false;
  readonly calls: string[] = [];
  readonly states = new Map<TrackId, TrackSessionState>();
  launchSlot(track: TrackId, slot: number) { this.calls.push(`slot ${track} ${slot}`); }
  launchScene(index: number) { this.calls.push(`scene ${index}`); }
  stopTrack(track: TrackId) { this.calls.push(`stop ${track}`); }
  stopAllClips() { this.calls.push('stop all'); }
  sessionState(track: Track): TrackSessionState {
    return this.states.get(track.id) ?? { playing: null, queued: null, followsArrangement: true };
  }
}

/** A Launchpad of the given model with `tracks` MIDI tracks and `scenes` scenes; a red clip in each slot (t, s) of `clips`. */
function rig(id: ModelId, opts: { tracks?: number; scenes?: number; clips?: readonly (readonly [number, number])[] } = {}) {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('t', ids, opts.scenes ?? 16), ids);
  for (let i = 0; i < (opts.tracks ?? 3); i++) store.apply(addTrack('midi'));
  const t = (i: number): TrackId => store.project.tracks[i].id;
  for (const [ti, s] of opts.clips ?? []) store.apply(setSlot(t(ti), s, MidiClip.empty(ids.next('clip'), 'c', '#ff0000', 4)));
  const ui = new UiState();
  const engine = new FakeEngine();
  const said: string[] = [];
  let detail: DetailView = null;
  let clock = 0;
  const out: number[][] = [];
  const host = {
    store, ui, engine,
    togglePlay: () => { engine.playing = !engine.playing; },
    stopAndRewind: () => { engine.playing = false; engine.position = 0; },
    toggleMetronome: () => { engine.metronomeOn = !engine.metronomeOn; },
    openDevices: (_owner: ChainOwner) => { detail = 'devices'; },
    openClip: () => { detail = 'clip'; },
    get detail() { return detail; },
    closeDetail: () => { detail = null; },
    say: (text: string) => { said.push(text); },
  };
  const lp = new Launchpad(model(id), host, data => out.push(data), () => clock);
  const m = model(id);
  const start = () => {
    lp.start();
    lp.receive(identityReply(id));
    if (id === 'mk2') lp.receive([0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x40, 0x12, 0x34, 0xf7]);
  };
  const pressPad = (col: number, row: number) => {
    lp.receive([0x90, padNote(col, row), 127]);
    lp.receive([0x90, padNote(col, row), 0]);
  };
  const cc = (n: number, value: number, channel = 0) => lp.receive([0xb0 | channel, n, value]);
  /** A button (CC), pressed and released. */
  const button = (n: number) => { cc(n, 127); cc(n, 0); };
  const pressScene = (row: number) => {
    if (m.sceneKind === 'cc') return button(sceneButton(row));
    lp.receive([0x90, sceneButton(row), 127]);
    lp.receive([0x90, sceneButton(row), 0]);
  };
  const settle = () => {
    for (let i = 0, n = -1; i < 50 && n !== out.length; i++) {
      n = out.length;
      lp.tick();
    }
  };
  /** The last state of a LED (note or CC): the steady colour, and the animation if any. */
  const led = (kind: 'note' | 'cc', n: number) => {
    settle();
    const status = kind === 'note' ? 0x90 : 0xb0;
    const last = out.map((x, i) => [x, i] as const).filter(([x]) => (x[0] & 0xf0) === status && (x[0] & 0x0f) <= 2 && x[1] === n).at(-1);
    if (!last) return undefined;
    const [msg, i] = last;
    const channel = msg[0] & 0x0f;
    // an animation is the steady colour on channel 1 followed by its channel
    if (channel === 0) return { color: msg[2], anim: 'fixed' as const };
    return { color: msg[2], anim: channel === 1 ? ('blink' as const) : ('pulse' as const), base: out[i - 1]?.[2] };
  };
  const sysex = () => out.filter(x => x[0] === 0xf0);
  /** The SysEx that change layout. */
  const layouts = () => sysex().filter(x => x[6] === (id === 'mk2' ? 0x22 : 0x00));
  return {
    store, ui, engine, lp, out, said, start, pressPad, pressScene, button, cc, led, settle, sysex, layouts, t, m,
    advance: (ms: number) => { clock += ms; },
  };
}

describe('Launchpad protocol', () => {
  it('grid: the top row is 81..88, the bottom one 11..18; the scenes 89 … 19', () => {
    expect(padNote(0, 0)).toBe(81);
    expect(padNote(7, 7)).toBe(18);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) expect(padAt(padNote(col, row))).toEqual({ col, row });
      expect(sceneAt(sceneButton(row))).toBe(row);
    }
    expect(sceneButton(0)).toBe(89);
    expect(sceneButton(7)).toBe(19);
    expect(padAt(19)).toBeNull();
    expect(padAt(90)).toBeNull();
    expect(sceneAt(109)).toBeNull();
  });

  it('the model from the port names, on Windows and elsewhere', () => {
    expect(modelOfPort('LPX MIDI')?.id).toBe('x');
    expect(modelOfPort('MIDIIN2 (LPX MIDI)')?.id).toBe('x');
    expect(modelOfPort('Launchpad X LPX DAW Out')?.id).toBe('x');
    expect(modelOfPort('MIDIOUT2 (LPMiniMK3 MIDI)')?.id).toBe('mini');
    expect(modelOfPort('LPProMK3 MIDI')?.id).toBe('pro');
    expect(modelOfPort('2- Launchpad MK2')?.id).toBe('mk2');
    expect(modelOfPort('Launchpad Mini')).toBeNull();
    expect(modelOfPort('APC40 mkII')).toBeNull();
  });

  it("the DAW port: with the name saying so, or the right interface for the model", () => {
    const ports = (...names: string[]) => names.map(name => ({ name }));
    expect(portInterface('MIDIOUT3 (LPProMK3 MIDI)')).toBe(3);
    expect(portInterface('LPX MIDI')).toBe(1);
    expect(portInterface('LPX DAW')).toBe('daw');
    expect(dawPort(ports('LPX MIDI', 'MIDIOUT2 (LPX MIDI)'), model('x'))?.name).toBe('MIDIOUT2 (LPX MIDI)');
    expect(dawPort(ports('LPProMK3 MIDI', 'MIDIOUT2 (LPProMK3 MIDI)', 'MIDIOUT3 (LPProMK3 MIDI)'), model('pro'))?.name).toBe('MIDIOUT3 (LPProMK3 MIDI)');
    expect(dawPort(ports('Launchpad X LPX MIDI Out', 'Launchpad X LPX DAW Out'), model('x'))?.name).toBe('Launchpad X LPX DAW Out');
    expect(dawPort(ports('Launchpad MK2'), model('mk2'))?.name).toBe('Launchpad MK2');
    // chosen by hand
    expect(dawPort(ports('LPX MIDI', 'MIDIOUT2 (LPX MIDI)'), model('x'), 1)?.name).toBe('LPX MIDI');
  });

  it('the SysEx of the layouts and of DAW mode, model by model', () => {
    expect(dawMode(model('x'), true)).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x10, 0x01, 0xf7]);
    expect(dawMode(model('mini'), false)).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0x00, 0xf7]);
    expect(layoutMessage(model('x'), 'session')).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x00, 0x00, 0xf7]);
    expect(layoutMessage(model('x'), 'volume')).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x00, 0x0d, 0xf7]);
    expect(layoutMessage(model('pro'), 'session')).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0e, 0x00, 0x00, 0x00, 0x00, 0xf7]);
    expect(layoutMessage(model('pro'), 'device')).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0e, 0x00, 0x01, 0x03, 0x00, 0xf7]);
    expect(layoutMessage(model('mk2'), 'pan')).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x22, 0x05, 0xf7]);
  });

  it('the faders: page, orientation, and for each index, polarity, CC, colour', () => {
    const colors = [21, 21, 21, 0, 0, 0, 0, 0];
    const x = faderSetup(model('x'), 0, { horizontal: false, bipolar: false, colors });
    expect(x.slice(0, 9)).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x01, 0x00, 0x00]);
    expect(x.slice(9, 13)).toEqual([0, 0, 21, 21]);
    expect(x.slice(-5)).toEqual([7, 0, 28, 0, 0xf7]);
    const pro = faderSetup(model('pro'), 1, { horizontal: true, bipolar: true, colors });
    expect(pro.slice(6, 9)).toEqual([0x01, 0x01, 0x01]);
    expect(pro.slice(9, 13)).toEqual([0, 1, 8, 21]);
  });

  it("the identity reply says the family", () => {
    expect(identityFamily(identityReply('x'))).toEqual([0x03, 0x01]);
    expect(identityFamily([0xf0, 0x7e, 0x00, 0x06, 0x02, 0x47, 0x29, 0, 0, 0, 0xf7])).toBeNull();
  });
});

describe('Launchpad X on the session', () => {
  it("at startup, as Live: identity, DAW mode, Session layout, 8×8 box and the LEDs", () => {
    const r = rig('x', { clips: [[0, 0]] });
    r.lp.start();
    expect(r.out).toEqual([[...IDENTITY_REQUEST]]);
    r.pressPad(0, 0);
    expect(r.engine.calls).toEqual([]); // nothing before the startup
    r.lp.receive(identityReply('x'));
    expect(r.out[1]).toEqual(dawMode(r.m, true));
    expect(r.out[2]).toEqual(layoutMessage(r.m, 'session'));
    expect(r.ui.sessionRing).toEqual({ track: 0, scene: 0, width: 8, height: 8 });
    expect(r.led('note', padNote(0, 0))).toEqual({ color: paletteIndex('#ff0000'), anim: 'fixed' });
    expect(r.led('note', padNote(1, 0))).toEqual({ color: COLOR.off, anim: 'fixed' });
    expect(r.led('cc', sceneButton(0))).toEqual({ color: COLOR.green, anim: 'fixed' });
  });

  it("if it doesn't answer the identity it goes on anyway", () => {
    const r = rig('x');
    r.lp.start();
    r.advance(1100);
    r.lp.tick();
    expect(r.lp.ready).toBe(true);
    expect(r.out[1]).toEqual(dawMode(r.m, true));
  });

  it('the pads launch the clips, the scenes the rows; the playing clip pulses, the queued one blinks', () => {
    const r = rig('x', { clips: [[0, 0], [1, 2]] });
    r.start();
    r.pressPad(0, 0);
    r.pressPad(2, 1); // empty slot: stops the track (like a click)
    r.pressScene(2);
    expect(r.engine.calls).toEqual([`slot ${r.t(0)} 0`, `slot ${r.t(2)} 1`, 'scene 2']);
    r.engine.states.set(r.t(0), { playing: { slot: 0, clip: 'c' } as never, queued: null, followsArrangement: false });
    r.engine.states.set(r.t(1), { playing: null, queued: { slot: 2 } as never, followsArrangement: false });
    expect(r.led('note', padNote(0, 0))).toEqual({ color: COLOR.green, anim: 'pulse', base: 0 });
    expect(r.led('note', padNote(1, 2))).toEqual({ color: COLOR.green, anim: 'blink', base: 0 });
    expect(r.led('cc', sceneButton(2))).toMatchObject({ color: COLOR.green, anim: 'blink' });
  });

  it('arrows: the box moves by one and stays inside the project', () => {
    const r = rig('x', { tracks: 10, scenes: 12 });
    r.start();
    r.button(r.m.buttons.right!);
    r.button(r.m.buttons.down!);
    expect(r.ui.sessionRing).toMatchObject({ track: 1, scene: 1 });
    for (let i = 0; i < 5; i++) r.button(r.m.buttons.right!);
    expect(r.ui.sessionRing).toMatchObject({ track: 2 }); // 10 tracks, 8 columns
    expect(r.led('cc', r.m.buttons.right!)?.color).toBe(COLOR.off);
    expect(r.led('cc', r.m.buttons.left!)?.color).toBe(COLOR.whiteHalf);
  });

  it('double click on Session: the block map; a pad brings the box there, Session closes it', () => {
    const r = rig('x', { tracks: 10, scenes: 20, clips: [[9, 17]] });
    r.start();
    r.button(r.m.buttons.session!);
    r.advance(100);
    r.button(r.m.buttons.session!);
    expect(r.led('note', padNote(0, 0))?.color).toBe(COLOR.offWhite); // the box
    expect(r.led('note', padNote(1, 2))?.color).toBe(COLOR.lightBlueHalf); // a block with clips
    expect(r.led('note', padNote(2, 0))?.color).toBe(COLOR.off); // outside the project
    r.pressPad(1, 2);
    expect(r.ui.sessionRing).toMatchObject({ track: 2, scene: 12 }); // it comes back in: 10 tracks, 20 scenes
    r.advance(1000);
    r.button(r.m.buttons.session!);
    expect(r.led('note', padNote(7, 5))).toMatchObject({ color: paletteIndex('#ff0000') }); // track 10, scene 18
  });

  it('Session opens the mixer: Volume puts the faders on the grid and they move the volume', () => {
    const r = rig('x');
    r.start();
    r.button(r.m.buttons.session!);
    expect(r.led('cc', sceneButton(0))?.color).toBe(COLOR.whiteHalf); // Volume, not chosen
    expect(r.led('cc', sceneButton(2))?.color).toBe(COLOR.off); // the sends aren't there
    const before = r.sysex().length;
    r.pressScene(0);
    const sent = r.sysex().slice(before);
    expect(sent[0].slice(0, 9)).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x01, 0x00, 0x00]);
    expect(sent[1]).toEqual(layoutMessage(r.m, 'volume'));
    expect(r.led('cc', sceneButton(0))?.color).toBe(COLOR.green);
    // track 2's fader: value and colour on channels 5 and 6
    r.settle();
    expect(r.out.filter(m => m[0] === 0xb4 && m[1] === 22).at(-1)?.[2]).toBe(dbToFader(0));
    expect(r.out.filter(m => m[0] === 0xb5 && m[1] === 22).at(-1)?.[2]).toBe(COLOR.green);
    expect(r.out.filter(m => m[0] === 0xb5 && m[1] === 25).at(-1)?.[2]).toBe(COLOR.off); // the track isn't there
    r.cc(22, 40, 4);
    r.cc(22, 60, 4);
    r.lp.tick();
    expect(r.store.project.tracks[1].mixer.volumeDb).toBe(faderToDb(60));
    r.store.undo();
    expect(r.store.project.tracks[1].mixer.volumeDb).toBe(0); // one sweep, one undo
    // Volume again: the grid goes back to Session
    r.pressScene(0);
    expect(r.layouts().at(-1)).toEqual(layoutMessage(r.m, 'session'));
  });

  it("mixer: Mute puts the mutes on the last row, yellow if the track plays", () => {
    const r = rig('x', { clips: [[0, 7]] });
    r.start();
    r.button(r.m.buttons.session!);
    r.advance(1000);
    r.pressScene(5); // Mute
    expect(r.led('note', padNote(0, 7))?.color).toBe(COLOR.yellow);
    r.pressPad(1, 7);
    expect(r.store.project.tracks[1].mixer.mute).toBe(true);
    expect(r.led('note', padNote(1, 7))?.color).toBe(COLOR.yellowHalf);
    expect(r.engine.calls).toEqual([]); // the last row doesn't launch
    r.pressPad(0, 6);
    expect(r.engine.calls).toEqual([`slot ${r.t(0)} 6`]); // the others do
  });

  it('a controller layout (Note, Custom): the grid doesn\'t launch; Session goes back to Session', () => {
    const r = rig('x', { clips: [[0, 0]] });
    r.start();
    r.lp.receive([0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x00, 0x01, 0xf7]);
    r.pressPad(0, 0);
    expect(r.engine.calls).toEqual([]);
    r.button(r.m.buttons.note!);
    expect(r.said.at(-1)).toMatch(/Note mode isn't in studiomio yet/);
    r.button(r.m.buttons.session!);
    expect(r.layouts().at(-1)).toEqual(layoutMessage(r.m, 'session'));
    r.pressPad(0, 0);
    expect(r.engine.calls).toEqual([`slot ${r.t(0)} 0`]);
  });

  it('disconnecting it: LEDs off and out of DAW mode', () => {
    const r = rig('x', { clips: [[0, 0]] });
    r.start();
    r.settle();
    r.lp.stop();
    expect(r.out.at(-1)).toEqual(dawMode(r.m, false));
    expect(r.ui.sessionRing).toBeNull();
  });
});

describe('Launchpad Mini MK3', () => {
  it("Stop Solo Mute cycles the last row's modes; the other scenes launch", () => {
    const r = rig('mini', { clips: [[0, 0]] });
    r.start();
    expect(r.led('cc', sceneButton(7))?.color).toBe(COLOR.whiteHalf);
    r.pressScene(7);
    expect(r.led('cc', sceneButton(7))?.color).toBe(COLOR.red);
    r.engine.states.set(r.t(0), { playing: { slot: 0, clip: 'c' } as never, queued: null, followsArrangement: false });
    expect(r.led('note', padNote(0, 7))?.color).toBe(COLOR.red); // it plays: it can be stopped
    expect(r.led('note', padNote(1, 7))?.color).toBe(COLOR.redHalf);
    r.pressPad(0, 7);
    expect(r.engine.calls).toEqual([`stop ${r.t(0)}`]);
    r.pressScene(7);
    r.pressPad(2, 7);
    expect(r.store.project.tracks[2].mixer.solo).toBe(true);
    r.pressScene(7);
    r.pressScene(7);
    expect(r.led('cc', sceneButton(7))?.color).toBe(COLOR.whiteHalf); // launching again
    r.pressScene(3);
    expect(r.engine.calls.at(-1)).toBe('scene 3');
  });
});

describe('Launchpad Pro MK3', () => {
  it('the row under the grid chooses the track, or does mute, solo, stop', () => {
    const r = rig('pro');
    r.start();
    r.button(102);
    expect(r.ui.track).toBe(r.t(1));
    expect(r.led('cc', 102)?.color).toBe(COLOR.white);
    expect(r.led('cc', 101)?.color).toBe(COLOR.whiteHalf);
    r.button(r.m.buttons.mute!);
    r.button(101);
    expect(r.store.project.tracks[0].mixer.mute).toBe(true);
    r.button(r.m.buttons.mute!); // again: back to choosing
    r.button(103);
    expect(r.ui.track).toBe(r.t(2));
  });

  it('Device: the faders move the device\'s parameters, the scenes choose the bank, ◂ ▸ the device', () => {
    const r = rig('pro');
    r.start();
    r.button(101);
    r.button(r.m.buttons.device!);
    expect(r.layouts().at(-1)).toEqual(layoutMessage(r.m, 'device'));
    const track = r.store.project.tracks[0] as MidiTrack;
    const type = instrumentType(track.instrument.type)!;
    const spec = paramsOf(type)[0];
    r.cc(24, 127, 4); // page 3, first fader
    r.lp.tick();
    const now = resolveParams(type, (r.store.project.tracks[0] as MidiTrack).instrument.params)[spec.id];
    expect(now).toBe(paramFromUnit(spec, 1));
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(0), device: 'instrument' });
    expect(r.led('cc', sceneButton(0))?.color).toBe(COLOR.darkBlue);
    r.button(r.m.buttons.device!);
    expect(r.layouts().at(-1)).toEqual(layoutMessage(r.m, 'session'));
    expect(r.ui.controlledDevice).toBeNull();
  });

  it('Shift: undo, metronome; Play plays', () => {
    const r = rig('pro');
    r.start();
    r.button(r.m.buttons.mute!);
    r.button(101);
    expect(r.store.project.tracks[0].mixer.mute).toBe(true);
    r.cc(r.m.buttons.shift!, 127);
    r.button(r.m.buttons.arm!);
    r.button(r.m.buttons.solo!);
    r.cc(r.m.buttons.shift!, 0);
    expect(r.store.project.tracks[0].mixer.mute).toBe(false);
    expect(r.engine.metronomeOn).toBe(true);
    r.button(r.m.buttons.play!);
    expect(r.engine.playing).toBe(true);
    expect(r.led('cc', r.m.buttons.play!)?.color).toBe(COLOR.green);
  });

  it('Session held: the block map, while it\'s held', () => {
    const r = rig('pro', { tracks: 12 });
    r.start();
    r.cc(r.m.buttons.session!, 127);
    r.pressPad(1, 0);
    r.cc(r.m.buttons.session!, 0);
    expect(r.ui.sessionRing).toMatchObject({ track: 4 }); // 12 tracks: the last box starts from the 5th
    expect(r.engine.calls).toEqual([]);
  });
});

describe('Launchpad MK2', () => {
  it("at startup: identity, challenge as Live, Session layout; the scenes are notes", () => {
    const r = rig('mk2', { clips: [[0, 0]] });
    r.lp.start();
    r.lp.receive(identityReply('mk2'));
    expect(r.out[1].slice(0, 7)).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x40]);
    expect(r.out[1]).toHaveLength(12);
    expect(r.lp.ready).toBe(false);
    r.lp.receive([0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x40, 0x12, 0x34, 0xf7]);
    expect(r.out[2]).toEqual(layoutMessage(r.m, 'session'));
    expect(r.led('note', sceneButton(0))?.color).toBe(COLOR.green);
    r.pressScene(0);
    expect(r.engine.calls).toEqual(['scene 0']);
  });

  it('Mixer: rows of stop, mute, solo; Volume puts the faders, with colour and position', () => {
    const r = rig('mk2');
    r.start();
    r.button(r.m.buttons.mixer!);
    r.pressPad(0, 5);
    expect(r.store.project.tracks[0].mixer.mute).toBe(true);
    r.pressPad(1, 4);
    expect(r.engine.calls).toEqual([`stop ${r.t(1)}`]);
    r.pressScene(5); // removes the mute from all
    expect(r.store.project.tracks[0].mixer.mute).toBe(false);
    r.pressScene(0);
    const faders = r.sysex().filter(m => m[6] === 0x2b);
    expect(faders[0]).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x18, 0x2b, 0, 0, COLOR.green, dbToFader(0), 0xf7]);
    r.cc(21, 30);
    r.lp.tick();
    expect(r.store.project.tracks[0].mixer.volumeDb).toBe(faderToDb(30));
  });

  it('disconnecting it: the message Live leaves with', () => {
    const r = rig('mk2');
    r.start();
    r.lp.stop();
    expect(r.out.at(-1)).toEqual([...MK2_QUIT]);
  });
});
