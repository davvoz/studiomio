/* L'anteprima dei sample del browser: suona l'audio così com'è (senza warp), direttamente
 * all'uscita, fuori dal mixer, come il pre-ascolto di Live. I file del disco si decodificano
 * una volta: gli ultimi restano in memoria per riascoltarli subito. */
import type { BrowserPayload } from '../browser/item';
import type { SampleId } from '../core/id';
import type { AudioData } from '../dsp/types';
import type { BrowserPreview } from '../ui/browser/browser-view';

/** Quanti file decodificati tenere. */
const CACHED = 8;
/** L'anteprima suona un po' più bassa del mix, come in Live. */
const PREVIEW_GAIN = 0.7;

export class SamplePreview implements BrowserPreview {
  private source: AudioBufferSourceNode | null = null;
  private readonly decoded = new Map<string, AudioData>();

  constructor(private readonly context: AudioContext, private readonly sample: (id: SampleId) => AudioData | undefined) {}

  async audio(payload: BrowserPayload): Promise<AudioData | null> {
    if (payload.kind === 'sample') return this.sample(payload.sample.id) ?? null;
    if (payload.kind !== 'file') return null;
    const file = await payload.file();
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    const known = this.decoded.get(key);
    if (known) {
      this.decoded.delete(key);
      this.decoded.set(key, known); // il più recente in fondo
      return known;
    }
    const buf = await this.context.decodeAudioData(await file.arrayBuffer());
    const data: AudioData = { sampleRate: buf.sampleRate, channels: Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i)) };
    this.decoded.set(key, data);
    if (this.decoded.size > CACHED) this.decoded.delete(this.decoded.keys().next().value!);
    return data;
  }

  play(audio: AudioData): void {
    this.stop();
    const n = audio.channels[0]?.length ?? 0;
    if (!n) return;
    const ctx = this.context;
    if (ctx.state !== 'running') void ctx.resume();
    const buffer = ctx.createBuffer(audio.channels.length, n, audio.sampleRate);
    audio.channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = PREVIEW_GAIN;
    source.buffer = buffer;
    source.connect(gain).connect(ctx.destination);
    source.onended = () => { if (this.source === source) this.source = null; };
    source.start();
    this.source = source;
  }

  stop(): void {
    try { this.source?.stop(); } catch { /* già finito */ }
    this.source = null;
  }
}
