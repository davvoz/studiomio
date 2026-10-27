/* "Pitch Shifter": sposta l'intonazione senza cambiare il tempo, come gli harmonizer da studio.
 * Semitoni e Fine dicono di quanto (fino a due ottave sopra o sotto); Finestra è la grana: corta
 * suona metallica e robotica, lunga più liscia ma con un'eco. Stereo scorda il sinistro in giù e
 * il destro in su (il raddoppio delle voci); Feedback rimanda il suono spostato dentro, così sale
 * (o scende) a spirale; Glide fa scivolare i cambi di Semitoni, per i tuffi a macro. Qui c'è solo
 * la descrizione; il suono è in pitch-shifter-core.ts. */
import type { DeviceType } from '../../device-type';
import type { NumberParam } from '../../params';

export const MAX_SHIFT = 24;
export const MIN_WINDOW_MS = 10;
export const MAX_WINDOW_MS = 200;

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

export const PITCH_SHIFTER: DeviceType = {
  type: 'pitchShifter',
  label: 'Pitch Shifter',
  sections: [
    {
      label: 'Intonazione',
      params: [
        num('semitones', 'Semitoni', -MAX_SHIFT, MAX_SHIFT, 0, 'st', { step: 1 }),
        num('fine', 'Fine', -50, 50, 0, 'ct', { step: 1 }),
        num('glide', 'Glide', 0, 2000, 20, 'ms', { scale: 'log', step: 1 }),
      ],
    },
    {
      label: 'Suono',
      params: [
        num('window', 'Finestra', MIN_WINDOW_MS, MAX_WINDOW_MS, 60, 'ms', { scale: 'log', step: 1 }),
        num('spread', 'Stereo', 0, 50, 0, 'ct', { step: 1 }),
        num('feedback', 'Feedback', 0, 95, 0, '%', { step: 1 }),
      ],
    },
    { label: 'Uscita', params: [num('mix', 'Dry/Wet', 0, 100, 100, '%', { step: 1 })] },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Ottava sotto', params: { semitones: -12, window: 80 } },
    { name: 'Ottava sopra', params: { semitones: 12, window: 40 } },
    { name: 'Demone', params: { semitones: -7, window: 90, mix: 100 } },
    { name: 'Raddoppio', params: { spread: 18, window: 30, mix: 50 } },
    { name: 'Quinta', params: { semitones: 7, mix: 40 } },
    { name: 'Spirale', params: { semitones: 12, window: 120, feedback: 60, mix: 35 } },
    { name: 'Robot', params: { window: 12, spread: 8 } },
  ],
};
