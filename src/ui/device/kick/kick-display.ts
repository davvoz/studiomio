/* Il pannello del Kick (un pannello a strati, vedi layer-display.ts): il colpo con la curva
 * dell'intonazione che cade fino alla nota, poi le schede degli strati nell'ordine in cui si
 * sentono (Snap, Corpo, Coda, Rumble), la nota e l'uscita. Snap e Corpo possono essere un sample. */
import {
  BODY_SLOT, kickNote, noteHz, ROOT_NOTE, SNAP_SLOT, SNAP_SOURCE, SOURCE,
} from '../../../devices/instruments/kick/kick';
import { KickCore } from '../../../devices/instruments/kick/kick-core';
import type { DisplayContext } from '../displays';
import { LayerDisplay, type LayerLayout } from '../layers/layer-display';

/** Quanto si disegna del colpo, al massimo e al minimo (in secondi). */
const MAX_VIEW = 2.5;
const MIN_VIEW = 0.3;

export const KICK_LAYOUT: LayerLayout = {
  name: 'Kick',
  cards: [
    { title: 'Snap', source: 'snapSource', slot: SNAP_SLOT, params: ['snapLevel', 'snapTone', 'snapTune', 'snapDecay'] },
    {
      title: 'Corpo', source: 'bodySource', slot: BODY_SLOT,
      params: ['bodyLevel', 'pitch', 'pitchTime', 'pitchCurve', 'shape', 'sampleTune', 'sampleStart', 'attack', 'hold', 'decay'],
    },
    { title: 'Coda', params: ['tailLevel', 'tailDecay', 'tailDrive'] },
    { title: 'Rumble', source: 'rumbleOn', params: ['rumble', 'rumbleTime', 'rumbleTone', 'rumbleDrive', 'rumbleDuck'] },
    { title: 'Nota', params: ['note', 'fine', 'follow'] },
    { title: 'Uscita', params: ['drive', 'driveType', 'lowCut', 'velocity', 'volume'] },
  ],
  // scegliendo un sample, i tempi si allungano quanto basta a sentirlo (un sample di cassa dura più di un click)
  samples: [
    { slot: BODY_SLOT, source: 'bodySource', sample: SOURCE.sample, times: x => ({ ...(x.hold < 150 ? { hold: 300 } : {}), ...(x.decay < 0.6 ? { decay: 1 } : {}) }) },
    { slot: SNAP_SLOT, source: 'snapSource', sample: SNAP_SOURCE.sample, times: x => ({ ...(x.snapDecay < 120 ? { snapDecay: 250 } : {}) }) },
  ],
  swapped: new Set(['pitch', 'pitchTime', 'pitchCurve', 'shape', 'sampleTune', 'sampleStart', 'snapTone', 'snapTune']),
  menus: new Set(['note', 'driveType', 'snapSource', 'bodySource']),
  audition: new Set(['bodySource', 'snapSource', 'note']),
  rootNote: ROOT_NOTE,
  lowHz: 25,
  highHz: 1200,
  core: rate => new KickCore(rate),
  /** Fin dove si sente il più lungo degli strati. */
  seconds: v => {
    const body = (v.attack + v.hold) / 1000 + v.decay * 0.6, tail = v.tailLevel > 0 ? v.tailDecay * 0.6 : 0;
    const rumble = v.rumbleOn === 1 && v.rumble > 0 ? v.rumbleTime * 0.7 : 0;
    return Math.max(MIN_VIEW, Math.min(MAX_VIEW, Math.max(body, tail, rumble)));
  },
  pitch: v => {
    if (v.bodySource !== SOURCE.synth) return null;
    const base = noteHz(kickNote(v.note) + v.fine / 100);
    const curve = Math.pow(2, (v.pitchCurve - 50) / 25), k = Math.log(1e-3) / (v.pitchTime / 1000);
    return { base, at: t => base * Math.pow(2, (v.pitch * Math.pow(Math.exp(k * t), curve)) / 12) };
  },
  hint: v => (v.follow === 1 ? 'segue le note (C1 = la nota)' : 'clic: suona'),
};

export const kickDisplay = (ctx: DisplayContext) => new LayerDisplay(ctx, KICK_LAYOUT);
