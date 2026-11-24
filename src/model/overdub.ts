/* Overdub, as Live's Session Record: the notes played over a MIDI clip looping in the session go
 * into it, where they fall in its loop, next to the notes it has. Here only where a note goes and
 * how long it lasts: no engine, no keyboard. */
import type { Beats } from '../core/music-time';
import type { MidiClip, Note } from './midi-clip';
import type { NoteSpan } from './record-settings';

/** The shortest note kept (pressed and released in the same instant), as in a take. */
const MIN_DURATION: Beats = 1 / 64;

/** Where the clip's content ends: its loop's end when it loops, otherwise its region's. */
export const clipEnd = (clip: MidiClip): Beats => (clip.loop.enabled ? clip.loop.end : clip.region.end);

/** Where the clip's notes play: its loop (round), or its region if it doesn't loop. */
export const clipSpan = (clip: MidiClip): NoteSpan =>
  (clip.loop.enabled ? { start: clip.loop.start, end: clip.loop.end, loops: true } : { start: clip.region.start, end: clip.region.end, loops: false });

/** The note pressed at `start` (a beat of the clip's content) and held `held` beats: it doesn't go
 *  past the clip's end (a note held over the loop's end stops there). */
export function overdubbedNote(clip: MidiClip, pitch: number, velocity: number, start: Beats, held: Beats): Note {
  const room = Math.max(MIN_DURATION, clipEnd(clip) - start);
  return { pitch, velocity, start, duration: Math.max(MIN_DURATION, Math.min(held, room)) };
}
