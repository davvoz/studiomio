/* "Noise Gate": lascia passare il suono solo quando supera la soglia, e sotto lo chiude: toglie il
 * rumore tra un colpo e l'altro, stringe le code di una batteria, separa i colpi di una traccia
 * rientrata da altri microfoni. Si apre sopra "Soglia" e si richiude sotto "Soglia" meno
 * "Isteresi", così un suono che sta lì intorno non lo fa battere. "Tieni" lo lascia aperto ancora
 * un po', "Rientro" dice quanto chiude (−80 dB è il silenzio), "Inverti" fa il contrario (si
 * chiude quando il suono è forte). I filtri e il sidechain riguardano solo ciò che il rilevatore
 * ascolta: con il sidechain il gate si apre al ritmo di un'altra traccia. Da non confondere con
 * il Trance Gate, che apre e chiude a tempo seguendo un pattern. Il suono è in noise-gate-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });

export const NOISE_GATE: DeviceType = {
  type: 'noise-gate',
  label: 'Noise Gate',
  sidechain: true,
  sections: [
    {
      label: 'Soglia',
      params: [
        num('threshold', 'Soglia', -80, 0, -40, 'dB', { step: 0.1 }),
        num('hysteresis', 'Isteresi', 0, 24, 3, 'dB', { step: 0.1 }),
        num('floor', 'Rientro', -80, 0, -80, 'dB', { step: 0.1 }),
        choice('flip', 'Inverti', ['Off', 'On']),
      ],
    },
    {
      label: 'Tempi',
      params: [
        num('attack', 'Attacco', 0.05, 100, 0.5, 'ms', { scale: 'log', step: 0.01 }),
        num('hold', 'Tieni', 0, 500, 20, 'ms', { step: 1 }),
        num('release', 'Rilascio', 1, 2000, 80, 'ms', { scale: 'log', step: 1 }),
      ],
    },
    {
      label: 'Rilevatore',
      params: [
        num('scHp', 'Passa-alto', 20, 2000, 20, 'Hz', { scale: 'log', step: 1 }),
        num('scLp', 'Passa-basso', 200, 20000, 20000, 'Hz', { scale: 'log', step: 1 }),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Togli il rumore', params: { threshold: -50, hysteresis: 6, attack: 1, hold: 50, release: 150 } },
    { name: 'Rullante stretto', params: { threshold: -24, hysteresis: 4, attack: 0.2, hold: 10, release: 60, scHp: 180 } },
    { name: 'Cassa asciutta', params: { threshold: -22, hysteresis: 4, attack: 0.1, hold: 25, release: 90, scLp: 900 } },
    { name: 'Coda tagliata', params: { threshold: -30, hysteresis: 2, attack: 0.5, hold: 0, release: 15 } },
    { name: 'Rientro morbido', params: { threshold: -36, hysteresis: 6, floor: -14, attack: 2, hold: 30, release: 200 } },
    { name: 'Ritmo dal sidechain', params: { threshold: -30, hysteresis: 3, attack: 0.5, hold: 5, release: 40 } },
  ],
};
