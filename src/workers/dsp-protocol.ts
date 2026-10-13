import type { AudioAnalysis } from '../dsp/analysis/analyze';
import type { WarpJob } from '../dsp/stretch/warp-renderer';
import type { WarpMode } from '../dsp/stretch/stretcher';

export interface SourcePayload {
  readonly sourceId: string;
  readonly channels: Float32Array[];
  readonly sampleRate: number;
}

/** Protocollo tra thread principale e worker DSP. */
export type DspProtocol = {
  loadSource: { req: SourcePayload; res: null };
  dropSource: { req: { readonly sourceId: string }; res: null };
  renderWarp: { req: { readonly sourceId: string; readonly job: WarpJob }; res: Float32Array[] };
  analyze: { req: { readonly sourceId: string; readonly sensitivity: number }; res: AudioAnalysis };
  info: { req: null; res: Record<WarpMode, string> };
};
