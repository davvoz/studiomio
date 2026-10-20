import type { TransportAnchor } from '../../devices/worklet/transport-clock';
import type { ScheduledSource, ScheduleWindow } from '../scheduler';

/** Dice agli effetti che seguono la battuta dove si trova il trasporto: un ancoraggio
 *  all'inizio di ogni corsa (play, giro di loop, salto, tempo o loop nuovi), da lì il worklet
 *  conta da solo. Lo stop lo annuncia il motore, che sa quando il trasporto si ferma davvero
 *  (lo scheduler si ferma anche per ripartire subito da un'altra parte). */
export class TransportAnchors implements ScheduledSource {
  private last: TransportAnchor | null = null;

  constructor(
    private readonly send: (anchor: TransportAnchor | null) => void,
    private readonly beatsPerBar: () => number,
  ) {}

  schedule(w: ScheduleWindow): void {
    if (w.from !== w.runStart) return;
    const bpm = 60 / (w.tempo.secondsAt(w.from + 1) - w.tempo.secondsAt(w.from));
    this.announce({ time: w.timeAt(w.from), beat: w.from, bpm, beatsPerBar: this.beatsPerBar() });
  }

  /** Il metro è cambiato: l'ultimo ancoraggio vale ancora, con le battute nuove. */
  resend(): void {
    if (this.last && this.last.beatsPerBar !== this.beatsPerBar()) this.announce({ ...this.last, beatsPerBar: this.beatsPerBar() });
  }

  stopped(): void {
    this.last = null;
    this.send(null);
  }

  stopAll(): void {}

  retake(): void {}

  private announce(anchor: TransportAnchor): void {
    this.last = anchor;
    this.send(anchor);
  }
}
