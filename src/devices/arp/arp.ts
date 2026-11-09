/* "Arpeggiator": a device in MIDI tracks' chain that doesn't touch the sound, but the notes
 * arriving at the instrument. The notes held together (from clips or played by hand) come out one
 * at a time, in time. The work is done by the engine in the AudioWorklet (arpeggiator.ts), in front of the
 * instrument: its parameters travel with the instrument's, so curves, macros and modulators
 * move them like all the others. Here is the description. */
import type { EffectSettings } from '../../model/device';
import { resolveParams, type DeviceType } from '../device-type';
import type { ChoiceParam, NumberParam } from '../params';

/** The step divisions: name and beats. */
export const ARP_RATES: readonly (readonly [label: string, beats: number])[] = [
  ['1/2', 2], ['1/4', 1], ['1/4T', 2 / 3], ['1/8.', 0.75], ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125],
];
const RATE = Object.fromEntries(ARP_RATES.map(([l], i) => [l, i])) as Readonly<Record<string, number>>;

/** Inward: from the outside towards the centre. Pedal: the lowest note returns at every step. */
export const ARP_STYLES = ['Up', 'Down', 'Up & down', 'Down & up', 'Inward', 'Pedal', 'As played', 'Random', 'Chord'] as const;
export const ARP_STYLE = { up: 0, down: 1, upDown: 2, downUp: 3, inward: 4, pedal: 5, played: 6, random: 7, chord: 8 } as const;

export const ARP_ON = 'arpOn';

const num = (id: string, label: string, min: number, max: number, def: number, unit = '', extra: Partial<NumberParam> = {}): NumberParam =>
  ({ kind: 'number', id, label, min, max, default: def, unit, ...extra });
const choice = (id: string, label: string, options: readonly string[], def = 0): ChoiceParam =>
  ({ kind: 'choice', id, label, options, default: def });

export const ARP: DeviceType = {
  type: 'arp',
  label: 'Arpeggiator',
  notes: true,
  sections: [
    {
      label: 'Order',
      params: [
        choice('arpStyle', 'Style', ARP_STYLES),
        num('arpOctaves', 'Octaves', 1, 4, 1, '', { step: 1 }),
        num('arpRepeat', 'Repeat', 1, 8, 1, '', { step: 1 }),
      ],
    },
    {
      label: 'Tempo',
      params: [
        choice('arpRate', 'Division', ARP_RATES.map(([l]) => l), RATE['1/16']),
        num('arpGate', 'Gate', 5, 200, 60, '%', { step: 1 }),
        num('arpSwing', 'Swing', 0, 70, 0, '%', { step: 1 }),
      ],
    },
    {
      label: 'Feel',
      params: [
        num('arpChance', 'Probability', 0, 100, 100, '%', { step: 1 }),
        choice('arpHold', 'Hold', ['Off', 'On']),
      ],
    },
  ],
  presets: [
    { name: 'Init', params: {} },
    { name: 'Tight sixteenths', params: { arpGate: 35 } },
    { name: 'Wide eighths', params: { arpRate: RATE['1/8'], arpGate: 90 } },
    { name: 'Triplets', params: { arpRate: RATE['1/16T'], arpGate: 50 } },
    { name: 'Up and down, two octaves', params: { arpStyle: ARP_STYLE.upDown, arpOctaves: 2 } },
    { name: 'Rolling', params: { arpStyle: ARP_STYLE.up, arpRepeat: 4, arpGate: 45 } },
    { name: 'Pedal', params: { arpStyle: ARP_STYLE.pedal, arpGate: 40 } },
    { name: 'Spring', params: { arpStyle: ARP_STYLE.inward, arpOctaves: 2, arpRate: RATE['1/32'], arpGate: 50 } },
    { name: 'Sparks', params: { arpStyle: ARP_STYLE.random, arpOctaves: 3, arpRate: RATE['1/32'], arpGate: 30, arpChance: 70 } },
    { name: 'Broken up', params: { arpStyle: ARP_STYLE.random, arpOctaves: 2, arpGate: 30, arpChance: 55, arpSwing: 20 } },
    { name: 'Stab', params: { arpStyle: ARP_STYLE.chord, arpRate: RATE['1/8'], arpGate: 25 } },
    { name: 'Swing', params: { arpStyle: ARP_STYLE.up, arpSwing: 35, arpGate: 55 } },
    { name: 'Held in Hold', params: { arpStyle: ARP_STYLE.upDown, arpHold: 1, arpGate: 50 } },
  ],
};

export const isArpType = (type: string): boolean => type === ARP.type;

/** The parameters to give the note engine: those of the chain's first active arpeggiator. */
export function arpParams(effect: EffectSettings | undefined): Readonly<Record<string, number>> {
  return effect ? { ...resolveParams(ARP, effect.params), [ARP_ON]: 1 } : { [ARP_ON]: 0 };
}

/** The chain's first active arpeggiator: it's the one that plays. */
export const activeArp = (effects: readonly EffectSettings[]): EffectSettings | undefined =>
  effects.find(e => isArpType(e.type) && e.enabled);
