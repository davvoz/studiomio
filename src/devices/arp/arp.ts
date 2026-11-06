/* "Arpeggiatore": un dispositivo della catena delle tracce MIDI che non tocca il suono, ma le note
 * che arrivano allo strumento. Le note tenute insieme (dalle clip o suonate a mano) escono una alla
 * volta, a tempo. Il lavoro lo fa il motore nell'AudioWorklet (arpeggiator.ts), davanti allo
 * strumento: i suoi parametri viaggiano con quelli dello strumento, quindi curve, macro e modulatori
 * li muovono come tutti gli altri. Qui c'è la descrizione. */
import type { EffectSettings } from '../../model/device';
import { resolveParams, type DeviceType } from '../device-type';
import type { ChoiceParam, NumberParam } from '../params';

/** Le divisioni del passo: nome e battiti. */
export const ARP_RATES: readonly (readonly [label: string, beats: number])[] = [
  ['1/2', 2], ['1/4', 1], ['1/4T', 2 / 3], ['1/8.', 0.75], ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125],
];
const RATE = Object.fromEntries(ARP_RATES.map(([l], i) => [l, i])) as Readonly<Record<string, number>>;

/** Dentro: dall'esterno verso il centro. Pedale: la nota più bassa torna a ogni passo. */
export const ARP_STYLES = ['Su', 'Giù', 'Su e giù', 'Giù e su', 'Dentro', 'Pedale', 'Come suonate', 'Casuale', 'Accordo'] as const;
export const ARP_STYLE = { up: 0, down: 1, upDown: 2, downUp: 3, inward: 4, pedal: 5, played: 6, random: 7, chord: 8 } as const;

export const ARP_ON = 'arpOn';

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });

export const ARP: DeviceType = {
  type: 'arp',
  label: 'Arpeggiatore',
  notes: true,
  sections: [
    {
      label: 'Ordine',
      params: [
        choice('arpStyle', 'Stile', ARP_STYLES),
        num('arpOctaves', 'Ottave', 1, 4, 1, '', { step: 1 }),
        num('arpRepeat', 'Ripeti', 1, 8, 1, '', { step: 1 }),
      ],
    },
    {
      label: 'Tempo',
      params: [
        choice('arpRate', 'Divisione', ARP_RATES.map(([l]) => l), RATE['1/16']),
        num('arpGate', 'Gate', 5, 200, 60, '%', { step: 1 }),
        num('arpSwing', 'Swing', 0, 70, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Gioco',
      params: [
        num('arpChance', 'Probabilità', 0, 100, 100, '%', { step: 1 }),
        choice('arpHold', 'Hold', ['Off', 'On']),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Sedicesimi stretti', params: { arpGate: 35 } },
    { name: 'Ottavi larghi', params: { arpRate: RATE['1/8'], arpGate: 90 } },
    { name: 'Terzine', params: { arpRate: RATE['1/16T'], arpGate: 50 } },
    { name: 'Su e giù, due ottave', params: { arpStyle: ARP_STYLE.upDown, arpOctaves: 2 } },
    { name: 'Rotolante', params: { arpStyle: ARP_STYLE.up, arpRepeat: 4, arpGate: 45 } },
    { name: 'Pedale', params: { arpStyle: ARP_STYLE.pedal, arpGate: 40 } },
    { name: 'Molla', params: { arpStyle: ARP_STYLE.inward, arpOctaves: 2, arpRate: RATE['1/32'], arpGate: 50 } },
    { name: 'Scintille', params: { arpStyle: ARP_STYLE.random, arpOctaves: 3, arpRate: RATE['1/32'], arpGate: 30, arpChance: 70 } },
    { name: 'Spezzato', params: { arpStyle: ARP_STYLE.random, arpOctaves: 2, arpGate: 30, arpChance: 55, arpSwing: 20 } },
    { name: 'Stab', params: { arpStyle: ARP_STYLE.chord, arpRate: RATE['1/8'], arpGate: 25 } },
    { name: 'Dondolo', params: { arpStyle: ARP_STYLE.up, arpSwing: 35, arpGate: 55 } },
    { name: 'Tenuto in Hold', params: { arpStyle: ARP_STYLE.upDown, arpHold: 1, arpGate: 50 } },
  ],
};

export const isArpType = (type: string): boolean => type === ARP.type;

/** I parametri da dare al motore delle note: quelli del primo arpeggiatore acceso della catena. */
export function arpParams(effect: EffectSettings | undefined): Readonly<Record<string, number>> {
  return effect ? { ...resolveParams(ARP, effect.params), [ARP_ON]: 1 } : { [ARP_ON]: 0 };
}

/** Il primo arpeggiatore acceso della catena: è lui che suona. */
export const activeArp = (effects: readonly EffectSettings[]): EffectSettings | undefined =>
  effects.find(e => isArpType(e.type) && e.enabled);
