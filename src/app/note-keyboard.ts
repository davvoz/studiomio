/* La tastiera del computer come tastiera musicale, con la disposizione di Live: la fila di mezzo
 * sono i tasti bianchi, quella sopra i neri, Z X l'ottava, C V la velocity. Suona le tracce MIDI
 * accese con il pulsante ⌨. I tasti si riconoscono dalla posizione (`code`), non dalla lettera:
 * la disposizione resta la stessa con qualunque lingua della tastiera. Con Ctrl o Alt restano
 * scorciatoie, nei campi di testo si scrive, e i tasti mappati sulle macro vengono prima. */
import type { TrackId } from '../core/id';
import { resolveParams } from '../devices/device-type';
import { instrumentType } from '../devices/registry';
import { MidiTrack } from '../model/track';
import type { Project } from '../model/project';
import { ownedByField } from '../ui/keymap';
import type { UiState } from '../ui/ui-state';

/** Quanti semitoni sopra la nota di base suona ogni tasto. */
const NOTE_KEYS: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

/** I gradini della velocity, come in Live. */
const VELOCITIES = [1, 20, 40, 60, 80, 100, 120, 127] as const;
const START_VELOCITY = VELOCITIES.indexOf(100);
const MAX_OCTAVES = 5;

/** Il Do centrale: dove parte il tasto A per gli strumenti melodici. */
const MIDDLE_C = 60;

const HINT = "Tastiera accesa: da A a L le note, W E T Y U O P i tasti neri, Z X l'ottava, C V la velocity.";

/** La nota del tasto A per una traccia: per gli strumenti con una nota per suono (i pad di una
 *  drum machine) la prima che suona qualcosa, per gli altri il Do centrale. */
export function keyboardBase(project: Project, id: TrackId): number {
  const track = project.track(id);
  if (!(track instanceof MidiTrack)) return MIDDLE_C;
  const type = instrumentType(track.instrument.type);
  const names = type?.noteNames?.(resolveParams(type, track.instrument.params), project.sampleNames(track.instrument));
  return names?.size ? Math.min(...names.keys()) : MIDDLE_C;
}

export interface NoteKeyboardOutput {
  /** La nota del tasto A per la traccia, con l'ottava al suo posto di partenza. */
  base(track: TrackId): number;
  press(track: TrackId, pitch: number, velocity: number): void;
  release(track: TrackId, pitch: number): void;
  say(text: string): void;
}

interface HeldNote {
  readonly track: TrackId;
  readonly pitch: number;
}

/** Trasforma i tasti in note. Ogni tasto giù ricorda cosa ha fatto partire: cambiare ottava con
 *  una nota tenuta non la lascia accesa per sempre. */
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

  /** Il tasto è della tastiera musicale. */
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

  /** Le note delle tracce che hanno spento la tastiera si fermano. */
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
    this.out.say(`Tastiera: ottava ${octave}, velocity ${VELOCITIES[this.velocity]}.`);
  }
}

/** Collega i tasti della finestra alla tastiera musicale, quando una traccia è accesa. */
export class NoteKeys {
  /** Le tracce accese l'ultima volta (per accorgersi di una nuova). */
  private shown: ReadonlySet<TrackId> = new Set();

  constructor(private readonly ui: UiState, private readonly keyboard: NoteKeyboard) {
    addEventListener('keydown', e => this.down(e), true);
    addEventListener('keyup', e => this.up(e), true);
    // un tasto lasciato fuori dalla finestra non arriva: le note si spengono lo stesso
    addEventListener('blur', () => keyboard.releaseAll());
    ui.onChange(() => this.tracksChanged());
  }

  private down(e: KeyboardEvent): void {
    const { keyboard, ui } = this;
    if (!ui.keyboardTracks.size || !keyboard.owns(e.code) || ui.keyMapping || ui.midiMapping) return;
    // `defaultPrevented`: lo ha già preso un tasto mappato
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || this.ownedElsewhere(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) keyboard.down(e.code, ui.keyboardTracks);
  }

  private up(e: KeyboardEvent): void {
    this.keyboard.up(e.code);
  }

  /** Il tasto spetta a un campo di testo, a una finestra aperta o a un menu. Non a una casella a
   *  scelta: dopo un preset il fuoco resta lì, e una lettera cambierebbe il preset invece di suonare. */
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
