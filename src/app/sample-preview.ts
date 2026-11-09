/* The browser's sample preview: plays the audio as it is (without warp), straight
 * to the output, outside the mixer, like Live's preview. Disk files are decoded
 * once: the latest stay in memory to replay them right away. */
import type { BrowserPayload } from '../browser/item';
import type { SampleId } from '../core/id';
import type { AudioData } from '../dsp/types';
import type { BrowserPreview } from '../ui/browser/browser-view';

/** How many decoded files to keep. */
const CACHED = 8;
/** The preview plays a little quieter than the mix, as in Live. */
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
      this.decoded.set(key, known); // the most recent at the end
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
    try { this.source?.stop(); } catch { /* already finished */ }
    this.source = null;
  }
}
