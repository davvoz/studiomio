import { describe, expect, it } from 'vitest';
import { sequentialIds, type TrackId } from '../../src/core/id';
import { Apc40, INSTRUMENT_KEY, type DetailView, type SurfaceEngine } from '../../src/control/apc40/apc40';
import {
  CC, COLOR, dbToFader, faderToDb, introduction, knobToPan, MODE, NOTE, padAt, padNote, paletteIndex, panToKnob,
} from '../../src/control/apc40/protocol';
import { paramFromUnit, paramToUnit } from '../../src/devices/params';
import { paramsOf, resolveParams } from '../../src/devices/device-type';
import { effectType, instrumentType } from '../../src/devices/registry';
import type { TrackSessionState } from '../../src/engine/session';
import { MidiClip } from '../../src/model/midi-clip';
import { MASTER, Project, type ChainOwner } from '../../src/model/project';
import type { MidiTrack, Track } from '../../src/model/track';
import { addEffect, addTrack, setSlot } from '../../src/store/edits';
import { ProjectStore } from '../../src/store/project-store';
import { UiState } from '../../src/ui/ui-state';

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
  const ring = (n: number) => {
    settle();
    return out.filter(m => m[0] === 0xb0 && m[1] === n).at(-1)?.[2];
  };
  return {
    store, ui, engine, apc, out, said, opened, t, press, release, cc, led, ring, settle,
    advance: (ms: number) => { clock += ms; },
    setDetail: (d: DetailView) => { detail = d; },
  };
}

describe('protocollo APC40 mkII', () => {
  it('la presentazione mette il controller in Ableton mode', () => {
    expect(introduction()).toEqual([0xf0, 0x47, 0x7f, 0x29, 0x60, 0x00, 0x04, 0x41, 0x01, 0x00, 0x00, 0xf7]);
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
  it('al collegamento: Ableton mode, riquadro 8×5 in alto a sinistra e tutti i LED', () => {
    const r = rig({ tracks: 3, clips: [[0, 0]] });
    r.apc.start();
    expect(r.out[0]).toEqual(introduction(MODE.ableton));
    expect(r.ui.sessionRing).toEqual({ track: 0, scene: 0, width: 8, height: 5 });
    expect(r.led(padNote(0, 0))).toBe(COLOR.red);
    expect(r.led(padNote(1, 0))).toBe(COLOR.off);
    expect(r.led(NOTE.activator, 0)).toBe(1);
    expect(r.led(NOTE.activator, 5)).toBe(0); // traccia che non c'è
  });

  it('manda solo i LED che cambiano, e a piccole raffiche', () => {
    const r = rig({ clips: [[0, 0]] });
    r.apc.start();
    expect(r.out.length).toBeLessThanOrEqual(1 + 32); // presentazione + un giro
    r.settle();
    const n = r.out.length;
    r.apc.tick();
    expect(r.out.length).toBe(n);
  });

  it('i pad lanciano le clip del riquadro, le scene le righe, gli stop fermano', () => {
    const r = rig({ tracks: 3 });
    r.apc.start();
    r.press(padNote(1, 2));
    r.press(NOTE.sceneLaunch + 3);
    r.press(NOTE.clipStop, 2);
    r.press(NOTE.stopAllClips);
    r.press(padNote(5, 0)); // nessuna traccia lì
    expect(r.engine.calls).toEqual([`slot ${r.t(1)} 2`, 'scene 3', `stop ${r.t(2)}`, 'stop all']);
  });

  it('frecce: il riquadro si sposta e resta dentro il progetto; Shift sposta di una pagina', () => {
    const r = rig({ tracks: 20, scenes: 12 });
    r.apc.start();
    expect(r.led(NOTE.up)).toBe(0);
    expect(r.led(NOTE.down)).toBe(1);
    r.press(NOTE.down);
    r.press(NOTE.right);
    expect(r.ui.sessionRing).toMatchObject({ track: 1, scene: 1 });
    expect(r.led(NOTE.up)).toBe(1);
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
    expect(r.led(NOTE.down)).toBe(1); // la scena 11 è ancora sotto
    // ora il primo pad è la traccia 12, scena 6
    r.press(padNote(0, 0));
    expect(r.engine.calls).toEqual([`slot ${r.t(12)} 6`]);
  });

  it('Bank acceso: le frecce vanno a pagine anche senza Shift', () => {
    const r = rig({ tracks: 20 });
    r.apc.start();
    r.press(NOTE.bank);
    expect(r.led(NOTE.bank)).toBe(1);
    r.press(NOTE.right);
    expect(r.ui.sessionRing?.track).toBe(8);
  });

  it('Shift + griglia: la mappa dei blocchi, e un pad porta lì il riquadro', () => {
    const r = rig({ tracks: 20, scenes: 12, clips: [[17, 11]] });
    r.apc.start();
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

  it('clip che suona pulsa verde, quella in coda lampeggia, a tempo', () => {
    const r = rig({ clips: [[0, 0], [0, 1]] });
    r.engine.playing = true;
    r.engine.states.set(r.t(0), { playing: { slot: 0, elapsed: 0 }, queued: { slot: 1 }, followsArrangement: false });
    r.engine.position = 0.1;
    r.apc.start();
    expect(r.led(padNote(0, 0))).toBe(COLOR.green);
    expect(r.led(padNote(0, 1))).toBe(COLOR.green);
    expect(r.led(NOTE.clipStop, 0)).toBe(1);
    expect(r.led(NOTE.stopAllClips)).toBe(1);
    r.engine.position = 0.3; // seconda metà dell'ottavo: la clip in coda si spegne
    r.apc.tick();
    expect(r.led(padNote(0, 0))).toBe(COLOR.green);
    expect(r.led(padNote(0, 1))).toBe(COLOR.off);
    r.engine.position = 0.6; // seconda metà del battito: quella che suona si abbassa
    r.apc.tick();
    expect(r.led(padNote(0, 0))).toBe(COLOR.greenDim);
  });

  it('activator e solo cambiano il mixer, e i LED lo seguono', () => {
    const r = rig();
    r.apc.start();
    r.press(NOTE.activator, 1);
    r.press(NOTE.solo, 2);
    expect(r.store.project.tracks[1].mixer.mute).toBe(true);
    expect(r.store.project.tracks[2].mixer.solo).toBe(true);
    expect(r.led(NOTE.activator, 1)).toBe(0);
    expect(r.led(NOTE.solo, 2)).toBe(1);
  });

  it('fader: si applica l\'ultimo valore a ogni giro, e una corsa è un solo annullamento', () => {
    const r = rig();
    r.apc.start();
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
    r.apc.start();
    r.cc(CC.trackFader, 0, 0);
    r.apc.tick();
    expect(r.store.project.tracks[0].mixer.volumeDb).toBe(0);
  });

  it('manopole in alto: il pan, con l\'anello acceso', () => {
    const r = rig();
    r.apc.start();
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
    r.apc.start();
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
    r.apc.start();
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
    r.apc.start();
    r.press(NOTE.trackSelect, 2);
    expect(r.ui.track).toBe(r.t(2));
    expect(r.led(NOTE.trackSelect, 2)).toBe(1);
    r.press(NOTE.master);
    expect(r.ui.track).toBeNull();
    expect(r.led(NOTE.master)).toBe(1);
    expect(r.led(NOTE.trackSelect, 2)).toBe(0);
    // dall'app: scegliere una traccia toglie il master
    r.ui.selectTrack(r.t(0));
    r.apc.tick();
    expect(r.led(NOTE.master)).toBe(0);
    expect(r.led(NOTE.trackSelect, 0)).toBe(1);
  });

  it('Device Control: le 8 manopole muovono lo strumento, poi gli effetti, a banchi di 8', () => {
    const r = rig();
    r.store.apply(addEffect(r.t(0), 'delay', 'Delay'));
    r.apc.start();
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
    expect(r.led(NOTE.bankRight)).toBe(paramsOf(synth).length > 8 ? 1 : 0);
    r.press(NOTE.bankRight);
    if (paramsOf(synth).length > 8) expect(r.said.at(-1)).toContain('banco 2');

    // al dispositivo dopo: il delay
    r.press(NOTE.deviceRight);
    const delayId = r.store.project.tracks[0].effects[0].id;
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(0), device: delayId });
    expect(r.opened.at(-1)).toBe(`devices ${r.t(0)}`);
    expect(r.led(NOTE.deviceRight)).toBe(0);
    expect(r.led(NOTE.deviceLeft)).toBe(1);
    const delay = paramsOf(effectType('delay')!);
    r.cc(CC.deviceKnob + 4, 0); // il quinto parametro del delay: il feedback
    r.apc.tick();
    expect(r.store.project.tracks[0].effects[0].params[delay[4].id]).toBe(paramFromUnit(delay[4], 0));
    // Device On/Off spegne l'effetto
    expect(r.led(NOTE.deviceOnOff)).toBe(1);
    r.press(NOTE.deviceOnOff);
    expect(r.store.project.tracks[0].effects[0].enabled).toBe(false);
    expect(r.led(NOTE.deviceOnOff)).toBe(0);
  });

  it('Device Lock: le manopole restano sul dispositivo anche cambiando traccia', () => {
    const r = rig();
    r.store.apply(addEffect(MASTER, 'eq', 'EQ'));
    r.apc.start();
    r.press(NOTE.master);
    const eq = r.store.project.masterEffects[0].id;
    expect(r.ui.controlledDevice).toEqual({ owner: MASTER, device: eq });
    r.press(NOTE.deviceLock);
    r.press(NOTE.trackSelect, 1);
    expect(r.ui.controlledDevice).toEqual({ owner: MASTER, device: eq });
    expect(r.led(NOTE.deviceLock)).toBe(1);
    r.press(NOTE.deviceLock);
    expect(r.ui.controlledDevice).toEqual({ owner: r.t(1), device: INSTRUMENT_KEY });
  });

  it('trasporto, metronomo e tempo', () => {
    const r = rig();
    r.apc.start();
    r.press(NOTE.play);
    expect(r.engine.playing).toBe(true);
    expect(r.led(NOTE.play)).toBe(1);
    r.press(NOTE.metronome);
    expect(r.led(NOTE.metronome)).toBe(1);
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
    r.apc.start();
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
    r.apc.start();
    r.press(NOTE.trackSelect, 0);
    r.press(NOTE.detailView);
    expect(r.opened).toEqual([`devices ${r.t(0)}`]);
    expect(r.led(NOTE.detailView)).toBe(1);
    r.press(NOTE.clipDeviceView);
    expect(r.opened.at(-1)).toBe('clip');
    r.press(NOTE.detailView);
    expect(r.led(NOTE.detailView)).toBe(0);
  });

  it('ciò che studiomio non ha ancora lo dice nella barra di stato', () => {
    const r = rig();
    r.apc.start();
    r.press(NOTE.recordArm, 0);
    expect(r.said.at(-1)).toContain('Record arm');
    expect(r.led(NOTE.recordArm, 0)).toBe(0);
  });

  it('il riquadro rientra se si tolgono tracce', () => {
    const r = rig({ tracks: 12 });
    r.apc.start();
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
    r.apc.start();
    r.settle();
    r.apc.stop();
    expect(r.led(padNote(0, 0))).toBe(0);
    expect(r.led(NOTE.activator, 0)).toBe(0);
    expect(r.out.at(-1)).toEqual(introduction(MODE.generic));
    expect(r.ui.sessionRing).toBeNull();
    expect(r.ui.controlledDevice).toBeNull();
  });
});
