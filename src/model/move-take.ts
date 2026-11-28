/* Recording a parameter's movements into a clip's curve (Live's automation recording in the
 * session): a gesture is the values a control took while recording, in clip beats. Here only how a
 * gesture becomes points (thinned: a turned knob sends dozens of values a second) and how it's
 * written over the curve the clip has (touch: only the stretch it covers changes). Pure. */
import type { Beats } from '../core/music-time';
import { envelopeValueAt, type EnvelopePoint, type ModScale } from './envelope';

/** A point is kept if this much of the scale or this many beats passed since the last one kept. */
const VALUE_STEP = 0.01;
const BEAT_STEP: Beats = 1 / 4;

/** The gesture's points, fewer: the first and the last always, between them those that move enough.
 *  On a stepped scale (on/off) each change is a step: the old value holds up to it. */
export function thinned(samples: readonly EnvelopePoint[], scale: ModScale): EnvelopePoint[] {
  if (samples.length < 2) return [...samples];
  if (scale.step) return stepped(samples);
  const range = scale.max - scale.min;
  const out: EnvelopePoint[] = [samples[0]];
  for (let i = 1; i < samples.length - 1; i++) {
    const last = out.at(-1)!, p = samples[i];
    if (Math.abs(p.value - last.value) >= VALUE_STEP * range || p.beat - last.beat >= BEAT_STEP) out.push(p);
  }
  out.push(samples.at(-1)!);
  return out;
}

/** The changes of a stepped value, as steps. */
function stepped(samples: readonly EnvelopePoint[]): EnvelopePoint[] {
  const out: EnvelopePoint[] = [samples[0]];
  for (const p of samples.slice(1)) {
    const last = out.at(-1)!;
    if (p.value !== last.value) out.push({ beat: p.beat, value: last.value }, p);
  }
  return out;
}

/** A take's gesture made into a curve: its points (thinned) in runs, a new run where the beat goes back
 *  (the loop came round on the timeline), each written over what the earlier ones left, so the last
 *  round wins where they overlap. Before the first, the knob's value (`neutral`). */
export function overRounds(points: readonly EnvelopePoint[], scale: ModScale, neutral: number): EnvelopePoint[] {
  const runs: EnvelopePoint[][] = [];
  for (const p of points) {
    const run = runs.at(-1);
    if (run && p.beat >= run.at(-1)!.beat) run.push(p);
    else runs.push([p]);
  }
  return runs.reduce<EnvelopePoint[]>((old, run) => touched(old, thinned(run, scale), neutral), []);
}

/** The curve after a gesture written over `old` (Live's touch): before the gesture the old curve stays
 *  (a step at its start), in its stretch the gesture, after it the old curve again (a step back to it).
 *  Without an old curve the value before the gesture is the knob's (`neutral`), and after it the
 *  gesture's last value holds. */
export function touched(old: readonly EnvelopePoint[], gesture: readonly EnvelopePoint[], neutral: number): EnvelopePoint[] {
  if (!gesture.length) return [...old];
  const first = gesture[0], last = gesture.at(-1)!;
  const was = old.length ? envelopeValueAt(old, first.beat) : neutral;
  const into = was === first.value ? [] : [{ beat: first.beat, value: was }];
  const back = old.length ? envelopeValueAt(old, last.beat) : last.value;
  const out = back === last.value ? [] : [{ beat: last.beat, value: back }];
  return [...old.filter(p => p.beat < first.beat), ...into, ...gesture, ...out, ...old.filter(p => p.beat > last.beat)];
}
