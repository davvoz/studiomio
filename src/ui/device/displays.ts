/* Graphic panels of the devices. Normally a device has the knobs generated from its
 * parameters; a type needing its own interface (the EQ with curve and spectrum)
 * registers it here with its name, and the panel uses it in place of the knobs. */
import type { SampleId } from '../../core/id';
import type { DeviceType } from '../../devices/device-type';
import type { SampleData } from '../../devices/dsp/core';
import type { DeviceSettings, ParamValues } from '../../model/device';
import type { ModTarget } from '../../model/envelope';
import type { SampleRef } from '../../model/sample';
import type { MenuItem } from '../context-menu';
import { CymbalsDisplay } from './cymbals/cymbals-display';
import { DriveDisplay } from './drive/drive-display';
import { DrumDisplay } from './drums/drum-display';
import { COMPRESSOR_GRAPH, DynamicsDisplay, NOISE_GATE_GRAPH } from './dynamics/dynamics-display';
import { EqDisplay } from './eq/eq-display';
import { GateDisplay } from './gate/gate-display';
import { kickDisplay } from './kick/kick-display';
import { ModulatorDisplay } from './modulators/modulator-display';
import { snareDisplay } from './snare/snare-display';
import { PrismaDisplay } from './prisma/prisma-display';
import { SamplerDisplay } from './sampler/sampler-display';
import { WavetableDisplay } from './wavetable/wavetable-display';

/** The spectrum of the sound entering an effect and of the one leaving it, in dB per frequency
 *  band (like AnalyserNode.getFloatFrequencyData). */
export interface SpectrumTap {
  readonly sampleRate: number;
  /** How many bands: half the size of the FFT. */
  readonly binCount: number;
  /** Fills `pre` and `post` (binCount long); false if the effect isn't playing. */
  read(pre: Float32Array<ArrayBuffer>, post: Float32Array<ArrayBuffer>): boolean;
  dispose(): void;
}

/** What a dynamics effect is doing: the level the detector hears and the reduction, in dB. */
export interface DynamicsReading {
  readonly input: number;
  readonly reduction: number;
}

export interface DynamicsTap {
  /** What happened since the last read; null if nothing arrived. */
  read(): DynamicsReading | null;
  dispose(): void;
}

/** The samples of an instrument that plays some (the Drum Machine's pads), by slot. */
export interface SampleSlots {
  /** The project's samples, to choose from. */
  list(): readonly SampleRef[];
  /** Copies the file into the project and puts it in slot `slot`, with the parameters `values`. */
  load(slot: string, file: File, values: ParamValues): Promise<void>;
  /** Like `load`, with several files together (by slot): a single step. */
  loadAll?(files: Readonly<Record<string, File>>, values: ParamValues): Promise<void>;
  /** Project samples (null: removed) by slot, with the parameters `values`: a single step. */
  assign(changes: Readonly<Record<string, SampleId | null>>, values: ParamValues): void;
  /** The samples of the sample in slot `slot`, if it's loaded (to draw it). */
  audio?(slot: string): SampleData | undefined;
}

/** For the modulators (LFO, Envelope): the targets they can move, in the open chain. */
export interface ModTargetHost {
  /** The target under point (x, y) of the screen, with its control: a parameter of a
   *  device of the chain (not of the modulator itself) or a macro; null if there isn't one. */
  at(x: number, y: number): { readonly target: ModTarget; readonly element: HTMLElement } | null;
  /** A target's name: "Prisma · Cutoff", "Volume". */
  label(target: ModTarget): string;
  /** The targets to choose from a menu (the track's volume and pan, the racks' macros). */
  choices(): readonly { readonly target: ModTarget; readonly label: string }[];
  /** Target `slot` (from 0) moves `target` (null: free); with `amount` also the amount. */
  set(slot: number, target: ModTarget | null, amount?: number): void;
  /** From now on a click on a target of the chain passes it to `pick` instead of moving it; the
   *  chain scrolls and the tabs change as always. It lasts until `stopPicking`, Esc or
   *  another choice: at the end `ended` is called. */
  startPicking(pick: (target: ModTarget) => void, ended: () => void): void;
  stopPicking(): void;
  /** With the pointer at `x` near an edge of the chain (a drag), it scrolls it by one step. */
  scrollToward(x: number): void;
  /** A message in the status bar. */
  say(text: string): void;
}

export interface DisplayContext {
  readonly type: DeviceType;
  readonly settings: DeviceSettings;
  readonly sampleRate: number;
  /** Changes one or more parameters; `final` at the end of the gesture closes the undo step.
   *  The parameters mapped to a macro stay as they are (the macro moves them). */
  setParams(values: ParamValues, final: boolean): void;
  /** To be called when the panel redoes its controls (e.g. another band): the chain
   *  puts the macro marks back. */
  controlsChanged(): void;
  /** The effect's spectrum (detached with `dispose`); for the instruments it's always empty. */
  openSpectrum(): SpectrumTap;
  /** For the dynamics effects: what they're doing while the sound passes. */
  openDynamics?(): DynamicsTap;
  /** Plays a note right away with the instrument (for the effects it does nothing). */
  audition(pitch: number, velocity: number): void;
  /** The notes the instrument played since the previous call (for the effects, none). */
  playedNotes(): readonly number[];
  /** Where the instrument's voices read now, if it plays a sample (fractions of the sample; with
   *  several samples, the sample's index plus the fraction: see InstrumentCore.playheads). */
  playheads?(): readonly number[];
  /** The device's samples (only for the instruments). */
  readonly samples?: SampleSlots;
  /** The targets of the destinations (only for the modulators). */
  readonly modTargets?: ModTargetHost;
}

/** The spectrum of whoever doesn't have one: it never reads anything. */
export const NO_SPECTRUM: SpectrumTap = { sampleRate: 48000, binCount: 0, read: () => false, dispose() {} };

/** Of whoever doesn't play: it never reads anything. */
export const NO_DYNAMICS: DynamicsTap = { read: () => null, dispose() {} };

export interface DeviceDisplay {
  readonly element: HTMLElement;
  /** Controls sitting in the device's header, after the name (for example the tabs). */
  readonly head?: HTMLElement;
  update(settings: DeviceSettings, enabled: boolean): void;
  /** Extra items in a parameter's menu (right click), before the macros' ones. */
  menuFor?(param: string): MenuItem[];
}

export type DisplayFactory = (ctx: DisplayContext) => DeviceDisplay;

/** Graphic panels by device type. */
export const DEVICE_DISPLAYS: Readonly<Record<string, DisplayFactory>> = {
  eq: ctx => new EqDisplay(ctx),
  compressor: ctx => new DynamicsDisplay(ctx, COMPRESSOR_GRAPH),
  'noise-gate': ctx => new DynamicsDisplay(ctx, NOISE_GATE_GRAPH),
  drive: ctx => new DriveDisplay(ctx),
  gate: ctx => new GateDisplay(ctx),
  drums: ctx => new DrumDisplay(ctx),
  kick: kickDisplay,
  snare: snareDisplay,
  cymbals: ctx => new CymbalsDisplay(ctx),
  wavetable: ctx => new WavetableDisplay(ctx),
  prisma: ctx => new PrismaDisplay(ctx),
  sampler: ctx => new SamplerDisplay(ctx),
  lfo: ctx => new ModulatorDisplay(ctx),
  envelope: ctx => new ModulatorDisplay(ctx),
};
