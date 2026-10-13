/* Scrivere parti come su una drum machine o una 303: ritmi a sedicesimi per i pad
 * ("X..x o..."), linee acid una parola per passo con accenti e slide, ripetizioni e curve delle
 * modulazioni. Servono ai progetti costruiti dal codice (vedi acid-live.ts). */
import type { Beats } from '../core/music-time';
import { padNote } from '../devices/instruments/drums/drums';
import type { EnvelopePoint } from '../model/envelope';
import type { Note } from '../model/midi-clip';

/** Un passo: un sedicesimo. */
export const STEP = 0.25;
export const BAR = 4;

/** Un ritmo a sedicesimi per un pad: "X" accento, "x" colpo, "o" colpo leggero, "." pausa;
 *  spazi e "|" servono solo a leggere. */
export function steps(pad: number, pattern: string, from: Beats = 0): Note[] {
  const VELOCITY: Readonly<Record<string, number>> = { X: 127, x: 104, o: 66 };
  return [...pattern.replace(/[\s|]/g, '')].flatMap((c, i) =>
    VELOCITY[c] ? [{ pitch: padNote(pad), start: from + i * STEP, duration: STEP, velocity: VELOCITY[c] }] : []);
}

const NOTE_NAMES: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** Una linea acid a sedicesimi, come si programma una 303: una parola per passo, "." pausa,
 *  "-" tiene la nota di prima un passo in più. Una nota è nome e ottava ("a2", "c#3", "eb2"),
 *  con l'iniziale maiuscola se accentata e "~" in fondo se scivola nella prossima (le due si
 *  sovrappongono: Analog in Legato fa lo slide). */
export function acid(line: string, from: Beats = 0): Note[] {
  const notes: { pitch: number; start: number; steps: number; slide: boolean; accent: boolean }[] = [];
  line.replace(/\|/g, ' ').trim().split(/\s+/).forEach((word, i) => {
    if (word === '.') return;
    if (word === '-') {
      const last = notes.at(-1);
      if (last) last.steps++;
      return;
    }
    const m = /^([a-g])(#|b)?(\d)(~)?$/i.exec(word);
    if (!m) throw new Error(`passo acid non valido: "${word}"`);
    const [, name, accidental, octave, slide] = m;
    const pitch = 12 * (Number(octave) + 1) + NOTE_NAMES[name.toLowerCase()] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
    notes.push({ pitch, start: from + i * STEP, steps: 1, slide: !!slide, accent: name !== name.toLowerCase() });
  });
  // gate della 303: metà passo; con lo slide la nota arriva oltre l'inizio della prossima
  return notes.map(n => ({
    pitch: n.pitch, start: n.start, velocity: n.accent ? 127 : 92,
    duration: n.slide ? n.steps * STEP + 0.06 : (n.steps - 0.5) * STEP,
  }));
}

/** Le note ripetute `times` volte, ogni `period` battiti. */
export const repeat = (notes: readonly Note[], period: Beats, times: number): Note[] =>
  Array.from({ length: times }, (_, k) => notes.map(n => ({ ...n, start: n.start + k * period }))).flat();

/** Una battuta ripetuta per `bars` battute, con l'ultima eventualmente diversa. */
export const bars = (pad: number, bar: string, count: number, last: string = bar): Note[] =>
  Array.from({ length: count }, (_, k) => steps(pad, k === count - 1 ? last : bar, k * BAR)).flat();

/** Punti di una curva: [battito, valore]. */
export const curve = (...points: (readonly [Beats, number])[]): EnvelopePoint[] => points.map(([beat, value]) => ({ beat, value }));

/** Un pad suonato in fila da `from`: `count` colpi ogni `every` battiti, la velocity che va da
 *  `velocity[0]` a `velocity[1]` (un rullo che cresce, uno stutter). */
export function roll(pad: number, from: Beats, count: number, every: Beats, velocity: readonly [number, number] = [100, 100]): Note[] {
  return Array.from({ length: count }, (_, k) => ({
    pitch: padNote(pad), start: from + k * every, duration: every,
    velocity: velocity[0] + ((velocity[1] - velocity[0]) * k) / Math.max(1, count - 1),
  }));
}

/** Un loop affettato sui pad, a sedicesimi: un numero è il pad (la fetta) che parte lì, "."
 *  lascia suonare quella prima. Con le fette in choke tra loro si ricompone il loop o lo si
 *  rimonta: "0 . 1 . 2 . 3 ." è l'originale in ottavi. */
export function chop(line: string, from: Beats = 0, velocity = 110): Note[] {
  return line.replace(/\|/g, ' ').trim().split(/\s+/).flatMap((word, i) => {
    if (word === '.') return [];
    const pad = Number(word);
    if (!Number.isInteger(pad)) throw new Error(`fetta non valida: "${word}"`);
    return [{ pitch: padNote(pad), start: from + i * STEP, duration: STEP, velocity }];
  });
}

/** Il volume che si abbassa sui colpi (`hits`, in battiti) e risale in `release` battiti: il
 *  sidechain fatto con le modulazioni. `depth` è quanto resta del volume al colpo (0..1). */
export function duck(hits: readonly Beats[], depth: number, release: Beats): EnvelopePoint[] {
  return [...hits].sort((a, b) => a - b).flatMap(h => [
    { beat: h, value: 1 }, { beat: h, value: depth }, { beat: h + release, value: 1 },
  ]);
}

/** Il volume a scatti tra `from` e `to`: acceso per `duty` di ogni passo `every`, poi spento
 *  (lo stutter dei tagli glitch). Fuori dal tratto resta pieno. */
export function gate(from: Beats, to: Beats, every: Beats, duty = 0.5): EnvelopePoint[] {
  const points: EnvelopePoint[] = [];
  for (let t = from; t < to - 1e-9; t += every) {
    points.push({ beat: t, value: 1 }, { beat: t + every * duty, value: 1 }, { beat: t + every * duty, value: 0 }, { beat: t + every, value: 0 });
  }
  points.push({ beat: to, value: 1 });
  return points;
}
