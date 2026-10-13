import type { Channels } from '../types';

export type WavBitDepth = 16 | 24 | 32;

/** Scrittura di un campione nel formato del file; il numero è anche la sua dimensione in byte. */
interface SampleWriter {
  readonly bytes: number;
  readonly formatTag: 1 | 3; // 1 = PCM intero, 3 = IEEE float
  write(v: DataView, offset: number, s: number): void;
}

const clip = (s: number) => Math.max(-1, Math.min(1, s));
const toInt = (s: number, max: number) => Math.round(s < 0 ? s * (max + 1) : s * max);

const writers: Record<WavBitDepth, SampleWriter> = {
  16: { bytes: 2, formatTag: 1, write: (v, o, s) => v.setInt16(o, toInt(clip(s), 32767), true) },
  24: {
    bytes: 3, formatTag: 1,
    write: (v, o, s) => {
      const x = toInt(clip(s), 8388607);
      v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255);
    },
  },
  32: { bytes: 4, formatTag: 3, write: (v, o, s) => v.setFloat32(o, s, true) },
};

export function encodeWav(channels: Channels, sampleRate: number, bits: WavBitDepth): ArrayBuffer {
  const w = writers[bits];
  const C = channels.length, n = channels[0].length, bps = w.bytes;
  const dataLen = n * C * bps;
  const buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, w.formatTag, true); v.setUint16(22, C, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * C * bps, true);
  v.setUint16(32, C * bps, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < C; c++) {
      w.write(v, o, channels[c][i]);
      o += bps;
    }
  }
  return buf;
}
