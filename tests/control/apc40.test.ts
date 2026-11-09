import { describe, expect, it } from 'vitest';
import { FIXED } from '../../src/control/palette';
import { PALETTE } from '../../src/model/colors';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { Apc40, INSTRUMENT_KEY, type DetailView, type SurfaceEngine } from '../../src/control/apc40/apc40';
import {
  CC, COLOR, dbToFader, dongleChallenge, faderToDb, IDENTITY_REQUEST, introduction, ON, TRIGGERED, knobToPan, MODE, NOTE, padAt, padNote, paletteIndex, panToKnob,
} from '../../src/control/apc40/protocol';
import { paramFromUnit, paramToUnit } from '../../src/devices/params';
import { paramsOf, resolveParams } from '../../src/devices/device-type';
import { effectType, instrumentType } from '../../src/devices/registry';
import type { TrackSessionState } from '../../src/engine/session';
import { MidiClip } from '../../src/model/midi-clip';
import { MASTER, Project, type ChainOwner } from '../../src/model/project';
import type { MidiTrack, Track } from '../../src/model/track';
import { addEffect, addTrack, setSlot } from '../../src/store/edits';
import { groupDevices, mapMacro } from '../../src/store/rack-edits';
import { INSTRUMENT_DEVICE, targetKey, type ModTarget } from '../../src/model/envelope';
import { ProjectStore } from '../../src/store/project-store';
import { setSceneColor } from '../../src/store/session-edits';
import { UiState } from '../../src/ui/ui-state';

/** The replies of a real APC40 mkII (from the MIDI monitor). */
const IDENTITY_REPLY = [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x47, 0x29, 0x00, 0x19, 0x00, 0x01, 0x00, 0x01, 0x00, 0x7f, 0x7f, 0x7f, 0x7f, 0x41, 0xf7];
const DONGLE_REPLY = [0xf0, 0x47, 0x00, 0x29, 0x51, 0x00, 0x10, ...Array(16).fill(0), 0xf7];

class FakeEngine implements SurfaceEngine {
  playing = false;
  position = 0;
  metronomeOn = false;
  readonly calls: string[] = [];
  readonly states = new Map<TrackId, TrackSessionState>();
  /** The playing curves: the offset of each target ("owner|key"). */
  readonly curves = new Map<string, number>();
  launchSlot(track: TrackId, slot: number) { this.calls.push(`slot ${track} ${slot}`); }
  launchScene(index: number) { this.calls.push(`scene ${index}`); }
  stopTrack(track: TrackId) { this.calls.push(`stop ${track}`); }
  stopAllClips() { this.calls.push('stop all'); }
  sessionState(track: Track): TrackSessionState {
    return this.states.get(track.id) ?? { playing: null, queued: null, followsArrangement: true };
  }
  modulationAt(owner: ChainOwner, target: ModTarget): number | null {
    return this.curves.get(`${owner}|${targetKey(target)}`) ?? null;
  }
}

/** `tracks` MIDI tracks and `scenes` scenes; a red clip in each slot (t, s) of `clips`. */
function rig(opts: { tracks?: number; scenes?: number; clips?: readonly (readonly [number, number])[] } = {}) {
  const ids = sequentialIds();
  const store = new ProjectStore(Project.empty('t', ids, opts.scenes ?? 8), ids);
  for (let i = 0; i < (opts.tracks ?? 3); i++) store.apply(addTrack('midi'));
  const t = (i: number): TrackId => store.project.tracks[i].id;
  for (const [ti, s] of opts.clips ?? []) store.apply(setSlot(t(ti), s, MidiClip.empty(ids.next('clip'), 'c', '#ff0000', 4)));
  const ui = new UiState();
  const engine = new FakeEngine();
  const said: string[] = [];
  const opened: string[] = [];
  let detail: DetailView = null;
  let clock = 0;
  const out: number[][] = [];
  const host = {
    store, ui, engine,
    togglePlay: () => { engine.playing = !engine.playing; },
    stopAndRewind: () => { engine.playing = false; engine.position = 0; },
    toggleMetronome: () => { engine.metronomeOn = !engine.metronomeOn; },
    openDevices: (owner: ChainOwner) => { detail = 'devices'; opened.push(`devices ${owner}`); },
    openClip: () => { detail = 'clip'; opened.push('clip'); },
    get detail() { return detail; },
    closeDetail: () => { detail = null; },
    say: (text: string) => { said.push(text); },
  };
  const apc = new Apc40(host, data => out.push(data), () => clock);
  /** The startup as with Live: identity (device ID 0), introduction, challenge, reply. */
  const start = () => {
    apc.start();
    apc.receive(IDENTITY_REPLY);
    clock += 250;
    apc.tick();
    apc.receive(DONGLE_REPLY);
  };
  const press = (note: number, channel = 0) => apc.receive([0x90 | channel, note, 127]);
  const release = (note: number, channel = 0) => apc.receive([0x80 | channel, note, 0]);
  const cc = (n: number, value: number, channel = 0) => apc.receive([0xb0 | channel, n, value]);
  /** Rounds until everything waiting has gone out (the messages per round are limited). */
  const settle = () => {
    for (let i = 0, n = -1; i < 50 && n !== out.length; i++) {
      n = out.length;
      apc.tick();
    }
  };
  /** The last value sent to a LED (note) or to a ring (CC). */
  const led = (note: number, channel = 0) => {
    settle();
    return out.filter(m => m[0] === (0x90 | channel) && m[1] === note).at(-1)?.[2];
  };
  /** The last message to a pad: channel (the mode: steady, pulse, blink) and colour. */
  const pad = (note: number) => {
    settle();
    const m = out.filter(x => (x[0] & 0xf0) === 0x90 && x[1] === note).at(-1);
    return m && { mode: m[0] & 0x0f, color: m[2] };
  };
  const ring = (n: number) => {
    settle();
    return out.filter(m => m[0] === 0xb0 && m[1] === n).at(-1)?.[2];
  };
  return {
    store, ui, engine, apc, out, said, start, opened, t, press, release, cc, led, pad, ring, settle,
    advance: (ms: number) => { clock += ms; },
    setDetail: (d: DetailView) => { detail = d; },
  };
}

describe('APC40 mkII protocol', () => {
  it('the introduction puts the controller in Ableton mode', () => {
    expect(introduction()).toEqual([0xf0, 0x47, 0x00, 0x29, 0x60, 0x00, 0x04, 0x41, 11, 0x00, 0x00, 0xf7]);
    expect(introduction(MODE.generic)[7]).toBe(0x40);
  });

  it('grid: the top row is 32..39, the bottom one 0..7', () => {
    expect(padNote(0, 0)).toBe(32);
    expect(padNote(7, 4)).toBe(7);
    for (let n = 0; n < 40; n++) {
      const p = padAt(n)!;
      expect(padNote(p.col, p.row)).toBe(n);
    }
    expect(padAt(40)).toBeNull();
  });

  it('faders as in Live: 0 is silent, 0 dB at 85%, +6 at the top, and back', () => {
    expect(faderToDb(0)).toBeLessThanOrEqual(-70);
    expect(faderToDb(127)).toBe(6);
    expect(Math.abs(faderToDb(dbToFader(0)))).toBeLessThan(0.3);
    for (const v of [10, 40, 80, 108, 120]) expect(dbToFader(faderToDb(v))).toBe(v);
  });

  it('pan: 64 is the centre', () => {
    expect(knobToPan(64)).toBe(0);
    expect(knobToPan(0)).toBe(-1);
    expect(knobToPan(127)).toBe(1);
    for (const v of [0, 20, 64, 100, 127]) expect(panToKnob(knobToPan(v))).toBe(v);
  });

  it('the clip\'s colour goes to the pad of the nearest hue', () => {
    expect(paletteIndex('#ff0000')).toBe(COLOR.red);
    expect(paletteIndex('#00ff00')).toBe(COLOR.green);
    // a dark colour takes the full hue, not an almost off pad
    expect(paletteIndex('#330000')).toBe(COLOR.red);
  });

  it('each colour of the palette has its pad, different from the others', () => {
    const pads = PALETTE.map(paletteIndex);
    expect(PALETTE.every(c => FIXED.has(c))).toBe(true);
    expect(new Set(pads).size).toBe(PALETTE.length);
    expect(paletteIndex(PALETTE[0].toUpperCase())).toBe(pads[0]);
  });
});

describe('APC40 on the session', () => {
  it('on connection, as in Live: identity, introduction with the obtained device ID, challenge, then the LEDs', () => {
    const r = rig({ tracks: 3, clips: [[0, 0]] });
    r.apc.start();
    expect(r.out).toEqual([[...IDENTITY_REQUEST]]);
    r.apc.tick();
    expect(r.out).toHaveLength(1); // waiting for the answer
    r.apc.receive([...IDENTITY_REPLY.slice(0, 13), 0x05, ...IDENTITY_REPLY.slice(14)]); // device ID 5
    expect(r.out[1]).toEqual(introduction(MODE.ableton, 5));
    r.advance(250);
    r.apc.tick();
    const challenge = r.out[2];
    expect(challenge.slice(0, 7)).toEqual([0xf0, 0x47, 0x05, 0x29, 0x50, 0x00, 0x10]);
    expect(challenge).toHaveLength(24);
    expect(r.ui.sessionRing).toBeNull(); // no LEDs or controls before the reply
    r.press(padNote(0, 0));
    expect(r.engine.calls).toEqual([]);
    r.apc.receive([0xf0, 0x47, 0x05, 0x29, 0x51, 0x00, 0x10, ...Array(16).fill(0), 0xf7]);
    expect(r.ui.sessionRing).toEqual({ track: 0, scene: 0, width: 8, height: 5 });
  });

  it("if the controller doesn't respond at startup, it goes on anyway", () => {
    const r = rig();
    r.apc.start();
    r.advance(1100);
    r.apc.tick();
    expect(r.out[1]).toEqual(introduction(MODE.ableton, 0));
    r.advance(250);
    r.apc.tick();
    r.advance(1100);
    r.apc.tick();
    expect(r.apc.ready).toBe(true);
  });

  it('the challenge: two numbers of 8 nibbles', () => {
    expect(dongleChallenge(0, 0x12345678, 0x0abcdef0)).toEqual([
      0xf0, 0x47, 0x00, 0x29, 0x50, 0x00, 0x10, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0, 0xf7,
    ]);
  });

  it("after the startup: 8×5 box at the top left and all the LEDs, lit at 127 as in Live", () => {
    const r = rig({ tracks: 3, clips: [[0, 0]] });
    r.start();
    expect(r.ui.sessionRing).toEqual({ track: 0, scene: 0, width: 8, height: 5 });
    expect(r.led(padNote(0, 0))).toBe(COLOR.red);
    expect(r.led(padNote(1, 0))).toBe(COLOR.off);
    expect(r.led(NOTE.activator, 0)).toBe(ON);
    expect(r.led(NOTE.activator, 5)).toBe(0); // track that doesn't exist
  });

  it('the buttons of the scenes with clips take the scene\'s colour (white if it has none)', () => {
    const r = rig({ tracks: 2, clips: [[0, 0], [1, 1]] });
    r.start();
    r.store.apply(setSceneColor(r.store.project.scenes[1].id, '#ff0000'));
    r.store.apply(setSceneColor(r.store.project.scenes[2].id, '#0000ff')); // empty row: off
    expect(r.led(NOTE.sceneLaunch)).toBe(COLOR.white);
    expect(r.led(NOTE.sceneLaunch + 1)).toBe(COLOR.red);
    expect(r.led(NOTE.sceneLaunch + 2)).toBe(COLOR.off);
  });

  it('sends only the LEDs that change, and in small bursts', () => {
    const r = rig({ clips: [[0, 0]] });
    r.start();
    expect(r.out.length).toBeLessThanOrEqual(3 + 32); // identity, introduction, challenge + a round
    r.settle();
    const n = r.out.length;
    r.apc.tick();
    expect(r.out.length).toBe(n);
  });

  it('the pads launch the box\'s clips, the scenes the rows, the stops stop', () => {
    const r = rig({ tracks: 3 });
    r.start();
    r.press(padNote(1, 2));
    r.press(NOTE.sceneLaunch + 3);
    r.press(NOTE.clipStop, 2);
    r.press(NOTE.stopAllClips);
    r.press(padNote(5, 0)); // no track there
    expect(r.engine.calls).toEqual([`slot ${r.t(1)} 2`, 'scene 3', `stop ${r.t(2)}`, 'stop all']);
  });

  it('arrows: the box moves and stays inside the project; Shift moves by a page', () => {
    const r = rig({ tracks: 20, scenes: 12 });
    r.start();
    expect(r.led(NOTE.up)).toBe(0);
    expect(r.led(NOTE.down)).toBe(ON);
    r.press(NOTE.down);
    r.press(NOTE.right);
    expect(r.ui.sessionRing).toMatchObject({ track: 1, scene: 1 });
    expect(r.led(NOTE.up)).toBe(ON);
    r.press(NOTE.shift);
    r.press(NOTE.right);
    r.press(NOTE.down);
    r.release(NOTE.shift);
    expect(r.ui.sessionRing).toMatchObject({ track: 9, scene: 6 });
    r.press(NOTE.right);
    r.press(NOTE.right);
    r.press(NOTE.right);
    r.press(NOTE.right);
    expect(r.ui.sessionRing).toMatchObject({ track: 12, scene: 6 }); // 20 − 8
    expect(r.led(NOTE.right)).toBe(0);
    expect(r.led(NOTE.down)).toBe(ON); // scene 11 is still below
    // now the first pad is track 12, scene 6
    r.press(padNote(0, 0));
    expect(r.engine.calls).toEqual([`slot ${r.t(12)} 6`]);
  });

  it('Bank on: the arrows go by pages also without Shift', () => {
    const r = rig({ tracks: 20 });
    r.start();
    r.press(NOTE.bank);
    expect(r.led(NOTE.bank)).toBe(ON);
    r.press(NOTE.right);
    expect(r.ui.sessionRing?.track).toBe(8);
  });

  it('Shift + grid: the block map, and a pad brings the box there', () => {
    const r = rig({ tracks: 20, scenes: 12, clips: [[17, 11]] });
    r.start();
    r.press(NOTE.shift);
    expect(r.led(padNote(0, 0))).toBe(COLOR.white); // the box is here
    expect(r.led(padNote(1, 0))).toBe(COLOR.dim);
    expect(r.led(padNote(2, 2))).toBe(COLOR.amber); // the clip of track 17, scene 11
    expect(r.led(padNote(3, 0))).toBe(COLOR.off); // beyond the tracks
    r.press(padNote(2, 2));
    r.release(NOTE.shift);
    expect(r.ui.sessionRing).toMatchObject({ track: 12, scene: 7 }); // it comes back into the project
    expect(r.led(padNote(5, 4))).toBe(COLOR.red); // track 17, scene 11
  });

  it("as in Live: the playing clip is steady green, the queued one blinks (the APC does it), without continuous traffic", () => {
    const r = rig({ clips: [[0, 0], [0, 1]] });
    r.engine.playing = true;
    r.engine.states.set(r.t(0), { playing: { slot: 0, elapsed: 0 }, queued: null, followsArrangement: false });
    r.engine.position = 0.1;
    r.start();
    expect(r.pad(padNote(0, 0))).toEqual({ mode: 0, color: COLOR.green });
    expect(r.pad(padNote(0, 1))).toEqual({ mode: 0, color: COLOR.red });
    expect(r.led(NOTE.clipStop, 0)).toBe(1); // the stops have their own scale: 1 on
    expect(r.led(NOTE.stopAllClips)).toBe(ON);
    // time passes: nothing is sent
    const n = r.out.length;
    for (let beat = 0.1; beat < 8; beat += 0.05) {
      r.engine.position = beat;
      r.apc.tick();
    }
    expect(r.out.length).toBe(n);
    // a launch: the queued clip blinks
    r.engine.states.set(r.t(0), { playing: { slot: 0, elapsed: 0 }, queued: { slot: 1 }, followsArrangement: false });
    // like Live's Blink(GREEN, BLACK, 24): green on channel 0, off on channel 14
    r.settle();
    expect(r.out.filter(m => (m[0] & 0xf0) === 0x90 && m[1] === padNote(0, 1)).slice(-2)).toEqual([[0x90, padNote(0, 1), COLOR.green], [0x9e, padNote(0, 1), 0]]);
    // also the scene (RGB button) blinks the same way
    expect(r.out.filter(m => m[1] === NOTE.sceneLaunch + 1).slice(-2)).toEqual([[0x90, NOTE.sceneLaunch + 1, COLOR.green], [0x9e, NOTE.sceneLaunch + 1, 0]]);
    void TRIGGERED;
    // it starts: now it pulses, the other goes back to its colour
    r.engine.states.set(r.t(0), { playing: { slot: 1, elapsed: 0 }, queued: null, followsArrangement: false });
    expect(r.pad(padNote(0, 1))).toEqual({ mode: 0, color: COLOR.green });
    expect(r.pad(padNote(0, 0))).toEqual({ mode: 0, color: COLOR.red });
  });

  it('the scene one of whose clips plays is steady green, also two scenes together', () => {
    const r = rig({ tracks: 3, clips: [[0, 0], [1, 0], [0, 1]] });
    r.engine.playing = true;
    r.engine.states.set(r.t(0), { playing: { slot: 0, elapsed: 0 }, queued: null, followsArrangement: false });
    r.engine.states.set(r.t(1), { playing: { slot: 0, elapsed: 0 }, queued: null, followsArrangement: false });
    r.start();
    r.settle();
    r.store.apply(setSceneColor(r.store.project.scenes[1].id, '#ff0000'));
    expect(r.led(NOTE.sceneLaunch)).toBe(COLOR.green);
    expect(r.led(NOTE.sceneLaunch + 1)).toBe(COLOR.red);
    // track 1 switches to the clip of scene 2: both light up, without animations
    r.engine.states.set(r.t(0), { playing: { slot: 1, elapsed: 0 }, queued: null, followsArrangement: false });
    r.settle();
    expect(r.led(NOTE.sceneLaunch)).toBe(COLOR.green);
    expect(r.led(NOTE.sceneLaunch + 1)).toBe(COLOR.green);
    expect(r.out.filter(m => m[1] === NOTE.sceneLaunch || m[1] === NOTE.sceneLaunch + 1).every(m => m[0] === 0x90)).toBe(true);
    // nothing of scene 1 plays any more: it goes back to white (it has clips but no colour)
    r.engine.states.set(r.t(1), { playing: null, queued: null, followsArrangement: false });
    r.settle();
    expect(r.led(NOTE.sceneLaunch)).toBe(COLOR.white);
  });

  it('activator and solo change the mixer, and the LEDs follow it', () => {
    const r = rig();
    r.start();
    r.press(NOTE.activator, 1);
    r.press(NOTE.solo, 2);
    expect(r.store.project.tracks[1].mixer.mute).toBe(true);
    expect(r.store.project.tracks[2].mixer.solo).toBe(true);
    expect(r.led(NOTE.activator, 1)).toBe(0);
    expect(r.led(NOTE.solo, 2)).toBe(ON);
  });

  it('faders: the last value is applied at every round, and a sweep is a single undo', () => {
    const r = rig();
    r.start();
    r.advance(1000);
    r.cc(CC.trackFader, 20, 1);
    r.cc(CC.trackFader, 60, 1);
    r.apc.tick();
    expect(r.store.project.tracks[1].mixer.volumeDb).toBe(faderToDb(60));
    r.advance(50);
    r.cc(CC.trackFader, 127, 1);
    r.apc.tick();
    r.cc(CC.masterFader, 0);
    r.apc.tick();
    expect(r.store.project.tracks[1].mixer.volumeDb).toBe(6);
    expect(r.store.project.master.volumeDb).toBeLessThanOrEqual(-70);
    r.advance(1000);
    r.apc.tick();
    r.store.undo();
    r.store.undo();
    expect(r.store.project.tracks[1].mixer.volumeDb).toBe(0);
  });

  it('right after connecting the faders\' positions don\'t touch the project', () => {
    const r = rig();
    r.start();
    r.cc(CC.trackFader, 0, 0);
    r.apc.tick();
    expect(r.store.project.tracks[0].mixer.volumeDb).toBe(0);
  });

  it('top knobs: the pan, with the ring lit', () => {
    const r = rig();
    r.start();
    expect(r.ring(CC.trackRing)).toBe(3);
    expect(r.ring(CC.trackRing + 5)).toBe(0);
    expect(r.ring(CC.trackKnob)).toBe(64);
    r.advance(1000);
    r.cc(CC.trackKnob + 2, 0);
    r.apc.tick();
    expect(r.store.project.tracks[2].mixer.pan).toBe(-1);
  });

  it('while a knob is turned its value isn\'t sent back; still, it\'s aligned to the parameter', () => {
    const r = rig();
    r.start();
    r.press(NOTE.trackSelect, 0);
    r.settle();
    r.advance(1000);
    const track = r.store.project.tracks[0] as MidiTrack;
    const synth = instrumentType(track.instrument.type)!;
    // a choice parameter: the rounded value isn't the knob's
    const i = paramsOf(synth).slice(0, 8).findIndex(p => p.kind === 'choice');
    expect(i).toBeGreaterThanOrEqual(0);
    const spec = paramsOf(synth)[i];
    const n = r.out.length;
    r.cc(CC.deviceKnob + i, 70);
    r.apc.tick();
    r.advance(100);
    r.cc(CC.deviceKnob + i, 71);
    r.apc.tick();
    expect(r.out.slice(n).filter(m => m[0] === 0xb0 && m[1] === CC.deviceKnob + i)).toEqual([]);
    r.advance(400);
    const aligned = Math.round(paramToUnit(spec, paramFromUnit(spec, 71 / 127)) * 127);
    if (aligned !== 71) expect(r.ring(CC.deviceKnob + i)).toBe(aligned);
  });

  it('an error in the round doesn\'t stop the controller and is said only once', () => {
    const r = rig();
    r.start();
    r.settle();
    const real = r.engine.sessionState.bind(r.engine);
    r.engine.sessionState = () => { throw new Error('broken'); };
    r.apc.tick();
    r.apc.tick();
    expect(r.said.filter(t => t.includes('broken'))).toHaveLength(1);
    r.engine.sessionState = real;
    r.press(NOTE.activator, 0);
    expect(r.store.project.tracks[0].mixer.mute).toBe(true);
  });

  it('Track Select chooses the track; Master the master', () => {
    const r = rig();
    r.start();
    r.press(NOTE.trackSelect, 2);
    expect(r.ui.track).toBe(r.t(2));
    expect(r.led(NOTE.trackSelect, 2)).toBe(ON);
    r.press(NOTE.master);
    expect(r.ui.track).toBeNull();
    expect(r.led(NOTE.master)).toBe(ON);
    expect(r.led(NOTE.trackSelect, 2)).toBe(0);
    // from the app: choosing a track removes the master
    r.ui.selectTrack(r.t(0));
    r.apc.tick();
    expect(r.led(NOTE.master)).toBe(0);
    expect(r.led(NOTE.trackSelect, 0)).toBe(ON);
  });

  it('Device Control: the 8 knobs move the instrument, then the effects, in banks of 8', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    r.start();
    expect(r.ring(CC.deviceRing)).toBe(0); // no track chosen
    r.press(NOTE.trackSelect, 0);
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(0), device: INSTRUMENT_KEY });
    const track = r.store.project.tracks[0] as MidiTrack;
    const synth = instrumentType(track.instrument.type)!;
    const first = paramsOf(synth)[0];
    expect(r.ring(CC.deviceKnob)).toBe(Math.round(paramToUnit(first, resolveParams(synth, {})[first.id]) * 127));
    r.advance(1000);
    r.cc(CC.deviceKnob, 127);
    r.apc.tick();
    expect((r.store.project.tracks[0] as MidiTrack).instrument.params[first.id]).toBe(paramFromUnit(first, 1));

    // banks: the knobs move to parameters 9..16
    expect(r.led(NOTE.bankRight)).toBe(paramsOf(synth).length > 8 ? ON : 0);
    r.press(NOTE.bankRight);
    if (paramsOf(synth).length > 8) expect(r.said.at(-1)).toContain('bank 2');

    // to the next device: the delay
    r.press(NOTE.deviceRight);
    const delayId = r.store.project.tracks[0].effects[0].id;
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(0), device: delayId });
    expect(r.opened.at(-1)).toBe(`devices ${r.t(0)}`);
    expect(r.led(NOTE.deviceRight)).toBe(0);
    expect(r.led(NOTE.deviceLeft)).toBe(ON);
    const delay = paramsOf(effectType('delay')!);
    r.cc(CC.deviceKnob + 4, 0); // the delay's fifth parameter: the feedback
    r.apc.tick();
    expect(r.store.project.tracks[0].effects[0].params[delay[4].id]).toBe(paramFromUnit(delay[4], 0));
    // Device On/Off turns the effect off
    expect(r.led(NOTE.deviceOnOff)).toBe(ON);
    r.press(NOTE.deviceOnOff);
    expect(r.store.project.tracks[0].effects[0].enabled).toBe(false);
    expect(r.led(NOTE.deviceOnOff)).toBe(0);
  });

  it('a rack is the first device: the 8 knobs move the macros, and the macros the mapped parameters', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    const delay = r.store.project.tracks[0].effects[0].id;
    r.store.apply(groupDevices(r.t(0), [INSTRUMENT_DEVICE, delay]));
    const rack = r.store.project.tracks[0].racks[0];
    r.store.apply(mapMacro(r.t(0), rack.id, 1, delay, 'mix'));
    r.start();
    r.press(NOTE.trackSelect, 0);
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(0), device: rack.id });
    expect(r.said.length).toBe(0);
    expect(r.ring(CC.deviceKnob + 1)).toBe(Math.round(0.3 * 127)); // the delay's mix is at 30%
    r.advance(1000);
    r.cc(CC.deviceKnob + 1, 127);
    r.apc.tick();
    expect(r.store.project.tracks[0].racks[0].macros[1].value).toBe(127);
    expect(r.store.project.tracks[0].effects[0].params.mix).toBe(100);
    // after the rack, its devices; a mapped parameter doesn't move from its knob
    r.press(NOTE.deviceRight);
    r.press(NOTE.deviceRight);
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(0), device: delay });
    const mix = paramsOf(effectType('delay')!).findIndex(p => p.id === 'mix');
    r.cc(CC.deviceKnob + mix, 0);
    r.apc.tick();
    expect(r.store.project.tracks[0].effects[0].params.mix).toBe(100);
    expect(r.said.at(-1)).toContain('macro 2');
  });

  it('with a device chosen, shortly after all the Device rings are resent (the APC40 may lose the first ones)', () => {
    const r = rig();
    r.start();
    const knobs = () => r.out.filter(m => m[0] === 0xb0 && m[1] >= CC.deviceKnob && m[1] < CC.deviceRing + 8).length;
    r.press(NOTE.trackSelect, 0);
    r.settle();
    const first = knobs();
    expect(first).toBe(16); // type and value of the 8 knobs
    r.release(NOTE.trackSelect, 0);
    r.settle();
    expect(knobs()).toBe(first); // not right away
    r.advance(300);
    r.settle();
    expect(knobs()).toBe(first + 16); // then all, also those that stayed the same
    r.advance(1000);
    r.settle();
    expect(knobs()).toBe(first + 16); // and only once
    // to the next device: its rings, and again shortly after
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    r.press(NOTE.deviceRight);
    r.settle();
    const moved = knobs();
    r.advance(300);
    r.settle();
    expect(knobs()).toBe(moved + 16);
  });

  it('with a playing curve the ring shows the value that\'s heard, and the knob starts from there', () => {
    const r = rig();
    r.start();
    r.press(NOTE.trackSelect, 0);
    const synth = instrumentType((r.store.project.tracks[0] as MidiTrack).instrument.type)!;
    const i = paramsOf(synth).slice(0, 8).findIndex(p => p.kind === 'number');
    const spec = paramsOf(synth)[i];
    const base = paramToUnit(spec, resolveParams(synth, {})[spec.id]);
    expect(r.ring(CC.deviceKnob + i)).toBe(Math.round(base * 127));
    const offset = base > 0.5 ? -0.25 : 0.25;
    r.engine.curves.set(`${r.t(0)}|instrument:${spec.id}`, offset);
    expect(r.ring(CC.deviceKnob + i)).toBe(Math.round((base + offset) * 127));
    // turned: the parameter goes where needed for the knob's value to be heard
    r.advance(1000);
    const heard = Math.round((base + offset) * 127) + 3;
    r.cc(CC.deviceKnob + i, heard);
    r.apc.tick();
    expect((r.store.project.tracks[0] as MidiTrack).instrument.params[spec.id]).toBeCloseTo(paramFromUnit(spec, heard / 127 - offset), 9);
    // the curve over the ring goes back to the parameter
    r.engine.curves.delete(`${r.t(0)}|instrument:${spec.id}`);
    r.advance(1000);
    expect(r.ring(CC.deviceKnob + i)).toBe(Math.round(paramToUnit(spec, paramFromUnit(spec, heard / 127 - offset)) * 127));
  });

  it('a curve on a macro: the macro\'s ring follows it', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    const delay = r.store.project.tracks[0].effects[0].id;
    r.store.apply(groupDevices(r.t(0), [INSTRUMENT_DEVICE, delay]));
    const rack = r.store.project.tracks[0].racks[0];
    r.store.apply(mapMacro(r.t(0), rack.id, 2, delay, 'mix'));
    r.start();
    r.press(NOTE.trackSelect, 0);
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(0), device: rack.id });
    const before = r.ring(CC.deviceKnob + 2)!;
    r.engine.curves.set(`${r.t(0)}|${rack.id}:macro3`, 0.5); // the third macro
    const macro = r.store.project.tracks[0].racks[0].macros[2].value / 127;
    expect(r.ring(CC.deviceKnob + 2)).toBe(Math.round(Math.min(1, macro + 0.5) * 127));
    expect(r.ring(CC.deviceKnob + 2)).not.toBe(before);
  });

  it('Device Lock: the knobs stay on the device even changing track', () => {
    const r = rig();
    r.store.apply(addEffect(MASTER, 'eq', 'EQ'));
    r.start();
    r.press(NOTE.master);
    const eq = r.store.project.masterEffects[0].id;
    expect(r.ui.controlledDevice).toEqual({ owner: MASTER, device: eq });
    r.press(NOTE.deviceLock);
    r.press(NOTE.trackSelect, 1);
    expect(r.ui.controlledDevice).toEqual({ owner: MASTER, device: eq });
    expect(r.led(NOTE.deviceLock)).toBe(ON);
    r.press(NOTE.deviceLock);
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(1), device: INSTRUMENT_KEY });
  });

  it('transport, metronome and tempo', () => {
    const r = rig();
    r.start();
    r.press(NOTE.play);
    expect(r.engine.playing).toBe(true);
    expect(r.led(NOTE.play)).toBe(ON);
    r.press(NOTE.metronome);
    expect(r.led(NOTE.metronome)).toBe(ON);
    r.cc(CC.tempo, 3);
    r.cc(CC.tempo, 127);
    r.apc.tick();
    expect(r.store.project.tempo.bpm).toBe(122);
    r.press(NOTE.shift);
    r.cc(CC.tempo, 5);
    r.apc.tick();
    expect(r.store.project.tempo.bpm).toBe(122.5);
    r.press(NOTE.play); // Shift + Play: stops and goes back to the start
    expect(r.engine.playing).toBe(false);
  });

  it('Tap Tempo: the tempo from the hits', () => {
    const r = rig();
    r.start();
    for (let i = 0; i < 4; i++) {
      r.press(NOTE.tapTempo);
      r.advance(500);
    }
    r.apc.tick();
    expect(r.store.project.tempo.bpm).toBe(120);
    r.advance(3000); // after a pause the count restarts
    for (let i = 0; i < 3; i++) {
      r.press(NOTE.tapTempo);
      r.advance(400);
    }
    expect(r.store.project.tempo.bpm).toBe(150);
  });

  it('Clip/Device View and Detail View open and close the bottom area', () => {
    const r = rig({ clips: [[0, 2]] });
    r.start();
    r.press(NOTE.trackSelect, 0);
    r.press(NOTE.detailView);
    expect(r.opened).toEqual([`devices ${r.t(0)}`]);
    expect(r.led(NOTE.detailView)).toBe(ON);
    r.press(NOTE.clipDeviceView);
    expect(r.opened.at(-1)).toBe('clip');
    r.press(NOTE.detailView);
    expect(r.led(NOTE.detailView)).toBe(0);
  });

  it('what studiomio doesn\'t have yet it says in the status bar', () => {
    const r = rig();
    r.start();
    r.press(NOTE.recordArm, 0);
    expect(r.said.at(-1)).toContain('Record arm');
    expect(r.led(NOTE.recordArm, 0)).toBe(0);
  });

  it('the box comes back in if tracks are removed', () => {
    const r = rig({ tracks: 12 });
    r.start();
    r.press(NOTE.shift);
    r.press(NOTE.right);
    r.release(NOTE.shift);
    expect(r.ui.sessionRing?.track).toBe(4);
    const p = r.store.project;
    r.store.load(Project.create({
      id: p.id, name: p.name, tempo: p.tempo, signature: p.signature, tracks: p.tracks.slice(0, 9), scenes: p.scenes,
      samples: p.samples, loop: p.loop, master: p.master, masterEffects: p.masterEffects, launchQuantization: p.launchQuantization,
    }));
    r.apc.tick();
    expect(r.ui.sessionRing?.track).toBe(1);
  });

  it('disconnecting it: LEDs off, generic mode, no box', () => {
    const r = rig({ clips: [[0, 0]] });
    r.start();
    r.settle();
    r.apc.stop();
    expect(r.led(padNote(0, 0))).toBe(0);
    expect(r.led(NOTE.activator, 0)).toBe(0);
    expect(r.out.at(-1)).toEqual(introduction(MODE.generic));
    expect(r.ui.sessionRing).toBeNull();
    expect(r.ui.controlledDevice).toBeNull();
  });
});
