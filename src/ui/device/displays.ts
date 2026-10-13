/* Pannelli grafici dei dispositivi. Di norma un dispositivo ha le manopole generate dai suoi
 * parametri; un tipo che ha bisogno di un'interfaccia sua (l'EQ con curva e spettro) la
 * registra qui con il suo nome, e il pannello la usa al posto delle manopole. */
import type { SampleId } from '../../core/id';
import type { DeviceType } from '../../devices/device-type';
import type { DeviceSettings, ParamValues } from '../../model/device';
import type { SampleRef } from '../../model/sample';
import { DriveDisplay } from './drive/drive-display';
import { DrumDisplay } from './drums/drum-display';
import { EqDisplay } from './eq/eq-display';

/** Lo spettro del suono che entra in un effetto e di quello che esce, in dB per banda di
 *  frequenza (come AnalyserNode.getFloatFrequencyData). */
export interface SpectrumTap {
  readonly sampleRate: number;
  /** Quante bande: metà della dimensione della FFT. */
  readonly binCount: number;
  /** Riempie `pre` e `post` (lunghi binCount); false se l'effetto non sta suonando. */
  read(pre: Float32Array<ArrayBuffer>, post: Float32Array<ArrayBuffer>): boolean;
  dispose(): void;
}

/** I sample di uno strumento che ne suona (i pad della Drum Machine), per posto. */
export interface SampleSlots {
  /** I sample del progetto, da scegliere. */
  list(): readonly SampleRef[];
  /** Copia il file nel progetto e lo mette al posto `slot`, con i parametri `values`. */
  load(slot: string, file: File, values: ParamValues): Promise<void>;
  /** Sample del progetto (null: tolto) per posto, con i parametri `values`: un passo solo. */
  assign(changes: Readonly<Record<string, SampleId | null>>, values: ParamValues): void;
}

export interface DisplayContext {
  readonly type: DeviceType;
  readonly settings: DeviceSettings;
  readonly sampleRate: number;
  /** Cambia uno o più parametri; `final` alla fine del gesto chiude il passo di annullamento. */
  setParams(values: ParamValues, final: boolean): void;
  /** Lo spettro dell'effetto (si stacca con `dispose`); per gli strumenti è sempre vuoto. */
  openSpectrum(): SpectrumTap;
  /** Suona subito una nota con lo strumento (per gli effetti non fa nulla). */
  audition(pitch: number, velocity: number): void;
  /** Le note che lo strumento ha suonato dalla chiamata precedente (per gli effetti, nessuna). */
  playedNotes(): readonly number[];
  /** I sample del dispositivo (solo per gli strumenti). */
  readonly samples?: SampleSlots;
}

/** Lo spettro di chi non ne ha uno: non legge mai nulla. */
export const NO_SPECTRUM: SpectrumTap = { sampleRate: 48000, binCount: 0, read: () => false, dispose() {} };

export interface DeviceDisplay {
  readonly element: HTMLElement;
  update(settings: DeviceSettings, enabled: boolean): void;
}

export type DisplayFactory = (ctx: DisplayContext) => DeviceDisplay;

/** Pannelli grafici per tipo di dispositivo. */
export const DEVICE_DISPLAYS: Readonly<Record<string, DisplayFactory>> = {
  eq: ctx => new EqDisplay(ctx),
  drive: ctx => new DriveDisplay(ctx),
  drums: ctx => new DrumDisplay(ctx),
};
