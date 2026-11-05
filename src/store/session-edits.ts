/* Modifiche della session: clip negli slot e scene. Come le altre, funzioni pure che
 * restituiscono un Edit (si annullano). Uno slot è (traccia, indice di scena). */
import type { ClipId, SceneId, TrackId } from '../core/id';
import type { Beats } from '../core/music-time';
import { AudioClip } from '../model/audio-clip';
import type { Clip, Color } from '../model/clip';
import { paletteColor } from '../model/colors';
import { MidiClip } from '../model/midi-clip';
import type { Project } from '../model/project';
import type { SampleRef } from '../model/sample';
import { AudioTrack, GroupTrack, type Track } from '../model/track';
import { edit, type Edit } from './project-store';

export interface SlotRef {
  readonly track: TrackId;
  readonly slot: number;
}

const requireTrack = (p: Project, id: TrackId): Track => {
  const t = p.track(id);
  if (!t) throw new Error(`traccia ${id} non trovata`);
  return t;
};

/** Le clip della session suonano in loop, come in Live. */
const looping = <C extends Clip>(clip: C): C => clip.withLoop({ ...clip.loop, enabled: true });

/** Una clip MIDI vuota di una battuta nello slot. */
export const newSlotMidiClip = ({ track, slot }: SlotRef): Edit =>
  edit('Nuova clip MIDI', (p, { ids }) => {
    const t = requireTrack(p, track);
    return p.updatingTrack(track, x => x.withSlot(slot, MidiClip.empty(ids.next('clip'), 'Clip MIDI', t.color, p.signature.beatsPerBar)));
  });

/** Svuota più slot in un passo solo. */
export const clearSlots = (refs: readonly SlotRef[]): Edit =>
  edit('Elimina clip', p => refs.reduce((q, r) => q.updatingTrack(r.track, t => t.withSlot(r.slot, null)), p));

/** Sposta (o copia) tutte insieme le clip di `refs`, di `columns` colonne (tra le tracce che si
 *  vedono) e `rows` scene. Non si può uscire dalla griglia né finire su una traccia di un altro
 *  tipo: in quel caso non si muove niente. Quelle che c'erano al loro posto vengono sostituite. */
export const moveSlots = (refs: readonly SlotRef[], columns: number, rows: number, copy: boolean): Edit =>
  edit(copy ? 'Copia clip' : 'Sposta clip', (p, { ids }) => {
    const tracks = p.visibleTracks;
    const moves = refs.flatMap(r => {
      const clip = requireTrack(p, r.track).slots[r.slot];
      if (!clip) return [];
      const to = tracks[tracks.findIndex(t => t.id === r.track) + columns];
      const slot = r.slot + rows;
      if (!to || slot < 0 || slot >= p.scenes.length) throw new Error('La selezione non ci sta: uscirebbe dalla griglia.');
      if (!to.accepts(clip)) throw new TypeError('la clip non va su questa traccia');
      return [{ from: r, clip, track: to.id, slot }];
    });
    if (!columns && !rows) return p;
    const cleared = copy ? p : moves.reduce((q, m) => q.updatingTrack(m.from.track, t => t.withSlot(m.from.slot, null)), p);
    return moves.reduce((q, m) => q.updatingTrack(m.track, t => t.withSlot(m.slot, copy ? m.clip.withId(ids.next('clip')) : m.clip)), cleared);
  });

/** Una copia delle clip di `refs` subito sotto il blocco che formano. Come per una clip sola, se
 *  anche un solo posto è occupato (o non c'è) si inseriscono prima le scene che servono. */
export const duplicateSlots = (refs: readonly SlotRef[]): Edit =>
  edit('Duplica clip', (p, { ids }) => {
    const filled = refs.filter(r => requireTrack(p, r.track).slots[r.slot]);
    if (!filled.length) throw new Error('gli slot sono vuoti');
    const top = Math.min(...filled.map(r => r.slot)), below = Math.max(...filled.map(r => r.slot)) + 1, height = below - top;
    const free = filled.every(r => r.slot + height < p.scenes.length && !requireTrack(p, r.track).slots[r.slot + height]);
    let next = p;
    if (!free) for (let i = 0; i < height; i++) next = next.addingScene({ id: ids.next('scene'), name: String(next.scenes.length + 1) }, below);
    return filled.reduce((q, r) => q.updatingTrack(r.track, t => t.withSlot(r.slot + height, t.slots[r.slot]!.withId(ids.next('clip')))), next);
  });

/** Modifica la clip `clip` negli slot della traccia (note, warp, nome…). */
export const updateSlotClip = <C extends Clip>(label: string, track: TrackId, clip: ClipId, fn: (c: C) => Clip): Edit =>
  edit(label, p => p.updatingTrack(track, t => {
    const slot = t.slots.findIndex(c => c?.id === clip);
    if (slot < 0) throw new Error(`clip ${clip} non trovata negli slot`);
    return t.withSlot(slot, fn(t.slots[slot] as C));
  }));

/** Un audio importato nello slot: sulla traccia data se è audio, altrimenti su una nuova. */
export const importSampleToSlot = (sample: SampleRef, target: TrackId | null, slot: number): Edit =>
  edit('Importa audio', (p, { ids }) => {
    let next = p.sample(sample.id) ? p : p.addingSample(sample);
    let track = target && next.track(target)?.kind === 'audio' ? target : null;
    if (!track) {
      const t = AudioTrack.empty(ids.next('track'), sample.name, paletteColor(next.tracks.length), next.scenes.length);
      // su un gruppo la traccia nuova va in fondo al gruppo
      next = target && next.track(target) instanceof GroupTrack ? next.addingTrack(t.withGroup(target), next.blockEnd(target)) : next.addingTrack(t);
      track = t.id;
    }
    const clip = looping(AudioClip.fromSample(ids.next('clip'), sample, next.track(track)!.color));
    return next.updatingTrack(track, t => t.withSlot(slot, clip));
  });

// ------------------------------------------------------------------ scene

/** Una scena vuota in posizione `index` (in fondo se manca). */
export const insertScene = (index?: number): Edit =>
  edit('Nuova scena', (p, { ids }) => p.addingScene({ id: ids.next('scene'), name: String(p.scenes.length + 1) }, index));

/** Sposta la scena, con le sue clip, in posizione `toIndex` (contata senza di lei). */
export const moveScene = (id: SceneId, toIndex: number): Edit =>
  edit('Sposta scena', p => p.movingScene(id, toIndex));

export const renameScene = (id: SceneId, name: string): Edit =>
  edit('Rinomina scena', p => p.renamingScene(id, name));

export const deleteScene = (id: SceneId): Edit => edit('Elimina scena', p => p.removingScene(id));

/** Colora la scena (senza `color`: nessun colore). */
export const setSceneColor = (id: SceneId, color?: Color): Edit =>
  edit(color ? 'Colore della scena' : 'Togli il colore della scena', p => p.recoloringScene(id, color));

/** Cattura e inserisci scena, come in Live: una scena nuova sotto la `index` con le clip che
 *  suonano (`playing`: traccia → clip). Nella scena nuova vanno le clip stesse e al loro posto
 *  restano delle copie: chi suona continua senza interruzioni, ma ora dalla riga nuova. */
export const captureScene = (index: number, playing: ReadonlyMap<TrackId, ClipId>): Edit =>
  edit('Cattura e inserisci scena', (p, { ids }) => {
    const at = index + 1;
    let next = p.addingScene({ id: ids.next('scene'), name: String(p.scenes.length + 1) }, at);
    for (const [track, id] of playing) {
      const slot = next.track(track)?.slots.findIndex(c => c?.id === id) ?? -1;
      if (slot < 0) continue;
      next = next.updatingTrack(track, t => t.withSlot(slot, t.slots[slot]!.withId(ids.next('clip'))).withSlot(at, t.slots[slot]));
    }
    return next;
  });

/** Una copia della scena subito sotto, con copie delle sue clip. */
export const duplicateScene = (id: SceneId): Edit =>
  edit('Duplica scena', (p, { ids }) => {
    const index = p.scenes.findIndex(s => s.id === id);
    if (index < 0) throw new Error(`scena ${id} non trovata`);
    const source = p.scenes[index];
    let next = p.addingScene({ id: ids.next('scene'), name: `${source.name} copia`, ...(source.color ? { color: source.color } : {}) }, index + 1);
    for (const t of p.tracks) {
      const clip = t.slots[index];
      if (clip) next = next.updatingTrack(t.id, x => x.withSlot(index + 1, clip.withId(ids.next('clip'))));
    }
    return next;
  });

/** La scena `index` sulla timeline dal battito `at`: ogni traccia vi posa una copia della clip
 *  del suo slot, lunga `length` (i loop si ripetono, le altre clip suonano una volta). Quello
 *  che c'era sotto viene accorciato o tolto, come incollando. */
export const sceneToArrangement = (index: number, at: Beats, length: Beats): Edit =>
  edit('Scena nell\'arrangement', (p, { ids }) => p.tracks.reduce((next, t) => {
    const clip = t instanceof GroupTrack ? null : t.slots[index];
    if (!clip) return next;
    const placed = { id: ids.next('placement'), clip: clip.withId(ids.next('clip')), start: Math.max(0, at), length, offset: 0 };
    return next.updatingTrack(t.id, x => x.placing(placed, ids));
  }, p));

/** Una clip per uno slot, con il file renderizzato che suona se è nuovo. */
export interface SceneClip {
  readonly track: TrackId;
  readonly clip: Clip;
  readonly sample?: SampleRef;
}

/** Il contrario di sceneToArrangement: una scena nuova in fondo con le clip date, in loop. */
export const arrangementToScene = (name: string, clips: readonly SceneClip[]): Edit =>
  edit('Arrangement nella session', (p, { ids }) => {
    const at = p.scenes.length;
    return clips.reduce((next, { track, clip, sample }) => {
      const withSample = sample && !next.sample(sample.id) ? next.addingSample(sample) : next;
      return withSample.updatingTrack(track, t => t.withSlot(at, looping(clip)));
    }, p.addingScene({ id: ids.next('scene'), name }, at));
  });
