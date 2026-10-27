import { describe, expect, it } from 'vitest';
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

/** Le risposte di un APC40 mkII vero (dal monitor MIDI). */
const IDENTITY_REPLY = [0xf0, 0x7e, 0x00, 0x06, 0x02, 0x47, 0x29, 0x00, 0x19, 0x00, 0x01, 0x00, 0x01, 0x00, 0x7f, 0x7f, 0x7f, 0x7f, 0x41, 0xf7];
const DONGLE_REPLY = [0xf0, 0x47, 0x00, 0x29, 0x51, 0x00, 0x10, ...Array(16).fill(0), 0xf7];

class FakeEngine implements SurfaceEngine {
  playing = false;
  position = 0;
  metronomeOn = false;
  readonly calls: string[] = [];
  readonly states = new Map<TrackId, TrackSessionState>();
  /** Le curve che suonano: lo spostamento di ogni bersaglio ("proprietario|chiave"). */
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

/** `tracks` tracce MIDI e `scenes` scene; una clip rossa in ogni slot (t, s) di `clips`. */
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
  /** L'avvio come con Live: identità (device ID 0), presentazione, challenge, risposta. */
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
  /** Giri finché tutto ciò che è in attesa è partito (i messaggi per giro sono limitati). */
  const settle = () => {
    for (let i = 0, n = -1; i < 50 && n !== out.length; i++) {
      n = out.length;
      apc.tick();
    }
  };
  /** L'ultimo valore mandato a un LED (nota) o a un anello (CC). */
  const led = (note: number, channel = 0) => {
    settle();
    return out.filter(m => m[0] === (0x90 | channel) && m[1] === note).at(-1)?.[2];
  };
  /** L'ultimo messaggio a un pad: canale (il modo: fisso, pulsa, lampeggia) e colore. */
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

describe('protocollo APC40 mkII', () => {
  it('la presentazione mette il controller in Ableton mode', () => {
    expect(introduction()).toEqual([0xf0, 0x47, 0x00, 0x29, 0x60, 0x00, 0x04, 0x41, 11, 0x00, 0x00, 0xf7]);
    expect(introduction(MODE.generic)[7]).toBe(0x40);
  });

  it('griglia: la riga in alto è 32..39, quella in basso 0..7', () => {
    expect(padNote(0, 0)).toBe(32);
    expect(padNote(7, 4)).toBe(7);
    for (let n = 0; n < 40; n++) {
      const p = padAt(n)!;
      expect(padNote(p.col, p.row)).toBe(n);
    }
    expect(padAt(40)).toBeNull();
  });

  it('fader come in Live: 0 tace, 0 dB all\'85%, +6 in cima, e torna indietro', () => {
    expect(faderToDb(0)).toBeLessThanOrEqual(-70);
    expect(faderToDb(127)).toBe(6);
    expect(Math.abs(faderToDb(dbToFader(0)))).toBeLessThan(0.3);
    for (const v of [10, 40, 80, 108, 120]) expect(dbToFader(faderToDb(v))).toBe(v);
  });

  it('pan: 64 è il centro', () => {
    expect(knobToPan(64)).toBe(0);
    expect(knobToPan(0)).toBe(-1);
    expect(knobToPan(127)).toBe(1);
    for (const v of [0, 20, 64, 100, 127]) expect(panToKnob(knobToPan(v))).toBe(v);
  });

  it('il colore della clip va al pad della tinta più vicina', () => {
    expect(paletteIndex('#ff0000')).toBe(COLOR.red);
    expect(paletteIndex('#00ff00')).toBe(COLOR.green);
    // un colore scuro prende la tinta piena, non un pad quasi spento
    expect(paletteIndex('#330000')).toBe(COLOR.red);
  });
});

describe('APC40 sulla session', () => {
  it('al collegamento, come Live: identità, presentazione col device ID avuto, challenge, poi i LED', () => {
    const r = rig({ tracks: 3, clips: [[0, 0]] });
    r.apc.start();
    expect(r.out).toEqual([[...IDENTITY_REQUEST]]);
    r.apc.tick();
    expect(r.out).toHaveLength(1); // si aspetta la risposta
    r.apc.receive([...IDENTITY_REPLY.slice(0, 13), 0x05, ...IDENTITY_REPLY.slice(14)]); // device ID 5
    expect(r.out[1]).toEqual(introduction(MODE.ableton, 5));
    r.advance(250);
    r.apc.tick();
    const challenge = r.out[2];
    expect(challenge.slice(0, 7)).toEqual([0xf0, 0x47, 0x05, 0x29, 0x50, 0x00, 0x10]);
    expect(challenge).toHaveLength(24);
    expect(r.ui.sessionRing).toBeNull(); // niente LED né controlli prima della risposta
    r.press(padNote(0, 0));
    expect(r.engine.calls).toEqual([]);
    r.apc.receive([0xf0, 0x47, 0x05, 0x29, 0x51, 0x00, 0x10, ...Array(16).fill(0), 0xf7]);
    expect(r.ui.sessionRing).toEqual({ track: 0, scene: 0, width: 8, height: 5 });
  });

  it("se il controller non risponde all'avvio, si va avanti lo stesso", () => {
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

  it('la challenge: due numeri a 8 nibble', () => {
    expect(dongleChallenge(0, 0x12345678, 0x0abcdef0)).toEqual([
      0xf0, 0x47, 0x00, 0x29, 0x50, 0x00, 0x10, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0, 0xf7,
    ]);
  });

  it("dopo l'avvio: riquadro 8×5 in alto a sinistra e tutti i LED, accesi a 127 come in Live", () => {
    const r = rig({ tracks: 3, clips: [[0, 0]] });
    r.start();
    expect(r.ui.sessionRing).toEqual({ track: 0, scene: 0, width: 8, height: 5 });
    expect(r.led(padNote(0, 0))).toBe(COLOR.red);
    expect(r.led(padNote(1, 0))).toBe(COLOR.off);
    expect(r.led(NOTE.activator, 0)).toBe(ON);
    expect(r.led(NOTE.activator, 5)).toBe(0); // traccia che non c'è
  });

  it('i pulsanti delle scene con clip prendono il colore della scena (bianchi se non ne ha)', () => {
    const r = rig({ tracks: 2, clips: [[0, 0], [1, 1]] });
    r.start();
    r.store.apply(setSceneColor(r.store.project.scenes[1].id, '#ff0000'));
    r.store.apply(setSceneColor(r.store.project.scenes[2].id, '#0000ff')); // riga vuota: spento
    expect(r.led(NOTE.sceneLaunch)).toBe(COLOR.white);
    expect(r.led(NOTE.sceneLaunch + 1)).toBe(COLOR.red);
    expect(r.led(NOTE.sceneLaunch + 2)).toBe(COLOR.off);
  });

  it('manda solo i LED che cambiano, e a piccole raffiche', () => {
    const r = rig({ clips: [[0, 0]] });
    r.start();
    expect(r.out.length).toBeLessThanOrEqual(3 + 32); // identità, presentazione, challenge + un giro
    r.settle();
    const n = r.out.length;
    r.apc.tick();
    expect(r.out.length).toBe(n);
  });

  it('i pad lanciano le clip del riquadro, le scene le righe, gli stop fermano', () => {
    const r = rig({ tracks: 3 });
    r.start();
    r.press(padNote(1, 2));
    r.press(NOTE.sceneLaunch + 3);
    r.press(NOTE.clipStop, 2);
    r.press(NOTE.stopAllClips);
    r.press(padNote(5, 0)); // nessuna traccia lì
    expect(r.engine.calls).toEqual([`slot ${r.t(1)} 2`, 'scene 3', `stop ${r.t(2)}`, 'stop all']);
  });

  it('frecce: il riquadro si sposta e resta dentro il progetto; Shift sposta di una pagina', () => {
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
    expect(r.led(NOTE.down)).toBe(ON); // la scena 11 è ancora sotto
    // ora il primo pad è la traccia 12, scena 6
    r.press(padNote(0, 0));
    expect(r.engine.calls).toEqual([`slot ${r.t(12)} 6`]);
  });

  it('Bank acceso: le frecce vanno a pagine anche senza Shift', () => {
    const r = rig({ tracks: 20 });
    r.start();
    r.press(NOTE.bank);
    expect(r.led(NOTE.bank)).toBe(ON);
    r.press(NOTE.right);
    expect(r.ui.sessionRing?.track).toBe(8);
  });

  it('Shift + griglia: la mappa dei blocchi, e un pad porta lì il riquadro', () => {
    const r = rig({ tracks: 20, scenes: 12, clips: [[17, 11]] });
    r.start();
    r.press(NOTE.shift);
    expect(r.led(padNote(0, 0))).toBe(COLOR.white); // il riquadro è qui
    expect(r.led(padNote(1, 0))).toBe(COLOR.dim);
    expect(r.led(padNote(2, 2))).toBe(COLOR.amber); // la clip della traccia 17, scena 11
    expect(r.led(padNote(3, 0))).toBe(COLOR.off); // oltre le tracce
    r.press(padNote(2, 2));
    r.release(NOTE.shift);
    expect(r.ui.sessionRing).toMatchObject({ track: 12, scene: 7 }); // rientra nel progetto
    expect(r.led(padNote(5, 4))).toBe(COLOR.red); // traccia 17, scena 11
  });

  it("come in Live: la clip che suona è verde fisso, quella in coda lampeggia (lo fa l'APC), senza traffico continuo", () => {
    const r = rig({ clips: [[0, 0], [0, 1]] });
    r.engine.playing = true;
    r.engine.states.set(r.t(0), { playing: { slot: 0, elapsed: 0 }, queued: null, followsArrangement: false });
    r.engine.position = 0.1;
    r.start();
    expect(r.pad(padNote(0, 0))).toEqual({ mode: 0, color: COLOR.green });
    expect(r.pad(padNote(0, 1))).toEqual({ mode: 0, color: COLOR.red });
    expect(r.led(NOTE.clipStop, 0)).toBe(1); // gli stop hanno la loro scala: 1 acceso
    expect(r.led(NOTE.stopAllClips)).toBe(ON);
    // il tempo scorre: non si manda niente
    const n = r.out.length;
    for (let beat = 0.1; beat < 8; beat += 0.05) {
      r.engine.position = beat;
      r.apc.tick();
    }
    expect(r.out.length).toBe(n);
    // un lancio: la clip in coda lampeggia
    r.engine.states.set(r.t(0), { playing: { slot: 0, elapsed: 0 }, queued: { slot: 1 }, followsArrangement: false });
    // come Blink(GREEN, BLACK, 24) di Live: verde sul canale 0, spento sul canale 14
    r.settle();
    expect(r.out.filter(m => (m[0] & 0xf0) === 0x90 && m[1] === padNote(0, 1)).slice(-2)).toEqual([[0x90, padNote(0, 1), COLOR.green], [0x9e, padNote(0, 1), 0]]);
    // anche la scena (pulsante RGB) lampeggia allo stesso modo
    expect(r.out.filter(m => m[1] === NOTE.sceneLaunch + 1).slice(-2)).toEqual([[0x90, NOTE.sceneLaunch + 1, COLOR.green], [0x9e, NOTE.sceneLaunch + 1, 0]]);
    void TRIGGERED;
    // parte: ora pulsa lei, l'altra torna al suo colore
    r.engine.states.set(r.t(0), { playing: { slot: 1, elapsed: 0 }, queued: null, followsArrangement: false });
    expect(r.pad(padNote(0, 1))).toEqual({ mode: 0, color: COLOR.green });
    expect(r.pad(padNote(0, 0))).toEqual({ mode: 0, color: COLOR.red });
  });

  it('la scena di cui suona una clip è verde fissa, anche due scene insieme', () => {
    const r = rig({ tracks: 3, clips: [[0, 0], [1, 0], [0, 1]] });
    r.engine.playing = true;
    r.engine.states.set(r.t(0), { playing: { slot: 0, elapsed: 0 }, queued: null, followsArrangement: false });
    r.engine.states.set(r.t(1), { playing: { slot: 0, elapsed: 0 }, queued: null, followsArrangement: false });
    r.start();
    r.settle();
    r.store.apply(setSceneColor(r.store.project.scenes[1].id, '#ff0000'));
    expect(r.led(NOTE.sceneLaunch)).toBe(COLOR.green);
    expect(r.led(NOTE.sceneLaunch + 1)).toBe(COLOR.red);
    // la traccia 1 passa alla clip della scena 2: si accendono tutte e due, senza animazioni
    r.engine.states.set(r.t(0), { playing: { slot: 1, elapsed: 0 }, queued: null, followsArrangement: false });
    r.settle();
    expect(r.led(NOTE.sceneLaunch)).toBe(COLOR.green);
    expect(r.led(NOTE.sceneLaunch + 1)).toBe(COLOR.green);
    expect(r.out.filter(m => m[1] === NOTE.sceneLaunch || m[1] === NOTE.sceneLaunch + 1).every(m => m[0] === 0x90)).toBe(true);
    // della scena 1 non suona più niente: torna bianca (ha clip ma nessun colore)
    r.engine.states.set(r.t(1), { playing: null, queued: null, followsArrangement: false });
    r.settle();
    expect(r.led(NOTE.sceneLaunch)).toBe(COLOR.white);
  });

  it('activator e solo cambiano il mixer, e i LED lo seguono', () => {
    const r = rig();
    r.start();
    r.press(NOTE.activator, 1);
    r.press(NOTE.solo, 2);
    expect(r.store.project.tracks[1].mixer.mute).toBe(true);
    expect(r.store.project.tracks[2].mixer.solo).toBe(true);
    expect(r.led(NOTE.activator, 1)).toBe(0);
    expect(r.led(NOTE.solo, 2)).toBe(ON);
  });

  it('fader: si applica l\'ultimo valore a ogni giro, e una corsa è un solo annullamento', () => {
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

  it('subito dopo il collegamento le posizioni dei fader non toccano il progetto', () => {
    const r = rig();
    r.start();
    r.cc(CC.trackFader, 0, 0);
    r.apc.tick();
    expect(r.store.project.tracks[0].mixer.volumeDb).toBe(0);
  });

  it('manopole in alto: il pan, con l\'anello acceso', () => {
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

  it('mentre si gira una manopola non le si rimanda il valore; ferma, la si allinea al parametro', () => {
    const r = rig();
    r.start();
    r.press(NOTE.trackSelect, 0);
    r.settle();
    r.advance(1000);
    const track = r.store.project.tracks[0] as MidiTrack;
    const synth = instrumentType(track.instrument.type)!;
    // un parametro a scelte: il valore arrotondato non è quello della manopola
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

  it('un errore nel giro non ferma il controller e si dice una volta sola', () => {
    const r = rig();
    r.start();
    r.settle();
    const real = r.engine.sessionState.bind(r.engine);
    r.engine.sessionState = () => { throw new Error('rotto'); };
    r.apc.tick();
    r.apc.tick();
    expect(r.said.filter(t => t.includes('rotto'))).toHaveLength(1);
    r.engine.sessionState = real;
    r.press(NOTE.activator, 0);
    expect(r.store.project.tracks[0].mixer.mute).toBe(true);
  });

  it('Track Select sceglie la traccia; Master il master', () => {
    const r = rig();
    r.start();
    r.press(NOTE.trackSelect, 2);
    expect(r.ui.track).toBe(r.t(2));
    expect(r.led(NOTE.trackSelect, 2)).toBe(ON);
    r.press(NOTE.master);
    expect(r.ui.track).toBeNull();
    expect(r.led(NOTE.master)).toBe(ON);
    expect(r.led(NOTE.trackSelect, 2)).toBe(0);
    // dall'app: scegliere una traccia toglie il master
    r.ui.selectTrack(r.t(0));
    r.apc.tick();
    expect(r.led(NOTE.master)).toBe(0);
    expect(r.led(NOTE.trackSelect, 0)).toBe(ON);
  });

  it('Device Control: le 8 manopole muovono lo strumento, poi gli effetti, a banchi di 8', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    r.start();
    expect(r.ring(CC.deviceRing)).toBe(0); // nessuna traccia scelta
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

    // banchi: le manopole passano ai parametri 9..16
    expect(r.led(NOTE.bankRight)).toBe(paramsOf(synth).length > 8 ? ON : 0);
    r.press(NOTE.bankRight);
    if (paramsOf(synth).length > 8) expect(r.said.at(-1)).toContain('banco 2');

    // al dispositivo dopo: il delay
    r.press(NOTE.deviceRight);
    const delayId = r.store.project.tracks[0].effects[0].id;
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(0), device: delayId });
    expect(r.opened.at(-1)).toBe(`devices ${r.t(0)}`);
    expect(r.led(NOTE.deviceRight)).toBe(0);
    expect(r.led(NOTE.deviceLeft)).toBe(ON);
    const delay = paramsOf(effectType('delay')!);
    r.cc(CC.deviceKnob + 4, 0); // il quinto parametro del delay: il feedback
    r.apc.tick();
    expect(r.store.project.tracks[0].effects[0].params[delay[4].id]).toBe(paramFromUnit(delay[4], 0));
    // Device On/Off spegne l'effetto
    expect(r.led(NOTE.deviceOnOff)).toBe(ON);
    r.press(NOTE.deviceOnOff);
    expect(r.store.project.tracks[0].effects[0].enabled).toBe(false);
    expect(r.led(NOTE.deviceOnOff)).toBe(0);
  });

  it('un rack è il primo dispositivo: le 8 manopole muovono le macro, e le macro i parametri mappati', () => {
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
    expect(r.ring(CC.deviceKnob + 1)).toBe(Math.round(0.3 * 127)); // il mix del delay è al 30%
    r.advance(1000);
    r.cc(CC.deviceKnob + 1, 127);
    r.apc.tick();
    expect(r.store.project.tracks[0].racks[0].macros[1].value).toBe(127);
    expect(r.store.project.tracks[0].effects[0].params.mix).toBe(100);
    // dopo il rack, i suoi dispositivi; un parametro mappato non si muove dalla sua manopola
    r.press(NOTE.deviceRight);
    r.press(NOTE.deviceRight);
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(0), device: delay });
    const mix = paramsOf(effectType('delay')!).findIndex(p => p.id === 'mix');
    r.cc(CC.deviceKnob + mix, 0);
    r.apc.tick();
    expect(r.store.project.tracks[0].effects[0].params.mix).toBe(100);
    expect(r.said.at(-1)).toContain('macro 2');
  });

  it('scelto un dispositivo, poco dopo gli anelli Device si rimandano tutti (l\'APC40 può perdere i primi)', () => {
    const r = rig();
    r.start();
    const knobs = () => r.out.filter(m => m[0] === 0xb0 && m[1] >= CC.deviceKnob && m[1] < CC.deviceRing + 8).length;
    r.press(NOTE.trackSelect, 0);
    r.settle();
    const first = knobs();
    expect(first).toBe(16); // tipo e valore delle 8 manopole
    r.release(NOTE.trackSelect, 0);
    r.settle();
    expect(knobs()).toBe(first); // non subito
    r.advance(300);
    r.settle();
    expect(knobs()).toBe(first + 16); // poi tutti, anche quelli rimasti uguali
    r.advance(1000);
    r.settle();
    expect(knobs()).toBe(first + 16); // e una volta sola
    // al dispositivo dopo: i suoi anelli, e di nuovo poco dopo
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    r.press(NOTE.deviceRight);
    r.settle();
    const moved = knobs();
    r.advance(300);
    r.settle();
    expect(knobs()).toBe(moved + 16);
  });

  it('con una curva che suona l\'anello mostra il valore che si sente, e la manopola parte da lì', () => {
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
    // girata: il parametro va dove serve perché si senta il valore della manopola
    r.advance(1000);
    const heard = Math.round((base + offset) * 127) + 3;
    r.cc(CC.deviceKnob + i, heard);
    r.apc.tick();
    expect((r.store.project.tracks[0] as MidiTrack).instrument.params[spec.id]).toBeCloseTo(paramFromUnit(spec, heard / 127 - offset), 9);
    // finita la curva l'anello torna al parametro
    r.engine.curves.delete(`${r.t(0)}|instrument:${spec.id}`);
    r.advance(1000);
    expect(r.ring(CC.deviceKnob + i)).toBe(Math.round(paramToUnit(spec, paramFromUnit(spec, heard / 127 - offset)) * 127));
  });

  it('una curva su una macro: l\'anello della macro la segue', () => {
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
    r.engine.curves.set(`${r.t(0)}|${rack.id}:macro3`, 0.5); // la terza macro
    const macro = r.store.project.tracks[0].racks[0].macros[2].value / 127;
    expect(r.ring(CC.deviceKnob + 2)).toBe(Math.round(Math.min(1, macro + 0.5) * 127));
    expect(r.ring(CC.deviceKnob + 2)).not.toBe(before);
  });

  it('Device Lock: le manopole restano sul dispositivo anche cambiando traccia', () => {
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

  it('trasporto, metronomo e tempo', () => {
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
    r.press(NOTE.play); // Shift + Play: ferma e torna all'inizio
    expect(r.engine.playing).toBe(false);
  });

  it('Tap Tempo: il tempo dai colpi', () => {
    const r = rig();
    r.start();
    for (let i = 0; i < 4; i++) {
      r.press(NOTE.tapTempo);
      r.advance(500);
    }
    r.apc.tick();
    expect(r.store.project.tempo.bpm).toBe(120);
    r.advance(3000); // dopo una pausa si ricomincia
    for (let i = 0; i < 3; i++) {
      r.press(NOTE.tapTempo);
      r.advance(400);
    }
    expect(r.store.project.tempo.bpm).toBe(150);
  });

  it('Clip/Device View e Detail View aprono e chiudono l\'area in basso', () => {
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

  it('ciò che studiomio non ha ancora lo dice nella barra di stato', () => {
    const r = rig();
    r.start();
    r.press(NOTE.recordArm, 0);
    expect(r.said.at(-1)).toContain('Record arm');
    expect(r.led(NOTE.recordArm, 0)).toBe(0);
  });

  it('il riquadro rientra se si tolgono tracce', () => {
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

  it('scollegandolo: LED spenti, modo generico, niente riquadro', () => {
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
