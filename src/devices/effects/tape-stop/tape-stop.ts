/* "Tape Stop": il nastro (o il giradischi) che si ferma. Acceso "Stop", il suono rallenta fino
 * a fermarsi nella Durata, con la Curva scelta, e resta fermo; spento, riparte: con la
 * Ripartenza accelera da fermo fino al suono di adesso, a 0 torna subito. Con il trasporto che
 * va, la frenata può aspettare la prossima linea della griglia (Partenza), così cade a tempo.
 * Qui c'è solo la descrizione; il suono è in tape-stop-core.ts. */
import type { DeviceType } from '../../device-type';
import type { ChoiceParam, NumberParam } from '../../params';

/** Le durate a tempo della frenata, in quarti. */
export const BRAKE_DIVISIONS: readonly (readonly [label: string, beats: number])[] = [
  ['1/16', 1 / 4], ['1/8', 1 / 2], ['1/4', 1], ['1/2', 2], ['1 battuta', 4], ['2 battute', 8],
];

/** Dove può cadere l'inizio della frenata: subito, o sulla prossima linea (in quarti). */
export const STARTS: readonly (readonly [label: string, beats: number])[] = [
  ['Subito', 0], ['1/16', 1 / 4], ['1/8', 1 / 2], ['1/4', 1], ['1/2', 2], ['1 battuta', 4],
];

/** Come cala la velocità: in linea retta, morbida (piano all'inizio e alla fine), o rapida
 *  all'inizio come un giradischi. */
export const BRAKE_CURVES = ['Lineare', 'Morbida', 'Rapida'] as const;
export const BRAKE_CURVE = { linear: 0, smooth: 1, fast: 2 } as const;

export const TAPE_SYNC = { tempo: 0, ms: 1 } as const;
export const MAX_BRAKE_MS = 4000;
export const MAX_SPIN_MS = 2000;

const choice = (id: string, label: string, options: readonly string[], def = 0, extra: Partial<ChoiceParam> = {}): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def, ...extra });
const num = (id: string, label: string, min: number, max: number, def: number, unit: string, extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });

const division = (label: string) => BRAKE_DIVISIONS.findIndex(([l]) => l === label);
const start = (label: string) => STARTS.findIndex(([l]) => l === label);

export const TAPE_STOP: DeviceType = {
  type: 'tapeStop',
  label: 'Tape Stop',
  sections: [
    {
      label: 'Stop',
      params: [
        choice('stop', 'Stop', ['Off', 'On']),
        choice('start', 'Partenza', STARTS.map(([l]) => l), start('Subito')),
      ],
    },
    {
      label: 'Frenata',
      params: [
        choice('sync', 'Sincro', ['Tempo', 'ms']),
        choice('division', 'Durata', BRAKE_DIVISIONS.map(([l]) => l), division('1/2'), { when: { param: 'sync', is: TAPE_SYNC.tempo } }),
        num('time', 'Durata', 20, MAX_BRAKE_MS, 500, 'ms', { scale: 'log', step: 1, when: { param: 'sync', is: TAPE_SYNC.ms } }),
        choice('curve', 'Curva', BRAKE_CURVES),
      ],
    },
    {
      label: 'Ripartenza',
      params: [num('spin', 'Ripartenza', 0, MAX_SPIN_MS, 0, 'ms', { step: 1 })],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Stop di 1 battuta', params: { division: division('1 battuta'), start: start('1/4') } },
    { name: 'Giradischi spento', params: { sync: TAPE_SYNC.ms, time: 900, curve: BRAKE_CURVE.fast } },
    { name: 'Frenata breve', params: { division: division('1/8'), curve: BRAKE_CURVE.smooth, start: start('1/16') } },
    { name: 'Avvio lento', params: { division: division('1/4'), spin: 600 } },
  ],
};
