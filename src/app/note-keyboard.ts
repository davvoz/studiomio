/* The computer keyboard as a musical keyboard, with Live's layout: the middle row
 * is the white keys, the one above the black ones, Z X the octave, C V the velocity. It plays the MIDI tracks
 * armed with the ⌨ button. Keys are recognized by position (`code`), not by letter:
 * the layout stays the same with any keyboard language. With Ctrl or Alt they stay
 * shortcuts and in text fields you type. With a track armed these keys play even if
 * they're mapped to macros: the mapping comes back turning ⌨ off, and the other mapped keys stay. */
import type { TrackId } from '../core/id';
import { resolveParams } from '../devices/device-type';
import { instrumentType } from '../devices/registry';
import { MidiTrack } from '../model/track';
import type { Project } from '../model/project';
import { ownedByField } from '../ui/keymap';
import type { UiState } from '../ui/ui-state';

/** How many semitones above the base note each key plays. */
const NOTE_KEYS: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

/** The velocity steps, as in Live. */
const VELOCITIES = [1, 20, 40, 60, 80, 100, 120, 127] as const;
const START_VELOCITY = VELOCITIES.indexOf(100);
const MAX_OCTAVES = 5;

/** Middle C: where the A key starts for melodic instruments. */
const MIDDLE_C = 60;

const HINT = "Keyboard on: A to L the notes, W E T Y U O P the black keys, Z X the octave, C V the velocity.";

/** The A key's note for a track: for instruments with one note per sound (the pads of a
 *  drum machine) the first that plays something, for the others middle C. */
export function keyboardBase(project: Project, id: TrackId): number {
  const track = project.track(id);
  if (!(track instanceof MidiTrack)) return MIDDLE_C;
  const type = instrumentType(track.instrument.type);
  const names = type?.noteNames?.(resolveParams(type, track.instrument.params), project.sampleNames(track.instrument));
  return names?.size ? Math.min(...names.keys()) : MIDDLE_C;
}

export interface NoteKeyboardOutput {
  /** The A key's note for the track, with the octave at its starting place. */
  base(track: TrackId): number;
  press(track: TrackId, pitch: number, velocity: number): void;
  release(track: TrackId, pitch: number): void;
  say(text: string): void;
}

interface HeldNote {
  readonly track: TrackId;
  readonly pitch: number;
}

/** Turns keys into notes. Each key down remembers what it started: changing octave with
 *  a held note doesn't leave it on forever. */
export class NoteKeyboard {
  private octave = 0;
  private velocity = START_VELOCITY;
  private readonly held = new Map<string, HeldNote[]>();

  private readonly commands: Readonly<Record<string, () => void>> = {
    KeyZ: () => this.shiftOctave(-1),
    KeyX: () => this.shiftOctave(1),
    KeyC: () => this.shiftVelocity(-1),
    KeyV: () => this.shiftVelocity(1),
  };

  constructor(private readonly out: NoteKeyboardOutput) {}

  /** The key belongs to the musical keyboard. */
  owns(code: string): boolean {
    return code in NOTE_KEYS || code in this.commands;
  }

  down(code: string, tracks: Iterable<TrackId>): void {
    this.commands[code]?.();
    const offset = NOTE_KEYS[code];
    if (offset === undefined || this.held.has(code)) return;
    const notes: HeldNote[] = [];
    for (const track of tracks) {
      const pitch = this.out.base(track) + this.octave * 12 + offset;
      if (pitch < 0 || pitch > 127) continue;
      this.out.press(track, pitch, VELOCITIES[this.velocity]);
      notes.push({ track, pitch });
    }
    this.held.set(code, notes);
  }

  up(code: string): void {
    for (const n of this.held.get(code) ?? []) this.out.release(n.track, n.pitch);
    this.held.delete(code);
  }

  releaseAll(): void {
    for (const code of [...this.held.keys()]) this.up(code);
  }

  /** The notes of the tracks that turned the keyboard off stop. */
  keepTracks(tracks: ReadonlySet<TrackId>): void {
    for (const [code, notes] of this.held) {
      for (const n of notes) if (!tracks.has(n.track)) this.out.release(n.track, n.pitch);
      this.held.set(code, notes.filter(n => tracks.has(n.track)));
    }
  }

  hint(): void {
    this.out.say(HINT);
  }

  private shiftOctave(by: number): void {
    this.octave = Math.max(-MAX_OCTAVES, Math.min(MAX_OCTAVES, this.octave + by));
    this.report();
  }

  private shiftVelocity(by: number): void {
    this.velocity = Math.max(0, Math.min(VELOCITIES.length - 1, this.velocity + by));
    this.report();
  }

  private report(): void {
    const octave = this.octave > 0 ? `+${this.octave}` : String(this.octave);
    this.out.say(`Keyboard: octave ${octave}, velocity ${VELOCITIES[this.velocity]}.`);
  }
}

/** Connects the window's keys to the musical keyboard, when a track is armed. */
export class NoteKeys {
  /** The tracks armed last time (to notice a new one). */
  private shown: ReadonlySet<TrackId> = new Set();

  constructor(private readonly ui: UiState, private readonly keyboard: NoteKeyboard) {
    addEventListener('keydown', e => this.down(e), true);
    addEventListener('keyup', e => this.up(e), true);
    // a key released outside the window doesn't arrive: the notes turn off anyway
    addEventListener('blur', () => keyboard.releaseAll());
    ui.onChange(() => this.tracksChanged());
  }

  private down(e: KeyboardEvent): void {
    const { keyboard, ui } = this;
    if (!ui.keyboardTracks.size || !keyboard.owns(e.code) || ui.keyMapping || ui.midiMapping) return;
    if (e.ctrlKey || e.metaKey || e.altKey || this.ownedElsewhere(e)) return;
    e.preventDefault();
    // the mapped keys too, listening on the same window
    e.stopImmediatePropagation();
    if (!e.repeat) keyboard.down(e.code, ui.keyboardTracks);
  }

  private up(e: KeyboardEvent): void {
    this.keyboard.up(e.code);
  }

  /** The key belongs to a text field, an open dialog or a menu. Not to a select
   *  box: after a preset the focus stays there, and a letter would change the preset instead of playing. */
  private ownedElsewhere(e: KeyboardEvent): boolean {
    const target = e.target instanceof HTMLElement ? e.target : null;
    return (target?.tagName !== 'SELECT' && ownedByField(target, e)) || !!target?.closest('dialog, .context-menu');
  }

  private tracksChanged(): void {
    const tracks = this.ui.keyboardTracks;
    if (tracks === this.shown) return;
    this.keyboard.keepTracks(tracks);
    if ([...tracks].some(t => !this.shown.has(t))) this.keyboard.hint();
    this.shown = tracks;
  }
}
